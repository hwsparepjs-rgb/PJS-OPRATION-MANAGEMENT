"""Pure, local-testable, read-only business analysis for PJS cloud automation.

No network access and no mutations occur here. All suggestions must be reviewed
by a user before being copied to any production process.
"""
from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from datetime import datetime

DOC_KINDS = ("pickDoc", "invoiceDoc", "einvoiceDoc", "ebillDoc", "lrDoc")
MAX_FIELDS_PER_DOCUMENT = 12
MAX_OUTPUT_TEXT = 150


def _get(process: dict, key: str) -> str:
    return str((process.get("data") or {}).get(key) or "").strip()


def _format_amount(text: str) -> Decimal | None:
    try:
        amount = Decimal(text.replace(",", "").replace("₹", "").strip())
        return amount if amount.is_finite() and amount > 0 else None
    except (ValueError, InvalidOperation):
        return None


def process_audit(process: dict, documents: list[dict]) -> dict:
    """Report missing fields and bill readiness, not a permission to submit."""
    kind_set = {str(row.get("kind") or "") for row in documents}
    process_no = str(process.get("process_no") or "").strip()
    party = str(process.get("party_name") or "").strip()
    so = str(process.get("sales_order_no") or "").strip()
    amount = _format_amount(_get(process, "amount"))
    base_missing: list[str] = []
    if not re.fullmatch(r"\d{5,9}", process_no):
        base_missing.append("Valid Process No.")
    if not party:
        base_missing.append("Party Name")
    if not re.fullmatch(r"\d{6,12}", so):
        base_missing.append("Valid Sales Order No.")
    if "pickDoc" not in kind_set:
        base_missing.append("Original Pick Slip")
    bill_missing = list(base_missing)
    if not _get(process, "invoice"):
        bill_missing.append("Invoice No.")
    if _get(process, "credit") not in ("Credit", "Non Credit"):
        bill_missing.append("Credit / Non-Credit")
    if amount is None:
        bill_missing.append("Positive invoice amount")
    if "invoiceDoc" not in kind_set:
        bill_missing.append("Invoice PDF")
    if "einvoiceDoc" not in kind_set:
        bill_missing.append("E-Invoice PDF")
    if amount is not None and amount > Decimal("50000") and "ebillDoc" not in kind_set:
        bill_missing.append("E-Way Bill PDF (amount above ₹50,000)")
    return {
        "kind": "process_audit",
        "process_no": process_no,
        "stage": _get(process, "stage") or "Universal Process",
        "documents_found": sorted(kind_set),
        "source_documents_count": len(documents),
        "basic_missing": base_missing,
        "bill_missing": bill_missing,
        "ready_for_bill_review": not bill_missing,
        "note": "Read-only report. Passing checks does not submit a bill or prove DataDoc acceptance.",
    }


