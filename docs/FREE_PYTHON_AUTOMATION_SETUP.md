# PJS Operations — Free Python Automation (NO Google Cloud billing)

**Current free-first architecture**

- Vercel: the existing PJS OMS website (keep current plan; subject to its plan limits)
- Independent Supabase: existing private processes, attachments, read-only cloud job queue, and notifications (subject to plan limits)
- **GitHub Actions:** standard GitHub-hosted Ubuntu runners execute the Python code from `cloud-worker/` hourly, even with the office computer off.

Google Cloud Run, Google billing, Secret Manager, and Cloud Scheduler **are not required** to start this option. Do not enter payment information simply for this worker.

The new `hwsparepjs-rgb/PJS-OPRATION-MANAGEMENT` repository is currently **PUBLIC**, so ordinary standard GitHub-hosted Actions runtime is free according to GitHub's billing docs. Public code is visible to everyone, but properly configured GitHub environment secrets are not publicly readable. Do NOT commit real customer PDFs, credentials, .env files or database exports. For private production code, consider switching the repository to **PRIVATE**: GitHub Free includes 2,000 standard Linux minutes per month, which can be exhausted. To avoid unintended payment on private repositories, set a strict Actions spending budget with **Stop usage when budget limit is reached** (and never attach billing if you do not want charges).

## What's ready, but OFF until you enable it

- Workflow: `.github/workflows/pjs-free-cloud-worker.yml`
- Frequency: `23 * * * *` (approximately once an hour, UTC, not a guaranteed execution time).
- Worker: `cloud-worker/main.py`
- Secrets: read through environment variable `SUPABASE_SECRET_KEY` supplied only by GitHub Actions environment secrets.
- Bounded work: at most six read-only jobs per execution; `15` minute job timeout.
- Database: `oms_cloud_jobs` (never touches the office's `oms_jobs` DataDoc queue).
- Commands from **AI Command Center**: `audit process 292168`, `extract pdf for process 292168`, and `show cloud jobs`.

## One-time activation (GitHub website, not your office PC)

**Only an authorized owner of this GitHub repository should perform these steps.** Use a desktop or Android browser signed into the GitHub account that owns the PJS repository.

### 1. Create a dedicated GitHub environment

1. Open: https://github.com/hwsparepjs-rgb/PJS-OPRATION-MANAGEMENT/settings/environments
2. Choose **New environment**, enter exactly `production-cloud-readonly`, and click Configure environment.
3. Under **Environment secrets**, choose **Add secret**.
4. **Name:** `PJS_OMS_SUPABASE_WORKER_KEY`
5. **Value:** get the independent Supabase **server-side secret key**, by navigating privately to https://supabase.com/dashboard/project/tbkytdktututiyeoqkwa/settings/api-keys. Use the secret backend key supported by your account, not the public publishable/anon key. This key has powerful database permissions; do not send it in ChatGPT, paste it into a public issue, screenshot it, or commit it to GitHub.
6. If supported, limit environment deployment branches to the protected **main** branch, but do not enable required manual approvals if you expect scheduled jobs to run while unattended.

GitHub Actions alone can read the environment secret when the scheduled job runs on `main`. It cannot be read by the frontend or ordinary visitors.

### 2. Enable the free scheduler

1. Open https://github.com/hwsparepjs-rgb/PJS-OPRATION-MANAGEMENT/settings/variables/actions
2. Add **New repository variable**:
   - Name: `PJS_FREE_WORKER_ENABLED`
   - Value: `true`
3. Save. This switches on the previously disabled scheduled worker. Leave it absent or change it to `false` to pause future runs.

### 3. Test safely with one harmless process

1. Open https://pjs-oms-independent-pjsspare098-2655.vercel.app/
2. Sign in, then open **AI Command Center → Cloud Automation**.
3. Enter the Process No. for one saved test record and select **Run process audit**. Or type `audit process 292168` in the chat if that process belongs to your account.
4. Open the GitHub **Actions** tab:
   https://github.com/hwsparepjs-rgb/PJS-OPRATION-MANAGEMENT/actions/workflows/pjs-free-cloud-worker.yml
5. Select **PJS Free Cloud Python Worker → Run workflow → Run workflow** to trigger a manual test immediately (or wait for the next hourly run).
6. Review the GitHub workflow run log without exposing credentials and check that the job finished successfully.
7. Refresh PJS **Cloud Automation**. The job should show **Completed** with read-only findings, and an in-app notification should appear.

If the Actions tab says **Enable workflows**, enable GitHub Actions in repository settings first. If a run is skipped, check `PJS_FREE_WORKER_ENABLED` is exactly `true`. If it fails due to missing credentials, check the **environment secret**, not a repository secret with a different name. You never need to provide any password or key in this conversation.

### 4. Pause it, stop usage, or avoid billing

- **Pause worker:** set `PJS_FREE_WORKER_ENABLED=false` in GitHub repository variables. Future scheduled runs will be skipped before a GitHub runner starts.
- **Disable entirely:** visit GitHub Actions → the worker workflow → `...` → **Disable workflow**.
- **Private repository:** check Actions quotas at https://github.com/settings/billing and configure a product budget with **Stop usage when budget limit is reached**; this prevents paid overages if applicable.
- GitHub may delay or skip scheduled executions; in public repositories scheduled workflows may be disabled after **60 days of no repository activity**.
- The runner stops after jobs finish. It is **not** a permanently running server, cloud browser, or continuous AI agent.

## Free-first limitations

| Capability | Free-first status |
|---|---|
| Run Python without office PC | Prepared; active only after GitHub environment secret + enable variable |
| PDF text extraction with OCR | Python worker implemented; outputs for manual review |
| Process audit & missing-field check | Implemented |
| In-app notifications of finished jobs | Implemented |
| Continuous 24/7 agent making decisions | Not implemented |
| Real-time updates every few seconds | Not supported by hourly GitHub schedule |
| Outlook email sends | Not implemented in free cloud worker; needs authorized external connector |
| Live carrier-tracking integrations | Need official APIs or authorized access; external provider may cost money |
| DataDoc bill submissions | Still use the separate office-PC queue; private network cannot be reached from GitHub-hosted runner |

**Security boundaries:** The free cloud worker runs only `process_audit` and `document_extract` jobs. It cannot be triggered to send client emails or submit DataDoc bills. It only reads PDF documents from the existing private Supabase Storage and writes the derived review results to the private job record and notifications.

**The worker is present in the new GitHub repository, but the scheduler has not been activated.** Production execution starts only after the owner configures the GitHub secret, enables the variable and verifies one test.

Official reference: https://docs.github.com/en/billing/concepts/product-billing/github-actions
