"""PJS Independent OMS DataDoc-only worker.

Windows logon starts this process with Task Scheduler. It claims only explicitly
approved bill_submit jobs from the independent OMS Supabase database.
No website tab is required. No old automation_jobs or legacy Supabase is used.

A failed/interrupted DataDoc call must be checked by a human before retrying:
the worker never automatically retries or reclaims a running job.
"""
from __future__ import annotations

import logging
import os
import re
import socket
import sys
import tempfile
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from logging.handlers import RotatingFileHandler
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID

from dotenv import load_dotenv
from supabase import create_client

from datadoc import DataDocAgent

BASE = Path(__file__).resolve().parent
load_dotenv(BASE / ".env")
LOGS = BASE / "logs"
LOGS.mkdir(parents=True, exist_ok=True)
log = logging.getLogger("pjs-office-worker")
log.setLevel(logging.INFO)
fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
file_handler = RotatingFileHandler(LOGS / "datadoc-worker.log", maxBytes=2_000_000, backupCount=4, encoding="utf-8")
file_handler.setFormatter(fmt)
log.addHandler(file_handler)
console = logging.StreamHandler(sys.stdout)
console.setFormatter(fmt)
log.addHandler(console)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
OWNER = os.getenv("PJS_OFFICE_OWNER_USER_ID", "").strip()
WORKER = os.getenv("PJS_WORKER_NAME", "pjs-datadoc-office").strip()
POLL_SECONDS = max(5, min(120, int(os.getenv("PJS_POLL_SECONDS", "15"))))
LIVE = os.getenv("PJS_ENABLE_LIVE_DATADOC", "0").strip() == "1"

def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()

def validate_environment() -> None:
    if not SUPABASE_URL or not SERVICE_KEY or not OWNER:
        raise SystemExit("Missing independent Supabase URL, SERVICE ROLE key or PJS_OFFICE_OWNER_USER_ID in worker/.env")
    if "tbkytdktututiyeoqkwa.supabase.co" not in SUPABASE_URL:
        raise SystemExit("Refusing to run against an unknown/legacy Supabase project.")
    if not 3 <= len(WORKER) <= 100:
        raise SystemExit("PJS_WORKER_NAME must be 3–100 characters.")
    try:
        UUID(OWNER)
    except ValueError:
        raise SystemExit("PJS_OFFICE_OWNER_USER_ID must be the signed-in OMS account's UUID.")
    if LIVE:
        for key in ("PJS_DATADOC_URL", "PJS_DATADOC_USERNAME", "PJS_DATADOC_PASSWORD"):
            if not os.getenv(key, "").strip():
                raise SystemExit(f"{key} is required before enabling live DataDoc work.")

def office_datadoc_reachable() -> bool:
    parsed = urlparse(os.getenv("PJS_DATADOC_URL", "http://192.168.0.18:8082"))
    host = parsed.hostname
    if not host:
        return False
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        with socket.create_connection((host, port), timeout=4):
            return True
    except (OSError, ValueError):
        return False

def heartbeat(db, status: str, job_id: str | None = None, note: str = "") -> None:
    db.table("oms_office_workers").upsert({
        "owner_id": OWNER, "worker_name": WORKER,
        "machine_name": socket.gethostname(), "status": status,
        "current_job_id": job_id, "last_seen_at": utcnow(),
        "details": {"note": note[:180], "mode": "auto_on_login", "live_enabled": LIVE}
    }).execute()

def claim(db) -> dict | None:
    res = db.rpc("oms_claim_approved_office_bill", {
        "p_worker_name": WORKER, "p_owner_id": OWNER
    }).execute()
    rows = res.data or []
    return rows[0] if rows else None

def complete(db, job: dict, ok: bool, message: str) -> None:
    db.rpc("oms_finish_approved_office_bill", {
        "p_job_id": job["id"], "p_worker_name": WORKER,
        "p_success": bool(ok), "p_details": str(message)[:1300]
    }).execute()

def read_process(db, job: dict) -> dict:
    res = db.table("oms_processes").select(
        "id,process_no,user_id,team_id,party_name,sales_order_no,data,deleted_at"
    ).eq("id", job["process_id"]).eq("process_no", job["process_no"]).limit(1).execute()
    rows = res.data or []
    if len(rows) != 1 or rows[0].get("deleted_at"):
        raise ValueError("Source process was deleted or changed. No DataDoc action attempted.")
    return rows[0]

def lookup_documents(db, job: dict) -> dict:
    res = db.table("oms_documents").select(
        "id,process_id,user_id,kind,name,path,created_at"
    ).eq("process_id", job["process_id"]).order("created_at", desc=True).execute()
    latest = {}
    for doc in (res.data or []):
        if doc["kind"] not in latest:
            latest[doc["kind"]] = doc
    return latest

