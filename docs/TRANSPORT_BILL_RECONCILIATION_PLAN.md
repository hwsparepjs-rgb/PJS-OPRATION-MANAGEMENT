# Transport Bill Reconciliation — proposed architecture and current UI

**Independent website:** https://pjs-oms-independent-pjsspare098-2655.vercel.app/

The previous **Excel & LR Finder** page has been redesigned into a four-partner transport-bill review console, without touching the original PJS Delivery Control or existing OMS data.

## Transport partners

| Partner | Incoming source | Initial matching key | Current interface |
|---|---|---|---|
| TCI | One or more PDF bills/scans | LR / docket / consignment number | Separate PDF collector + LR review |
| V Express | One or more PDF bills/scans | LR / docket / consignment number | Separate PDF collector + LR review |
| Shree Maruti / Aram Transport | One or more PDF bills/scans | LR / docket / consignment number | Separate PDF collector + LR review |
| Bhuvan Bhai — local tempo | Manual local-trip information | Process No. | Draft manual trip list, no invented LR |

The user described **three PDF-bill groups** and one **local tempo partner**. The Shree Maruti / Aram name is treated as one combined group until sample bills clarify whether their formats should be separated.

## Matching and review

1. Collect bills by partner; each row retains its original PDF name and selected carrier.
2. Read labelled LR / tracking numbers using existing PDF text and OCR logic. Do not assume every detected number is a valid LR. The user reviews it.
3. Match each normalized LR exactly against the LR stored in the current authenticated user's visible PJS master process register.
4. Flag unmatched and ambiguous OMS LR matches and repeated LR references across bills, instead of silently assigning a process or double-counting charges.
5. Separately record Bhuvan Bhai trips by Process No., date, optional note and optional amount, and compare their Process Nos. against PJS records without requiring LR numbers.

**The current working review is browser-session only.** Selected bills and local tempo trip drafts are NOT written to Supabase. The original transport PDFs, sales records, and OMS processes are NOT modified. This avoids introducing incomplete billing data into production before the final schema is agreed.

The existing **Draft LR Review** Excel workbook remains available. It includes Summary, LR Review and Process Register sheets. Each LR Review row now retains the corresponding partner and source PDF description; the downloaded draft does not include Bhuvan Bhai trip amounts.

## Future billing workbook (wait for user's actual samples)

The user will share the actual **Excel output template**, courier PDF bills and separate **sales data**. Do not assume source column positions or invent monetary calculations before seeing them.

1. Parse carrier-specific PDF layouts for LR, bill reference, shipment date, process/sales reference, billable weight, amounts and taxes **only where those details are present**.
2. Import the user's sales data workbook, identify the exact sales matching key and format, then reconcile to OMS processes and courier bills.
3. Create a reviewed, auditable staging table with source provenance (file, PDF page, extracted field) and editable, user-confirmed exceptions.
4. For Bhuvan Bhai, map the user's actual local tempo trip/bill records and any applicable billing rules to the same staging table.
5. Populate the user's original Excel template in the same column order, formatting, formulas and worksheet naming. Preserve template formulas; never overwrite unconfirmed cells.
6. Add totals/exception checks: carrier subtotal versus bill, sales missing, LR not found, duplicate LR, unmatched local trip, amount difference and incomplete amounts as appropriate to the actual documents.
7. Only after approval, enable saved import batches, private attachments and reusable provider-specific mappings with RLS in the independent Supabase project. Do not automatically update DataDoc, invoices or carrier websites.

## Sample files needed to finish the actual reconciliation

- One representative TCI bill PDF (including LR/tracking section)
- One V Express bill PDF
- One Shree Maruti / Aram Transport bill PDF (ideally one of each if they are distinct companies)
- One example of Bhuvan Bhai's local trip/bill data
- The sales Excel sample that the courier bills must be compared to
- The exact desired **output Excel template** with its column headers and formulas

Once received, validate sample extraction against a few known rows, implement the carrier-specific parsing and template mapping, test reconciliation, then enable the final export.
