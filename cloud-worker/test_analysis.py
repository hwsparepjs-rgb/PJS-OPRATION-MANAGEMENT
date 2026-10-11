import unittest
from analysis import extract_fields, process_audit, combine_suggestions


class CloudWorkerTests(unittest.TestCase):
    def test_process_audit(self):
        process={"process_no":"292168","party_name":"Sample Buyer","sales_order_no":"26271016",
                 "data":{"invoice":"2627/946","amount":"6431.00","credit":"Credit","stage":"DataDoc"}}
        docs=[{"kind":k} for k in ("pickDoc","invoiceDoc","einvoiceDoc")]
        result=process_audit(process,docs)
        self.assertTrue(result["ready_for_bill_review"])
        self.assertEqual(result["source_documents_count"],3)
        self.assertEqual(result["bill_missing"],[])
        expensive={**process,"data":{**process["data"],"amount":"50001"}}
        self.assertFalse(process_audit(expensive,docs)["ready_for_bill_review"])
        self.assertTrue(any("E-Way" in x for x in process_audit(expensive,docs)["bill_missing"]))
        threshold={**process,"data":{**process["data"],"amount":"50000"}}
        self.assertTrue(process_audit(threshold,docs)["ready_for_bill_review"])
        self.assertFalse(process_audit({"process_no":"292168","party_name":"Buyer","sales_order_no":"","data":{}},[])["ready_for_bill_review"])

    def test_invoice_values(self):
        text=("Tax Invoice No: 2627/946 Invoice Date: 10-Oct-2026 "
              "Grand Total: 6,431.00 Purchase Order No: PO/445 "
              "Purchase Order Date: 08-Oct-2026 Payment Terms: Net 30 Days")
        fields=extract_fields(text,"invoiceDoc")
        self.assertEqual(fields["invoice"],"2627/946")
        self.assertEqual(fields["invoiceDate"],"2026-10-10")
        self.assertEqual(fields["amount"],"6431.00")
        self.assertEqual(fields["po"],"PO/445")
        self.assertEqual(fields["poDate"],"2026-10-08")
        self.assertEqual(fields["payment"],"Net 30 Days")

    def test_doc_categories(self):
        self.assertEqual(extract_fields("AWB No: MARUTI-123456","lrDoc")["lr"],"MARUTI-123456")
        self.assertEqual(extract_fields("E-Way Bill No: 123456789012","ebillDoc")["ebill"],"123456789012")
        self.assertEqual(extract_fields("IRN: "+("a"*64),"einvoiceDoc")["einvoice"],"a"*64)
        self.assertEqual(extract_fields("Invoice Number 946","pickDoc"),{})
        self.assertEqual(extract_fields("99999999 20000 10-Oct-2026","invoiceDoc"),{})

    def test_conflicts_not_auto_selected(self):
        candidates=combine_suggestions([
            {"name":"Invoice A.pdf","fields":{"invoice":"946","amount":"6431"}},
            {"name":"Invoice B.pdf","fields":{"invoice":"947","amount":"6431"}}
        ])
        self.assertNotIn("invoice",candidates["suggested_fields"])
        self.assertEqual(len(candidates["conflicts"]["invoice"]),2)
        self.assertEqual(candidates["suggested_fields"]["amount"],"6431")

if __name__ == "__main__":
    unittest.main()