def _date(value: str) -> str:
    token = value.strip().replace(".", "-").replace("/", "-")
    for fmt in ("%d-%m-%Y", "%Y-%m-%d", "%d-%b-%Y", "%d-%B-%Y", "%d-%m-%y"):
        try:
            return datetime.strptime(token, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return ""


def _label(text: str, labels: list[str], pattern: str, max_width: int = 50) -> str:
    value_pattern = re.compile(pattern, re.IGNORECASE)
    for label in labels:
        expr = re.compile(r"\b(?:" + label + r")\s*[:#.\-=]?\s*", re.IGNORECASE)
        for match in expr.finditer(text[:100000]):
            rest = text[match.end():match.end() + max_width].lstrip()
            item = value_pattern.match(rest)
            if item:
                return item.group(1).strip().rstrip(",:;")
    return ""


def extract_fields(text: str, kind: str) -> dict[str, str]:
    """Conservative labelled-value extraction. Do not infer IDs from unlabelled numbers."""
    flattened = re.sub(r"\s+", " ", text.replace("\u00a0", " ")).strip()
    fields: dict[str, str] = {}
    if kind not in ("invoiceDoc", "einvoiceDoc", "ebillDoc", "lrDoc"):
        return fields
    invoice = _label(flattened,
        [r"(?:Tax\s+)?Invoice\s*(?:No\.?|Number|#)", r"Inv\.?\s*(?:No\.?|#)"],
        r"([A-Za-z0-9][A-Za-z0-9/._-]{0,49})(?:\b|$)")
    if invoice and re.search(r"\d", invoice):
        fields["invoice"] = invoice
    if kind == "invoiceDoc":
        inv_date = _date(_label(flattened,
            [r"Invoice\s*(?:Date|Dt\.?)", r"Inv\.?\s*(?:Date|Dt\.?)"],
            r"(\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}[-/.]\w{3,9}[-/.]\d{2,4})"))
        if inv_date:
            fields["invoiceDate"] = inv_date
        amount = _label(flattened,
            [r"Grand\s+Total", r"Total\s+Invoice\s+(?:Amount|Value)",
             r"Invoice\s+(?:Amount|Value)", r"Net\s+Amount\s+Payable"],
            r"([0-9][0-9,]*(?:\.[0-9]{1,2})?)")
        if _format_amount(amount) is not None:
            fields["amount"] = amount.replace(",", "")
        po = _label(flattened,
            [r"(?:Customer'?s?\s+)?Purchase\s+Order\s*(?:No\.?|Number|#)",
             r"(?:Customer'?s?\s+)?P\.?\s*O\.?\s*(?:No\.?|Number|#)",
             r"Buyer'?s?\s+Order\s*(?:No\.?|Number|#)"],
            r"([A-Za-z0-9][A-Za-z0-9/._-]{1,49})(?:\b|$)")
        if po and re.search(r"\d", po):
            fields["po"] = po
        po_date = _date(_label(flattened,
            [r"Purchase\s+Order\s*(?:Date|Dt\.?)",
             r"P\.?\s*O\.?\s*(?:Date|Dt\.?)",
             r"Buyer'?s?\s+Order\s*(?:Date|Dt\.?)"],
            r"(\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}[-/.]\w{3,9}[-/.]\d{2,4})"))
        if po_date:
            fields["poDate"] = po_date
        payment = _label(flattened,
            [r"Payment\s+Terms", r"Terms\s+of\s+Payment", r"Credit\s+Terms"],
            r"((?:Net\s+|Credit\s+)?\d{1,3}\s+Days?|Advance|Prepaid|COD|Cash\s+on\s+Delivery|Immediate(?:ly)?)\b")
        if payment:
            fields["payment"] = payment[:MAX_OUTPUT_TEXT]
    if kind == "einvoiceDoc":
        irn = _label(flattened,[r"IRN",r"Invoice\s+Reference\s+Number"],r"([a-f0-9]{64})(?:\b|$)",70)
        if irn:
            fields["einvoice"] = irn
    if kind in ("einvoiceDoc", "invoiceDoc", "ebillDoc"):
        eway = _label(flattened,
            [r"E[\s-]*Way\s+Bill\s*(?:No\.?|Number|#)?",r"EWB\s*(?:No\.?|Number|#)"],
            r"(\d{10,15})(?:\b|$)")
        if eway:
            fields["ebill"] = eway
    if kind == "lrDoc":
        lr = _label(flattened,
            [r"L\.?\s*R\.?\s*(?:No\.?|Number|#)",
             r"Docket\s*(?:No\.?|Number|#)",
             r"Consignment\s+(?:Note\s+)?(?:No\.?|Number|#)",
             r"AWB\s*(?:No\.?|Number|#)"],
            r"([A-Za-z0-9][A-Za-z0-9/._-]{1,49})(?:\b|$)")
        if lr and re.search(r"\d", lr):
            fields["lr"] = lr
    return dict(list(fields.items())[:MAX_FIELDS_PER_DOCUMENT])


def combine_suggestions(documents: list[dict]) -> dict:
    """Keep conflicting PDF values visible; never choose between them silently."""
    by_key: dict[str, list[dict]] = {}
    for doc in documents:
        if doc.get("error"):
            continue
        for key, value in (doc.get("fields") or {}).items():
            entries = by_key.setdefault(str(key), [])
            if not any(entry["value"] == value for entry in entries):
                entries.append({"value": str(value)[:MAX_OUTPUT_TEXT], "document": doc.get("name", "")[:120]})
    safe = {key:entries[0]["value"] for key,entries in by_key.items() if len(entries) == 1}
    conflicts = {key:entries for key,entries in by_key.items() if len(entries)>1}
    return {"suggested_fields":safe, "conflicts":conflicts,
            "note":"Suggested values are read-only. Confirm against PDFs before editing master records."}