def validate_bill(process: dict, documents: dict) -> dict:
    number = str(process["process_no"]).strip()
    info = process.get("data") or {}
    invoice = str(info.get("invoice", "")).strip()
    credit = str(info.get("credit", "")).strip()
    raw_amount = str(info.get("amount", "")).strip()
    so = str(process.get("sales_order_no") or "")
    party = str(process.get("party_name") or "").strip()
    if not re.fullmatch(r"\d{5,9}", number):
        raise ValueError("Invalid DataDoc Process No.")
    if not re.fullmatch(r"\d{6,12}", so) or not party:
        raise ValueError("Sales Order No. or Party Name is missing.")
    if not invoice or not re.fullmatch(r"[A-Za-z0-9/._-]{1,80}", invoice):
        raise ValueError("Invoice No. is missing or invalid.")
    if credit not in {"Credit", "Non Credit"}:
        raise ValueError("Credit / Non Credit must be confirmed before queueing.")
    try:
        amount = Decimal(raw_amount.replace("₹", "").replace(",", "").strip())
    except InvalidOperation:
        raise ValueError("Invoice amount must be numeric.")
    if not amount.is_finite() or amount <= 0:
        raise ValueError("Invoice amount must be positive.")
    required = ["pickDoc", "invoiceDoc", "einvoiceDoc"]
    if amount > Decimal("50000"):
        required.append("ebillDoc")
    missing = [key for key in required if key not in documents]
    if missing:
        raise ValueError("Missing required DataDoc attachment(s): " + ", ".join(missing))
    for kind in ("invoiceDoc", "einvoiceDoc", "ebillDoc"):
        if kind in documents:
            doc = documents[kind]
            if not str(doc["name"]).lower().endswith(".pdf"):
                raise ValueError(kind + " must be a confirmed PDF for DataDoc submission.")
            expected_prefix = str(doc["user_id"]) + "/" + str(process["id"]) + "/"
            if not str(doc["path"]).startswith(expected_prefix):
                raise ValueError("Document storage path does not match its verified process.")
    return {"process_no": number, "invoice_no": invoice, "amount": str(amount),
            "credit_type": credit, "has_ebill": amount > Decimal("50000")}

def any_confirmed_submission(db, job: dict) -> bool:
    res = db.table("oms_jobs").select("id").eq("process_id", job["process_id"]).eq(
        "job_type", "bill_submit").eq("status", "completed").neq(
        "id", job["id"]).limit(1).execute()
    return bool(res.data)

def download_document(db, doc: dict, destination: Path) -> str:
    # Never accept a path supplied by a browser command; only database-owned metadata.
    path = str(doc["path"])
    file_path = destination / (str(doc["kind"]) + ".pdf")
    contents = db.storage.from_("oms-documents").download(path)
    if not isinstance(contents, (bytes, bytearray)) or not contents.startswith(b"%PDF-"):
        raise ValueError("Saved " + str(doc["kind"]) + " is not a valid PDF.")
    file_path.write_bytes(contents)
    return str(file_path)

def execute_bill(db, job: dict, data_doc: DataDocAgent) -> tuple[bool, str]:
    # These checks happen BEFORE Selenium touches the office application.
    process = read_process(db, job)
    if any_confirmed_submission(db, job):
        raise ValueError("A previous DataDoc Bill Submit job is already completed. Verify in DataDoc; no duplicate submitted.")
    documents = lookup_documents(db, job)
    bill = validate_bill(process, documents)
    log.info("Processing approved DataDoc bill submit for Process %s, job %s", bill["process_no"], job["id"])
    with tempfile.TemporaryDirectory(prefix="pjs-datadoc-") as folder:
        root = Path(folder)
        invoice = download_document(db, documents["invoiceDoc"], root)
        einvoice = download_document(db, documents["einvoiceDoc"], root)
        ebill = download_document(db, documents["ebillDoc"], root) if bill["has_ebill"] else None
        # The legacy DataDoc adapter reuses an existing Dispatch transaction where
        # possible. It may still partially succeed. NEVER auto-retry a failure.
        result = data_doc.submit_bill(
            process_no=bill["process_no"], credit_type=bill["credit_type"],
            invoice_no=bill["invoice_no"], amount=bill["amount"],
            invoice_path=invoice, einvoice_path=einvoice, ebill_path=ebill
        )
    if result.success:
        return True, f"Confirmed DataDoc submission for Process {bill['process_no']}. {result.action}"
    return False, f"Process {bill['process_no']}: {result.error or 'DataDoc outcome uncertain'}. Check the real DataDoc record before retrying."

def main() -> int:
    validate_environment()
    db = create_client(SUPABASE_URL, SERVICE_KEY)
    agent = None
    log.info("Independent PJS OMS office worker started for one authorized user.")
    try:
        while True:
            try:
                if not LIVE:
                    heartbeat(db, "paused", note="Live execution disabled until office acceptance test.")
                    time.sleep(POLL_SECONDS)
                    continue
                if not office_datadoc_reachable():
                    heartbeat(db, "paused", note="DataDoc office network unavailable; queue preserved.")
                    time.sleep(max(POLL_SECONDS, 30))
                    continue
                heartbeat(db, "idle", note="Waiting for approved DataDoc Bill Submit jobs.")
                job = claim(db)
                if not job:
                    time.sleep(POLL_SECONDS)
                    continue
                heartbeat(db, "busy", job["id"], note="Approved DataDoc Bill Submit")
                if agent is None:
                    agent = DataDocAgent()
                try:
                    ok, message = execute_bill(db, job, agent)
                except Exception as exc:
                    ok = False
                    message = f"DataDoc needs review after a worker error: {type(exc).__name__}: {exc}"
                    log.exception("DataDoc job failed (no automatic retry): %s", job["id"])
                complete(db, job, ok, message)
                log.info("%s — job %s — %s", "COMPLETED" if ok else "REVIEW REQUIRED", job["id"], message[:160])
                if not ok:
                    agent.close()
                    agent = None
            except KeyboardInterrupt:
                raise
            except Exception:
                log.exception("Unexpected worker/queue error; no automatic retry of claimed jobs.")
                try:
                    heartbeat(db, "error", note="Worker/queue error; see local log.")
                except Exception:
                    pass
                if agent is not None:
                    try:
                        agent.close()
                    except Exception:
                        pass
                    agent = None
                time.sleep(max(POLL_SECONDS, 30))
    except KeyboardInterrupt:
        log.info("Office worker stopped by operator.")
        try:
            heartbeat(db, "offline", note="Stopped by operator")
        except Exception:
            pass
        return 0
    finally:
        if agent is not None:
            try:
                agent.close()
            except Exception:
                pass

if __name__ == "__main__":
    sys.exit(main())
