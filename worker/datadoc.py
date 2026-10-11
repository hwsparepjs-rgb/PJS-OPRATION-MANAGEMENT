import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from selenium import webdriver
from selenium.common.exceptions import WebDriverException
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select


@dataclass
class DataDocResult:
    success: bool
    action: str
    error: Optional[str] = None
    skipped: bool = False
    next_work: Optional[str] = None
    next_user: Optional[str] = None


class DataDocAgent:
    """
    Combined DataDoc tracking-proof submitter.

    Source behavior preserved from:
      - MOD_DATADOC_CREDIT.bas
      - modDataDocNonCreditSubmit.bas

    Credit:
      Work / Time         = Original Doc. And Mtrl Rcvd. Conf. - India GST
      Next Required Work  = Credit
      Next Response User  = Sales Person mapped to DataDoc user

    Non-Credit:
      Deepa  -> Close - Client Spares -> Deepa Bisht
      Ankita -> Close - Client - Pump (fallback Close - Client Pump)
                -> Ankita Dahake
      Other sales people are skipped, matching the VBA behavior.
    """

    WORK_NAME = "Original Doc. And Mtrl Rcvd. Conf. - India GST"

    def __init__(self):
        self.url = os.getenv("PJS_DATADOC_URL", "http://192.168.0.18:8082").strip()
        self.username = os.getenv("PJS_DATADOC_USERNAME", "").strip()
        self.password = os.getenv("PJS_DATADOC_PASSWORD", "").strip()
        self.headless = os.getenv("PJS_DATADOC_HEADLESS", os.getenv("PJS_HEADLESS", "0")) == "1"
        self.page_load_timeout = int(os.getenv("PJS_PAGELOAD_TIMEOUT", "35"))
        self.chrome_profile = os.getenv("PJS_DATADOC_CHROME_PROFILE", "").strip()
        self.driver: Optional[webdriver.Chrome] = None

    def close(self):
        if self.driver:
            try:
                self.driver.quit()
            except Exception:
                pass
        self.driver = None

    @staticmethod
    def _normalize(value: str) -> str:
        value = (value or "").strip().upper()
        for ch in [" ", "-", ".", ",", "'", "/", "\\", "(", ")"]:
            value = value.replace(ch, "")
        return value

    @staticmethod
    def _xpath_literal(value: str) -> str:
        if "'" not in value:
            return f"'{value}'"
        if '"' not in value:
            return f'"{value}"'
        pieces = value.split("'")
        return "concat(" + ", \"'\", ".join(f"'{p}'" for p in pieces) + ")"

    @staticmethod
    def _first_name(sales_person: str) -> str:
        clean = (sales_person or "").strip()
        if "(" in clean:
            clean = clean.split("(", 1)[0].strip()
        return (clean.split() or [""])[0]

    @classmethod
    def _is_deepa(cls, sales_person: str) -> bool:
        return "DEEPA" in (sales_person or "").upper()

    @classmethod
    def _is_ankita(cls, sales_person: str) -> bool:
        return "ANKITA" in (sales_person or "").upper()

    @staticmethod
    def _is_non_credit(credit_type: str) -> bool:
        normalized = re.sub(r"[^a-z]", "", (credit_type or "").lower())
        return "noncredit" in normalized or normalized.startswith("non")

    def _new_driver(self):
        options = webdriver.ChromeOptions()
        if self.headless:
            options.add_argument("--headless=new")
        options.add_argument("--start-maximized")
        options.add_argument("--disable-notifications")
        options.add_argument("--disable-popup-blocking")
        options.add_argument("--no-default-browser-check")
        if self.chrome_profile:
            options.add_argument(f"--user-data-dir={self.chrome_profile}")

        driver = webdriver.Chrome(options=options)
        driver.set_page_load_timeout(self.page_load_timeout)
        try:
            driver.maximize_window()
        except Exception:
            pass
        return driver

    def _default_content(self):
        if self.driver:
            self.driver.switch_to.default_content()

    def _exists(self, by: By, value: str) -> bool:
        try:
            return bool(self.driver and self.driver.find_elements(by, value))
        except Exception:
            return False

    def _wait_exists(self, by: By, value: str, timeout: float, interval: float = 0.1) -> bool:
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if self._exists(by, value):
                return True
            time.sleep(interval)
        return False

    def _search_ready(self, timeout: float = 10.0) -> bool:
        try:
            self._default_content()
        except Exception:
            pass
        return self._wait_exists(By.ID, "txtGlobalProcessNo", timeout)

    def ensure_started(self) -> bool:
        if self.driver:
            try:
                if self._search_ready(1.0):
                    return True
            except Exception:
                self.close()

        if not self.username or not self.password:
            raise RuntimeError(
                "DataDoc credentials are missing. Set PJS_DATADOC_USERNAME and PJS_DATADOC_PASSWORD in worker/.env."
            )

        self.close()
        self.driver = self._new_driver()
        self.driver.get(self.url)
        time.sleep(1.8)

        # If a reused Chrome profile already has a valid session, do not log in again.
        if self._search_ready(1.0):
            return True

        try:
            username = self.driver.find_element(By.ID, "txtUserName")
            password = self.driver.find_element(By.ID, "txtPassword")
            login = self.driver.find_element(By.ID, "btnLogin")
        except Exception:
            return False

        username.clear()
        username.send_keys(self.username)
        password.clear()
        password.send_keys(self.password)
        login.click()
        time.sleep(2.5)

        return self._search_ready(15.0)

    def _open_process(self, process_no: str) -> bool:
        self._default_content()
        try:
            search = self.driver.find_element(By.ID, "txtGlobalProcessNo")
            search.click()
            search.clear()
            search.send_keys(process_no)
        except Exception:
            return False

        process_result = None
        xpath = (
            "//ul[contains(@class,'ui-autocomplete')]"
            "//div[contains(@class,'ui-menu-item-wrapper')]"
            f"[contains(normalize-space(.),{self._xpath_literal(process_no)})]"
        )

        end = time.monotonic() + 3.0
        while time.monotonic() < end:
            try:
                matches = self.driver.find_elements(By.XPATH, xpath)
                if matches:
                    process_result = matches[0]
                    break
            except Exception:
                pass
            time.sleep(0.1)

        if process_result is None:
            return False

        try:
            process_result.click()
        except Exception:
            try:
                self.driver.execute_script("arguments[0].click();", process_result)
            except Exception:
                return False

        time.sleep(0.9)
        return self._wait_exists(By.CSS_SELECTOR, "#spanAddTransactions a", 4.0)


    def _find_dispatch_row_add_docs(self, work_name: str):
        """Find the Dispatch transaction row and its Add Docs (+) link."""
        self._default_content()
        wanted = self._normalize(work_name)

        rows = self.driver.find_elements(By.XPATH, "//tr")
        for row in rows:
            try:
                row_text = self._normalize(row.text or "")
                if wanted not in row_text:
                    continue

                links = row.find_elements(
                    By.XPATH,
                    ".//a[@title='Add Docs'] | .//a[.//i[contains(@class,'fa-plus-square-o')]]",
                )
                if links:
                    return links[-1]
            except Exception:
                continue

        return None

    def _open_add_docs_for_dispatch(self, work_name: str) -> bool:
        """Click the + Add Docs action belonging to the Dispatch transaction."""
        end = time.monotonic() + 8.0
        while time.monotonic() < end:
            link = self._find_dispatch_row_add_docs(work_name)
            if link is not None:
                try:
                    self.driver.execute_script(
                        "arguments[0].scrollIntoView({block:'center'});",
                        link,
                    )
                    time.sleep(0.15)
                    try:
                        link.click()
                    except Exception:
                        self.driver.execute_script("arguments[0].click();", link)
                    return True
                except Exception:
                    pass
            time.sleep(0.2)

        return False

    def _close_docs_modal(self):
        """Close the Add Docs window after its Submit finishes."""
        self._default_content()
        for selector in ["#btnCloseframe", "#myModal .close-button"]:
            try:
                matches = self.driver.find_elements(By.CSS_SELECTOR, selector)
                if matches:
                    try:
                        matches[0].click()
                    except Exception:
                        self.driver.execute_script(
                            "arguments[0].click();",
                            matches[0],
                        )
                    time.sleep(0.5)
                    return
            except Exception:
                pass

        try:
            matches = self.driver.find_elements(
                By.XPATH,
                "//button[@id='btnCloseframe'] | //span[normalize-space()='Close']",
            )
            if matches:
                try:
                    matches[0].click()
                except Exception:
                    self.driver.execute_script("arguments[0].click();", matches[0])
                time.sleep(0.5)
        except Exception:
            pass

    def _add_document_to_process(self, document_path: str, work_name: str) -> bool:
        """
        Add one document through the process row's Add Docs (+).

        Sequence:
          Add Docs (+) -> Choose File -> Submit -> confirm file ->
          Close modal.

        On retry, if the same filename already exists in the Add Docs list,
        it is not uploaded a second time.
        """
        path = Path(document_path)
        if not path.is_file():
            raise RuntimeError(f"Additional document not found: {path}")

        if not self._open_add_docs_for_dispatch(work_name):
            raise RuntimeError(
                f"Add Docs (+) action not found for {work_name}"
            )

        # Add Docs is an iframe with its own document list.
        end = time.monotonic() + 12.0
        frame_ready = False
        while time.monotonic() < end:
            try:
                self._default_content()
                frame = self._find_modal_frame()
                if frame is not None:
                    self.driver.switch_to.frame(frame)
                    if self._exists(By.ID, "cphContent_fileAttachment1"):
                        frame_ready = True
                        break
                self._default_content()
            except Exception:
                try:
                    self._default_content()
                except Exception:
                    pass
            time.sleep(0.15)

        if not frame_ready:
            raise RuntimeError("Add Docs form did not open")

        try:
            body_text = (
                self.driver.find_element(By.TAG_NAME, "body").text or ""
            ).casefold()

            if path.name.casefold() in body_text:
                self._default_content()
                self._close_docs_modal()
                return True

            file_box = self.driver.find_element(
                By.ID,
                "cphContent_fileAttachment1",
            )
            file_box.send_keys(str(path.resolve()))
            time.sleep(0.25)

            submit = self.driver.find_element(
                By.ID,
                "cphContent_btnSubmit",
            )
            self.driver.execute_script(
                "arguments[0].scrollIntoView({block:'center'});",
                submit,
            )
            time.sleep(0.15)
            submit.click()

            end = time.monotonic() + 20.0
            confirmed = False
            while time.monotonic() < end:
                try:
                    page_text = (
                        self.driver.find_element(By.TAG_NAME, "body").text
                        or ""
                    ).casefold()
                    if path.name.casefold() in page_text:
                        confirmed = True
                        break
                except Exception:
                    pass
                time.sleep(0.25)

            self._default_content()
            if not confirmed:
                self._close_docs_modal()
                raise RuntimeError(
                    f"DataDoc did not confirm Add Docs upload: {path.name}"
                )

            self._close_docs_modal()
            self._search_ready(8.0)
            return True
        except Exception:
            try:
                self._default_content()
                self._close_docs_modal()
            except Exception:
                pass
            raise
    def _click_add(self) -> bool:
        self._default_content()
        end = time.monotonic() + 5.0
        while time.monotonic() < end:
            add_button = None
            try:
                matches = self.driver.find_elements(
                    By.CSS_SELECTOR,
                    "#spanAddTransactions a.bmd-modalButton.btn.btn-primary",
                )
                if matches:
                    add_button = matches[0]
            except Exception:
                pass

            if add_button is None:
                try:
                    matches = self.driver.find_elements(
                        By.XPATH,
                        "//span[@id='spanAddTransactions']//a[normalize-space()='Add']",
                    )
                    if matches:
                        add_button = matches[0]
                except Exception:
                    pass

            if add_button is not None:
                try:
                    self.driver.execute_script(
                        "arguments[0].scrollIntoView({block:'center'});",
                        add_button,
                    )
                    time.sleep(0.1)
                    add_button.click()
                except Exception:
                    try:
                        self.driver.execute_script("arguments[0].click();", add_button)
                    except Exception:
                        return False
                return True
            time.sleep(0.1)
        return False

    def _find_modal_frame(self):
        self._default_content()
        for selector in ["#myModal iframe", "iframe.embed-responsive-item"]:
            try:
                matches = self.driver.find_elements(By.CSS_SELECTOR, selector)
                if matches:
                    return matches[0]
            except Exception:
                pass
        return None

    def _switch_transaction_frame(self, timeout: float = 10.0) -> bool:
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            try:
                frame = self._find_modal_frame()
                if frame is not None:
                    self.driver.switch_to.frame(frame)
                    if self._exists(By.ID, "cphContent_ddlWork"):
                        return True
                self._default_content()
            except Exception:
                try:
                    self._default_content()
                except Exception:
                    pass
            time.sleep(0.1)
        return False

    def _reenter_frame(self, wait_for_id: str, timeout: float = 10.0) -> bool:
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            try:
                frame = self._find_modal_frame()
                if frame is not None:
                    self.driver.switch_to.frame(frame)
                    if self._exists(By.ID, wait_for_id):
                        return True
                self._default_content()
            except Exception:
                try:
                    self._default_content()
                except Exception:
                    pass
            time.sleep(0.1)
        return False

    def _select_dropdown(self, element_id: str, wanted_text: str) -> bool:
        try:
            select_box = self.driver.find_element(By.ID, element_id)
            options = select_box.find_elements(By.TAG_NAME, "option")
            wanted = self._normalize(wanted_text)

            for option in options:
                actual_text = (option.text or "").strip()
                actual = self._normalize(actual_text)
                if actual == wanted or wanted in actual:
                    Select(select_box).select_by_visible_text(actual_text)
                    time.sleep(0.35)
                    return True
        except Exception:
            return False
        return False

    def _clear_users(self):
        boxes = self.driver.find_elements(
            By.CSS_SELECTOR,
            "#cphContent_chkNextUser input[type='checkbox'], #cphContent_Panel1 input[type='checkbox']",
        )
        for box in boxes:
            try:
                if box.is_selected():
                    try:
                        box.click()
                    except Exception:
                        self.driver.execute_script("arguments[0].click();", box)
            except Exception:
                pass

    def _select_only_user(self, user_name: str) -> bool:
        try:
            self._clear_users()
            label_xpath = f"//label[normalize-space()={self._xpath_literal(user_name)}]"
            label = self.driver.find_element(By.XPATH, label_xpath)
            input_id = (label.get_attribute("for") or "").strip()
            if not input_id:
                return False

            required = self.driver.find_element(By.ID, input_id)
            if not required.is_selected():
                try:
                    required.click()
                except Exception:
                    self.driver.execute_script("arguments[0].click();", required)

            if not required.is_selected():
                return False

            # VBA safety pass: make sure no other user remains selected.
            boxes = self.driver.find_elements(
                By.CSS_SELECTOR,
                "#cphContent_chkNextUser input[type='checkbox']",
            )
            for box in boxes:
                try:
                    if (box.get_attribute("id") or "") != input_id and box.is_selected():
                        try:
                            box.click()
                        except Exception:
                            self.driver.execute_script("arguments[0].click();", box)
                except Exception:
                    pass

            return required.is_selected()
        except Exception:
            return False

    def _select_credit_salesperson(self, sales_person: str):
        if not self._exists(By.ID, "cphContent_chkNextUser"):
            return False, None

        clean_name = (sales_person or "").strip()
        if "(" in clean_name:
            clean_name = clean_name.split("(", 1)[0].strip()
        first_name = (clean_name.split() or [""])[0]

        known = {
            "ANKITA": "Ankita Dahake",
            "DEEPA": "Deepa Bisht",
            "ABHI": "Abhi Shah",
        }
        preferred = known.get(first_name.upper(), clean_name)

        try:
            self._clear_users()
            labels = self.driver.find_elements(
                By.CSS_SELECTOR,
                "#cphContent_chkNextUser label",
            )

            selected_label = None
            selected_input_id = None

            # Same order as VBA: preferred exact, cleaned Excel exact, first-name match.
            for target in [preferred, clean_name]:
                if not target:
                    continue
                for label in labels:
                    label_text = (label.text or "").strip()
                    if label_text.casefold() == target.casefold():
                        selected_label = label_text
                        selected_input_id = (label.get_attribute("for") or "").strip()
                        break
                if selected_input_id:
                    break

            if not selected_input_id and first_name:
                for label in labels:
                    label_text = (label.text or "").strip()
                    if (
                        label_text.casefold() == first_name.casefold()
                        or label_text.casefold().startswith(first_name.casefold() + " ")
                    ):
                        selected_label = label_text
                        selected_input_id = (label.get_attribute("for") or "").strip()
                        break

            if not selected_input_id:
                return False, None

            required = self.driver.find_element(By.ID, selected_input_id)
            if not required.is_selected():
                try:
                    required.click()
                except Exception:
                    self.driver.execute_script("arguments[0].click();", required)

            return required.is_selected(), selected_label
        except Exception:
            return False, None

    def _attach_file(self, full_path: str) -> bool:
        path = Path(full_path)
        if not path.is_file():
            return False
        try:
            file_box = self.driver.find_element(By.ID, "cphContent_fileAttachment1")
            self.driver.execute_script(
                "arguments[0].scrollIntoView({block:'center',inline:'nearest'});",
                file_box,
            )
            time.sleep(0.15)
            file_box.send_keys(str(path.resolve()))
            time.sleep(0.3)
            return True
        except Exception:
            return False

    def _click_submit(self) -> bool:
        submit = None
        try:
            matches = self.driver.find_elements(
                By.XPATH,
                "//button[translate(normalize-space(.),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ')='SUBMIT']",
            )
            if matches:
                submit = matches[0]
        except Exception:
            pass

        if submit is None:
            try:
                matches = self.driver.find_elements(
                    By.XPATH,
                    "//input[@type='submit' and translate(normalize-space(@value),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ')='SUBMIT']",
                )
                if matches:
                    submit = matches[0]
            except Exception:
                pass

        if submit is None:
            return False

        try:
            self.driver.execute_script(
                "arguments[0].scrollIntoView({block:'center'});",
                submit,
            )
            time.sleep(0.15)
            submit.click()
            return True
        except Exception:
            try:
                self.driver.execute_script("arguments[0].click();", submit)
                return True
            except Exception:
                return False

    def _wait_for_submission(self, timeout: float = 15.0) -> bool:
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            try:
                self._default_content()
                if not self.driver.find_elements(By.CSS_SELECTOR, "#myModal.show"):
                    return True
            except Exception:
                pass
            time.sleep(0.15)
        return False

    def _close_modal(self):
        try:
            self._default_content()
        except Exception:
            return

        try:
            matches = self.driver.find_elements(By.CSS_SELECTOR, "#myModal .close-button")
            if matches:
                matches[0].click()
        except Exception:
            pass

        try:
            matches = self.driver.find_elements(By.XPATH, "//*[normalize-space()='Close']")
            if matches:
                matches[0].click()
        except Exception:
            pass

    def _retry_reset(self):
        try:
            self._default_content()
            self._close_modal()
            self.driver.refresh()
            time.sleep(0.9)
        except Exception:
            pass


    def _set_text(self, element_id: str, value: str) -> bool:
        try:
            box = self.driver.find_element(By.ID, element_id)
            box.click()
            box.clear()
            box.send_keys(str(value or ""))
            return True
        except Exception:
            return False

    def _click_submit_by_id(self) -> bool:
        try:
            button = self.driver.find_element(By.ID, "cphContent_btnSubmit")
            self.driver.execute_script("arguments[0].scrollIntoView({block:'center'});", button)
            time.sleep(0.15)
            button.click()
            return True
        except Exception:
            return self._click_submit()


    def submit_bill(
        self,
        process_no: str,
        credit_type: str,
        invoice_no: str,
        amount: str,
        invoice_path: str,
        einvoice_path: Optional[str] = None,
        ebill_path: Optional[str] = None,
    ) -> DataDocResult:
        """
        Complete DataDoc Bill Submit workflow.

        New/recovery-safe behavior:
          - Search Process No.
          - If Dispatch transaction already exists, reuse it.
          - Otherwise create the Dispatch transaction.
          - Submit Invoice in the initial transaction.
          - Add Docs (+) -> E-Invoice -> Submit -> Close.
          - If Amount > Rs. 50,000:
                Add Docs (+) -> E-Bill -> Submit -> Close.
          - Keep DataDoc open for the next queued Bill Submit.
        """
        process_no = (process_no or "").strip()
        invoice_no = (invoice_no or "").strip()
        amount = str(amount or "").strip()
        invoice_path = (invoice_path or "").strip()
        einvoice_path = (einvoice_path or "").strip()
        ebill_path = (ebill_path or "").strip()

        if not process_no:
            return DataDocResult(False, "DataDoc bill submit blocked", "Process No. is required")
        if not invoice_no:
            return DataDocResult(False, "DataDoc bill submit blocked", "Invoice No. is required")
        if not amount:
            return DataDocResult(False, "DataDoc bill submit blocked", "Amount is required")
        if not Path(invoice_path).is_file():
            return DataDocResult(False, "DataDoc bill submit blocked", "Invoice attachment is required")
        if not einvoice_path or not Path(einvoice_path).is_file():
            return DataDocResult(False, "DataDoc bill submit blocked", "E-Invoice attachment is required")

        try:
            numeric_amount = float(
                re.sub(r"[^0-9.]", "", amount) or "0"
            )
        except ValueError:
            return DataDocResult(False, "DataDoc bill submit blocked", "Amount is not numeric")

        require_ebill = numeric_amount > 50000

        if require_ebill and (
            not ebill_path or not Path(ebill_path).is_file()
        ):
            return DataDocResult(
                False,
                "DataDoc bill submit blocked",
                "E-Bill attachment is required for amount above Rs. 50,000",
            )

        is_non_credit = self._is_non_credit(credit_type)
        work_name = (
            "Dispatch - Non Credit"
            if is_non_credit
            else "Dispatch - Credit"
        )

        try:
            if not self.ensure_started():
                raise RuntimeError("Unable to login/open DataDoc")

            if not self._open_process(process_no):
                raise RuntimeError("Process No. not found/opened")

            # Recovery rule:
            # if the Dispatch transaction is already present, do NOT create it again.
            dispatch_link = self._find_dispatch_row_add_docs(work_name)

            if dispatch_link is None:
                if not self._click_add():
                    raise RuntimeError("Add button not found")

                if not self._switch_transaction_frame():
                    raise RuntimeError("Add/Edit form did not open")

                if not self._select_dropdown(
                    "cphContent_ddlWork",
                    work_name,
                ):
                    raise RuntimeError(
                        f"{work_name} not found in Work / Time"
                    )

                self._default_content()
                if not self._reenter_frame(
                    "cphContent_txtExtraField",
                    10.0,
                ):
                    # Some ASP.NET postbacks rebuild the frame.
                    if not self._reenter_frame(
                        "cphContent_txtExtraField",
                        10.0,
                    ):
                        raise RuntimeError(
                            "Bill fields did not load after selecting Work / Time"
                        )

                if is_non_credit:
                    mapping = {
                        "cphContent_txtExtraField": invoice_no,
                        "cphContent_txtExtraField_2": amount,
                        "cphContent_txtExtraField_3": "yes",
                    }
                else:
                    mapping = {
                        "cphContent_txtExtraField": "yes",
                        "cphContent_txtExtraField_2": invoice_no,
                        "cphContent_txtExtraField_3": amount,
                    }

                for field_id, value in mapping.items():
                    if not self._set_text(field_id, value):
                        raise RuntimeError(f"{field_id} not found")

                if not self._select_dropdown(
                    "cphContent_ddlNextWork",
                    "Disp. Detail Send To Client",
                ):
                    self._default_content()
                    if not self._reenter_frame(
                        "cphContent_ddlNextWork",
                        8.0,
                    ):
                        raise RuntimeError(
                            "Next Required Work dropdown not found"
                        )
                    if not self._select_dropdown(
                        "cphContent_ddlNextWork",
                        "Disp. Detail Send To Client",
                    ):
                        raise RuntimeError(
                            "Disp. Detail Send To Client not found"
                        )

                self._default_content()
                if not (
                    self._reenter_frame(
                        "cphContent_chkNextUser",
                        4.0,
                    )
                    or self._reenter_frame(
                        "cphContent_Panel1",
                        8.0,
                    )
                ):
                    raise RuntimeError(
                        "Next Response User list not found"
                    )

                if not self._select_only_user("Vivek Pal"):
                    raise RuntimeError("Vivek Pal not found")

                if not self._attach_file(invoice_path):
                    raise RuntimeError(
                        "Invoice attachment input not found"
                    )

                if not self._click_submit_by_id():
                    raise RuntimeError("Submit button not found")

                if not self._wait_for_submission(
                    timeout=20.0
                ):
                    raise RuntimeError(
                        "Initial Bill Submit did not complete"
                    )

            # At this point the Dispatch transaction exists.
            # E-Invoice is always added via the transaction's + Add Docs action.
            self._default_content()
            self._search_ready(8.0)
            if not self._add_document_to_process(
                einvoice_path,
                work_name,
            ):
                raise RuntimeError(
                    "E-Invoice Add Docs submission failed"
                )

            # E-Bill is added through a SECOND fresh Add Docs (+) modal.
            if require_ebill:
                self._default_content()
                self._search_ready(8.0)
                if not self._add_document_to_process(
                    ebill_path,
                    work_name,
                ):
                    raise RuntimeError(
                        "E-Bill Add Docs submission failed"
                    )

            self._default_content()
            self._search_ready(8.0)

            return DataDocResult(
                True,
                "DataDoc Bill Submit Complete",
                next_work="Disp. Detail Send To Client",
                next_user="Vivek Pal",
            )

        except (RuntimeError, WebDriverException) as exc:
            return DataDocResult(
                False,
                "DataDoc bill submission failed",
                str(exc) or "Submission failed - retry required",
                next_work="Disp. Detail Send To Client",
                next_user="Vivek Pal",
            )
        except Exception as exc:
            return DataDocResult(
                False,
                "DataDoc bill submission failed",
                str(exc) or "Submission failed - retry required",
                next_work="Disp. Detail Send To Client",
                next_user="Vivek Pal",
            )


    def submit_tracking_proof(
        self,
        process_no: str,
        credit_type: str,
        sales_person: str,
        attachment_path: str,
    ) -> DataDocResult:
        process_no = (process_no or "").strip()
        sales_person = (sales_person or "").strip()

        if not process_no:
            return DataDocResult(False, "DataDoc tracking submit blocked", "Process No. is required")

        is_non_credit = self._is_non_credit(credit_type)

        # Preserve the VBA rule: unsupported Non-Credit sales people are completely ignored.
        if is_non_credit and not (self._is_deepa(sales_person) or self._is_ankita(sales_person)):
            return DataDocResult(
                True,
                f"Skipped unsupported Non-Credit salesperson: {sales_person or 'blank'}",
                skipped=True,
            )

        if not Path(attachment_path).is_file():
            return DataDocResult(
                False,
                "DataDoc tracking submit blocked",
                f"Attachment not found for Process No. {process_no}",
            )

        try:
            if not self.ensure_started():
                return DataDocResult(False, "Unable to login/open DataDoc", "DataDoc global search did not load")
        except Exception as exc:
            return DataDocResult(False, "Unable to login/open DataDoc", str(exc))

        last_error = None
        last_next_work = None
        last_next_user = None

        for attempt in range(1, 3):
            try:
                if not self._search_ready(10.0):
                    last_error = "DataDoc global search not available"
                    raise RuntimeError(last_error)

                if not self._open_process(process_no):
                    last_error = "Process No. not found/opened"
                    raise RuntimeError(last_error)

                if not self._click_add():
                    last_error = "Add button not found"
                    raise RuntimeError(last_error)

                if not self._switch_transaction_frame():
                    last_error = "Add/Edit form did not open"
                    raise RuntimeError(last_error)

                if not self._select_dropdown("cphContent_ddlWork", self.WORK_NAME):
                    last_error = f"{self.WORK_NAME} not found"
                    raise RuntimeError(last_error)

                if not self._reenter_frame("cphContent_ddlNextWork"):
                    last_error = "Next Required Work did not load"
                    raise RuntimeError(last_error)

                if not is_non_credit:
                    last_next_work = "Credit"
                    if not self._select_dropdown("cphContent_ddlNextWork", last_next_work):
                        last_error = "Credit not found in Next Required Work"
                        raise RuntimeError(last_error)

                    if not self._reenter_frame("cphContent_chkNextUser"):
                        last_error = "Next Response User list did not load"
                        raise RuntimeError(last_error)

                    ok, selected_user = self._select_credit_salesperson(sales_person)
                    if not ok:
                        last_error = f"Sales Person not found in DataDoc: {sales_person}"
                        raise RuntimeError(last_error)
                    last_next_user = selected_user

                elif self._is_deepa(sales_person):
                    last_next_work = "Close - Client Spares"
                    last_next_user = "Deepa Bisht"

                    if not self._select_dropdown("cphContent_ddlNextWork", last_next_work):
                        last_error = "Close - Client Spares not found"
                        raise RuntimeError(last_error)

                    if not self._reenter_frame("cphContent_chkNextUser"):
                        last_error = "Next Response User list did not load"
                        raise RuntimeError(last_error)

                    if not self._select_only_user(last_next_user):
                        last_error = "Deepa Bisht not found"
                        raise RuntimeError(last_error)

                elif self._is_ankita(sales_person):
                    last_next_work = "Close - Client - Pump"
                    last_next_user = "Ankita Dahake"

                    if not self._select_dropdown("cphContent_ddlNextWork", last_next_work):
                        if not self._select_dropdown("cphContent_ddlNextWork", "Close - Client Pump"):
                            last_error = "Close - Client - Pump not found"
                            raise RuntimeError(last_error)
                        last_next_work = "Close - Client Pump"

                    if not self._reenter_frame("cphContent_chkNextUser"):
                        last_error = "Next Response User list did not load"
                        raise RuntimeError(last_error)

                    if not self._select_only_user(last_next_user):
                        last_error = "Ankita Dahake not found"
                        raise RuntimeError(last_error)

                if not self._attach_file(attachment_path):
                    last_error = "Unable to attach Process No. file"
                    raise RuntimeError(last_error)

                if not self._click_submit():
                    last_error = "Submit button not found"
                    raise RuntimeError(last_error)

                if not self._wait_for_submission():
                    last_error = "Submit did not complete"
                    raise RuntimeError(last_error)

                return DataDocResult(
                    True,
                    "Tracking proof submitted to DataDoc",
                    next_work=last_next_work,
                    next_user=last_next_user,
                )

            except (RuntimeError, WebDriverException) as exc:
                last_error = str(exc) or last_error or "Submission failed - retry required"
            except Exception as exc:
                last_error = str(exc) or "Submission failed - retry required"

            if attempt < 2:
                self._retry_reset()

        return DataDocResult(
            False,
            "Tracking proof submission failed",
            last_error or "Submission failed - retry required",
            next_work=last_next_work,
            next_user=last_next_user,
        )
