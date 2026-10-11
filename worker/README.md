# Independent PJS OMS — Windows Login DataDoc Worker

The independent website stays hosted on Vercel. DataDoc submissions stay safely queued in **independent Supabase** when the office PC is switched off. After Windows sign-in, Task Scheduler starts a dedicated Python worker. The worker connects to the private office DataDoc website, claims approved jobs, submits one bill at a time, and writes outcomes and notifications back to Supabase.

**This worker handles only \`bill_submit\` jobs.** Tracking, delivery-proof and Outlook adapters are separate projects. No PC is required for cloud OCR, Excel, AI chat or tasks.

## Important: Website cannot launch Python

Browser security prevents opening the PJS website from directly starting an arbitrary local Python program. Install \`install_autostart.ps1\` once as the actual office Windows user. Windows Task Scheduler will then start the worker on Windows **sign-in**, whether or not the browser is open. Selenium normally requires that user to remain signed in with an interactive desktop. Do not run it as SYSTEM.

## What was changed safely

- \`oms_jobs.office_execution\` defaults to \`manual\` for all old rows. No old/past job becomes auto-executable by migration.
- Clicking **Approve & queue for office PC** on a bill-ready process creates a **new, approved \`auto_on_login\`** job for that account.
- Database RPC \`oms_claim_approved_office_bill\` claims at most one queued job atomically. No two workers can claim the same job.
- The independent worker uses \`oms_processes\`, \`oms_documents\` and private \`oms-documents\` storage, **not the old** \`shipments\` / \`automation_jobs\` / \`pjs-process-documents\`.
- It validates Process No., party, SO No., credit category, positive amount, original Pick Slip, Invoice PDF, E-Invoice PDF and E-Way Bill PDF if **amount exceeds ₹50,000** before opening DataDoc.
- Outcomes are stored with \`oms_finish_approved_office_bill\` in one transaction, with an audit entry, a PJS in-app notification and an automatic move to **Email to Client** only on confirmed success.
- **Any failure or uncertain/partially completed submission is NOT automatically retried.** Check the real DataDoc process first; only then manually queue another job if required.
- Status heartbeat appears in **DataDoc → DataDoc pending submission queue**.

## One-time office PC setup (Windows 10/11)

1. Log in to the Windows account that is authorized to access DataDoc. Confirm that \`http://192.168.0.18:8082\` (or the office's actual DataDoc URL) loads on this PC while connected to the office network.
2. Install Python 3.12+ and Google Chrome (the existing Python 3.13 is supported). In the independent project's GitHub repository, download the \`worker\` directory (download the repository ZIP if needed), and extract it to a permanent folder, such as \`C:\PJS\OMS-Worker\`.
3. Open **PowerShell** in that folder and run:
   \`& "C:\Path\To\python.exe" -m pip install -r requirements.txt\`
4. Copy \`.env.example\` to \`.env\`:
   \`Copy-Item .env.example .env\`
5. Edit **only the local** \`.env\`, supplying:
   - \`SUPABASE_SERVICE_ROLE_KEY\`: **independent OMS** Supabase server-only key, directly from the independent Supabase dashboard. Never paste it in chat, GitHub, browser or screenshots.
   - \`PJS_OFFICE_OWNER_USER_ID\`: UUID for the OMS user who will queue bills. Find the UID under **Supabase → Authentication → Users**.
   - \`PJS_DATADOC_URL\`, \`PJS_DATADOC_USERNAME\` and \`PJS_DATADOC_PASSWORD\`: the working private office connection and authorized account.
   - Keep **\`PJS_ENABLE_LIVE_DATADOC=0\`** during the first configuration check.
6. Run the worker manually with live execution paused:
   \`& "C:\Path\To\python.exe" .\independent_worker.py\`
   Check **DataDoc → pending submission queue**. It should show **Worker connected · paused**. Logs are kept locally in \`logs\datadoc-worker.log\`. Press Ctrl+C to stop.
7. **Before enabling real actions**, select ONE known safe bill process; check DataDoc manually and confirm it has not already been submitted. On the website select **Approve & queue for office PC**. The job must show **Waiting for office PC**.
8. Once the office operator has verified the DataDoc account, uploaded document mapping and the test process, set \`PJS_ENABLE_LIVE_DATADOC=1\` in the local \`.env\`, then run the worker manually. Observe the actual DataDoc session and confirm the single test outcome and uploaded documents **inside DataDoc**.
9. After that single supervised test succeeds, install automatic Windows sign-in startup:
   \`powershell -NoProfile -ExecutionPolicy Bypass -File .\install_autostart.ps1 -PythonExe "C:\Path\To\python.exe"\`
   The command registers a per-user Task Scheduler task: **PJS OMS DataDoc Worker**.
10. At your next Windows sign-in, Task Scheduler starts \`independent_worker.py\`. It waits for office DataDoc to be reachable, polls approved pending bill jobs and runs them sequentially. The PJS browser may be open or closed.

## Stop, troubleshoot, uninstall

- **Pause execution:** set \`PJS_ENABLE_LIVE_DATADOC=0\` and restart the worker; new approved bills remain queued. If already submitting, wait for the current DataDoc operation to finish; do not close Chrome mid-submit.
- **Inspect status:** DataDoc → Pending Submission Queue or \`logs\datadoc-worker.log\`.
- **Remove startup task:** \`powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall_autostart.ps1\` (does not delete cloud jobs, documents or secrets).
- **Network inaccessible:** worker remains paused and leaves jobs queued. Check office VPN/Wi-Fi and DataDoc itself.
- **Status remains RUNNING after a crash:** DO NOT manually reset to queued until the exact DataDoc transaction has been checked. Failed/uncertain submits may have partly succeeded.
- **Office worker remains offline:** Task Scheduler must run only when the target Windows user is signed in; check Python executable path and logs. Chrome/DataDoc may require an unlocked desktop.
- **User ownership:** this worker only claims jobs from \`PJS_OFFICE_OWNER_USER_ID\`; work queued by other users remains pending until a worker is registered for them.

No machine has been configured just by committing these files to GitHub. Only installing the scheduled task on the real Windows PC enables auto-start.

## Security notes

The \`.env\` must not be committed. The repository's \`.gitignore\` excludes \`.env\`. Keep the independent Supabase project isolated from legacy systems. A service-role key has broad database permissions: store it only on the trusted office PC in a protected directory, rotate it if exposed, and ideally migrate to a limited-scope worker credential later. Workstations can be disabled by pausing or removing the task; job history remains in Supabase.
