"""PJS OMS PC-free Python worker.

Runs on scheduled GitHub Actions standard Ubuntu runners (free-first), or an
optional future Cloud Run Job. Claims only READ-ONLY process audit/PDF jobs from
oms_cloud_jobs. Never invokes DataDoc, Outlook or carrier submissions.
A privileged database credential must be injected from the host's secret store;
the worker must never be called from a public browser with that credential.
"""
from __future__ import annotations

import io
import logging
import os
import re
import sys
from datetime import datetime, timezone

from supabase import create_client
from analysis import process_audit, extract_fields, combine_suggestions

log = logging.getLogger("pjs-cloud-worker")
logging.basicConfig(level=logging.INFO,format="%(asctime)s %(levelname)s %(message)s")
EXPECTED_SUPABASE = "https://tbkytdktututiyeoqkwa.supabase.co"
NAME = os.environ.get("PJS_CLOUD_WORKER_NAME","pjs-cloud-readonly").strip()
MAX_JOBS = max(1,min(int(os.environ.get("PJS_MAX_JOBS","6")),12))
MAX_PDF_BYTES = 5 * 1024 * 1024
MAX_PAGES = 4
MAX_DOCUMENTS = 5
PROCESS_COLUMNS = "id,user_id,team_id,process_no,party_name,sales_order_no,data,deleted_at"


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def environment():
    url = os.environ.get("SUPABASE_URL","").rstrip("/")
    token = (os.environ.get("SUPABASE_SECRET_KEY") or
             os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if url != EXPECTED_SUPABASE:
        raise RuntimeError("Cloud worker refuses unknown Supabase project")
    if not token:
        raise RuntimeError("SUPABASE_SECRET_KEY missing from private worker environment secret")
    if not 3 <= len(NAME) <= 80 or not re.fullmatch(r"[A-Za-z0-9_-]+",NAME):
        raise RuntimeError("Invalid cloud worker name")
    return url,token


def heartbeat(db,status: str,job_id: str|None=None,details: str=""):
    db.table("oms_cloud_workers").upsert({
        "worker_name":NAME,"status":status,"last_seen_at":timestamp(),
        "last_job_id":job_id,"version":"1","details":{"note":details[:160]}
    }).execute()


def fetch_process(db,job: dict) -> dict:
    rows = db.table("oms_processes").select(PROCESS_COLUMNS).eq(
        "id",job["process_id"]).eq("process_no",job["process_no"]).is_(
        "deleted_at","null").limit(1).execute().data or []
    if len(rows)!=1:
        raise ValueError("Process missing, deleted or number changed")
    return rows[0]


def fetch_documents(db,process_id: str) -> list[dict]:
    rows = db.table("oms_documents").select(
        "id,user_id,process_id,kind,name,path,created_at"
    ).eq("process_id",process_id).order("created_at",desc=True).limit(60).execute().data or []
    return rows


def read_doc(db,doc: dict,process: dict) -> tuple[str,str,int]:
    path = str(doc["path"])
    # The source must be an authentic private PJS process attachment.
    prefix = str(doc["user_id"])+"/"+str(process["id"])+"/"
    if str(doc["process_id"])!=str(process["id"]) or not path.startswith(prefix):
        raise ValueError("Document owner/process/path mismatch")
    name = str(doc.get("name") or "")
    if not name.lower().endswith((".pdf",".png",".jpg",".jpeg",".webp")):
        raise ValueError("Unsupported document format")
    data = db.storage.from_("oms-documents").download(path)
    if not isinstance(data,(bytes,bytearray)) or not data or len(data)>MAX_PDF_BYTES:
        raise ValueError("Document must be a non-empty file of 5 MB or less")
    if name.lower().endswith(".pdf"):
        if not data.startswith(b"%PDF-"):
            raise ValueError("Document is not a PDF")
        import pymupdf
        pdf = pymupdf.open(stream=data,filetype="pdf")
        try:
            if pdf.needs_pass:
                raise ValueError("Password-protected PDF cannot be read automatically")
            page_count = min(MAX_PAGES,len(pdf))
            blocks = []
            used_ocr = False
            for index in range(page_count):
                page=pdf[index]
                plain=page.get_text("text",sort=True) or ""
                if len(plain.strip())<90:
                    from PIL import Image
                    import pytesseract
                    pix = page.get_pixmap(matrix=pymupdf.Matrix(1.6,1.6),alpha=False)
                    with Image.open(io.BytesIO(pix.tobytes("png"))) as photo:
                        plain=pytesseract.image_to_string(photo,lang="eng")
                    used_ocr=True
                blocks.append(plain[:80000])
            return "\n".join(blocks),("OCR + PDF text" if used_ocr else "PDF text"),page_count
        finally:
            pdf.close()
    from PIL import Image
    import pytesseract
    with Image.open(io.BytesIO(data)) as image:
        if image.width*image.height>24_000_000:
            raise ValueError("Image too large for safe OCR")
        image.verify()
    with Image.open(io.BytesIO(data)) as image:
        text=pytesseract.image_to_string(image,lang="eng")
    return text[:80000],"Image OCR",1


def analyze_documents(db,process: dict,docs: list[dict]) -> dict:
    selected = []
    kinds = {"invoiceDoc","einvoiceDoc","ebillDoc","lrDoc"}
    for doc in docs:
        if doc["kind"] not in kinds:
            continue
        if any(row["kind"]==doc["kind"] for row in selected):
            continue
        selected.append(doc)
        if len(selected)>=MAX_DOCUMENTS:
            break
    if not selected:
        raise ValueError("No saved Invoice, E-Invoice, E-Way Bill or LR attachment exists")
    findings: list[dict] = []
    for doc in selected:
        row={"kind":doc["kind"],"name":str(doc.get("name") or "")[:120]}
        try:
            text,method,pages=read_doc(db,doc,process)
            row.update({"fields":extract_fields(text,str(doc["kind"])),"method":method,
                        "pages_scanned":pages,"needs_review":True})
            if not row["fields"]:
                row["warning"]="No reliably labelled fields found. Review the original PDF."
        except Exception as exc:
            # Report the file failure but continue with remaining documents.
            row["error"]=f"{type(exc).__name__}: {str(exc)[:180]}"
        findings.append(row)
    combined=combine_suggestions(findings)
    if all(row.get("error") for row in findings):
        raise ValueError("No saved document could be read; check files and formats")
    return {"kind":"document_extract","process_no":process["process_no"],
            "documents":findings,
            "files_read":sum(1 for row in findings if not row.get("error")),
            **combined}


def perform(db,job: dict) -> dict:
    if job.get("job_type") not in ("process_audit","document_extract"):
        raise ValueError("Unsupported or potentially unsafe cloud job")
    process=fetch_process(db,job)
    docs=fetch_documents(db,process["id"])
    if job["job_type"]=="process_audit":
        return process_audit(process,docs)
    return analyze_documents(db,process,docs)


def main()->int:
    try:
        url,key=environment()
        db=create_client(url,key)
        heartbeat(db,"idle",details="Ready for read-only cloud jobs")
    except Exception:
        log.exception("Cloud worker startup failed; check private runner credentials and independent database access")
        return 2
    attempts=0
    errors=0
    for index in range(MAX_JOBS):
        try:
            claimed=db.rpc("oms_cloud_claim",{"p_worker":NAME}).execute().data or []
            if not claimed:
                break
            job=claimed[0]
        except Exception:
            log.exception("Unable to atomically claim cloud job")
            errors+=1
            break
        job_id=str(job["id"])
        attempts+=1
        try:
            heartbeat(db,"busy",job_id,f"Running {job['job_type']}")
            result=perform(db,job)
            db.rpc("oms_cloud_complete",{
                "p_job":job_id,"p_worker":NAME,"p_success":True,
                "p_result":result,"p_error":None
            }).execute()
            log.info("Read-only cloud job completed id=%s type=%s",job_id,job["job_type"])
        except Exception as exc:
            errors+=1
            log.exception("Read-only cloud job failed id=%s",job_id)
            try:
                db.rpc("oms_cloud_complete",{
                    "p_job":job_id,"p_worker":NAME,"p_success":False,
                    "p_result":{},"p_error":f"{type(exc).__name__}: {str(exc)[:300]}"
                }).execute()
            except Exception:
                # Leave a claimed job as RUNNING for administrator review.
                # Do NOT claim again or mark completed without a DB confirmation.
                log.exception("Cloud job completion could not be saved: %s",job_id)
    try:
        heartbeat(db,"idle",details=f"Processed {attempts} read-only jobs; {errors} errors")
    except Exception:
        log.exception("Cloud worker heartbeat could not be saved")
        return 1
    log.info("Cloud Run execution finished jobs=%s errors=%s",attempts,errors)
    return 0 if errors==0 else 1


if __name__=="__main__":
    sys.exit(main())
