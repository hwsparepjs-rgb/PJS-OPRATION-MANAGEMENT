# PJS Operations — PC-independent Cloud Run worker (optional)

> **Free-first option is now available.** If you do not want to enable Google Cloud billing, **do not follow the Cloud Run steps below**. Use [FREE_PYTHON_AUTOMATION_SETUP.md](FREE_PYTHON_AUTOMATION_SETUP.md) to run the same safe Python worker on GitHub Actions standard runners instead. No Google Cloud project is necessary.

**Architecture:** Vercel React site → authenticated independent Supabase → \`oms_cloud_jobs\` → Google Cloud Run Job → read-only results and in-app notifications.

This cloud worker does **not** replace the office DataDoc worker yet. It never opens \`192.168.0.18:8082\`, logs into Outlook, or submits invoices to a third-party portal. The old DataDoc \`oms_jobs\` queue is unchanged.

## Current implementation

- \`supabase/migrations/018_cloud_automation_queue.sql\`: private per-user cloud jobs, authorized process checks, atomic claim RPC, safe result RPC, worker heartbeat. Status is queued until Cloud Run is connected.
- \`cloud-worker/main.py\`: bounded (max 12) Cloud Run execution, per-job exception logging, original records not modified.
- \`cloud-worker/analysis.py\`: process completeness review and conservative PDF field extraction.
- \`cloud-worker/Dockerfile\`: non-root Python 3.12 container, Tesseract OCR runtime, PyMuPDF.
- \`src/CloudAutomationPanel.tsx\`: mobile-friendly queue and results in **AI Command Center**, with read-only chat commands.

Supported exact chat commands:
- \`audit process 292168\`
- \`extract pdf for process 292168\`
- \`show cloud jobs\`

These requests do not run until Google Cloud is deployed and scheduled. Open **Cloud Automation** in the AI Command Center to view connectivity. The Supabase credential for the cloud worker must be stored only as a server secret.

## Connect a Google Cloud project

An owner of the intended Google Cloud project must perform the following one-time steps. The user must explicitly approve billing and any charges. The Google Cloud project is **not** automatically connected to this repository.

### 1. Create and enable a Google Cloud project

In https://console.cloud.google.com/ create or select a billing-enabled project, note its actual **Project ID**, and activate [Cloud Shell](https://shell.cloud.google.com/). Google Cloud charges depend on actual usage.

Set the project and region (the region is a proposed starting point near the India office, not a requirement):

\`\`\`bash
export PROJECT_ID="YOUR_REAL_GOOGLE_CLOUD_PROJECT_ID"
export REGION="asia-south1"
gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com cloudscheduler.googleapis.com secretmanager.googleapis.com
\`\`\`

### 2. Create the dedicated worker identity and secret

\`\`\`bash
gcloud iam service-accounts create pjs-oms-cloud-worker --display-name="PJS OMS safe cloud jobs"
export WORKER_SA="pjs-oms-cloud-worker@$PROJECT_ID.iam.gserviceaccount.com"
\`\`\`

Use Google Cloud **Secret Manager** in the console to create a secret named \`pjs-oms-supabase-secret\`, with the **independent** Supabase backend secret key in its value. Prefer a dedicated secret key over the legacy \`service_role\` JWT. Get it directly from https://supabase.com/dashboard/project/tbkytdktututiyeoqkwa/settings/api-keys.

Never put this value in this chat, Cloud Shell history, frontend files, GitHub, Vercel public variables, or screenshots.

Grant the worker identity read access to this *one* secret:

\`\`\`bash
gcloud secrets add-iam-policy-binding pjs-oms-supabase-secret \
  --member="serviceAccount:$WORKER_SA" \
  --role="roles/secretmanager.secretAccessor"
\`\`\`

### 3. Build the cloud Python image

In Cloud Shell:

\`\`\`bash
git clone https://github.com/pjsspare098-svg/PJS-OPRATION-MANAGEMENT.git
cd PJS-OPRATION-MANAGEMENT
gcloud artifacts repositories create pjs-oms-workers \
  --repository-format=docker --location="$REGION" \
  --description="Private PJS OMS cloud worker images"
gcloud builds submit ./cloud-worker \
  --tag "$REGION-docker.pkg.dev/$PROJECT_ID/pjs-oms-workers/cloud-worker:v1"
\`\`\`

If a repository already exists, omit the repository creation command. Google Cloud Build must have write permissions for the Artifact Registry repository, which might require a one-time IAM setting depending on project defaults.

### 4. Create the scheduled Cloud Run Job

\`\`\`bash
gcloud run jobs deploy pjs-oms-cloud-worker \
  --region="$REGION" \
  --image="$REGION-docker.pkg.dev/$PROJECT_ID/pjs-oms-workers/cloud-worker:v1" \
  --service-account="$WORKER_SA" \
  --set-env-vars="SUPABASE_URL=https://tbkytdktututiyeoqkwa.supabase.co,PJS_CLOUD_WORKER_NAME=pjs-cloud-readonly,PJS_MAX_JOBS=6" \
  --set-secrets="SUPABASE_SECRET_KEY=pjs-oms-supabase-secret:latest" \
  --tasks=1 --max-retries=0 --task-timeout=15m \
  --memory=2Gi --cpu=1
\`\`\`

This is a **job**, not a publicly accessible HTTP service; no unauthenticated endpoint is needed. It reads only \`process_audit\` and \`document_extract\` jobs. Job executions are intentionally non-retrying.

### 5. Test the cloud worker before scheduling

\`\`\`bash
gcloud run jobs execute pjs-oms-cloud-worker --region="$REGION" --wait
\`\`\`

Go to the PJS website → **AI Command Center → Cloud Automation**. The connection should show a recent worker heartbeat after a successful Cloud Run job. Queue **one known test process audit**, run the job once again, and verify the report before proceeding.

The real PJS records and PDFs are not modified by this first-stage worker.

### 6. Schedule the background cloud job

Use the Google Cloud console: **Cloud Run → Jobs → pjs-oms-cloud-worker → Triggers → Add Scheduler Trigger**. Configure an authenticated trigger with an authorized Google Cloud service account and a schedule such as:

\`\`\`
*/5 * * * *
\`\`\`

This is an *example* five-minute check. Adjust frequency for cost and workload. The Cloud Scheduler principal must be authorized to execute the job. The job's own service account only needs access to its Supabase secret. These are distinct roles.

Official Google documentation: https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule

## Known boundaries / future work

| Task | Cloud support |
|---|---|
| Process completeness checks | Implemented, read-only |
| Extraction of labelled values from stored PDFs | Implemented, read-only; OCR if PDF text missing |
| UI reports and notifications | Implemented in Supabase/Vercel |
| AI natural-language chat + public web research | Separate Supabase Edge Function; requires \`OPENAI_API_KEY\` for live use |
| Transport API monitoring | Future integration once approved carrier credentials/API are available |
| Outlook email sending | Future Microsoft Graph integration with explicit user authorization |
| DataDoc bill submission | **Office only today.** Requires secure access to private network / private remote application before migration |
| DataDoc office \`oms_jobs\` | Preserved and intentionally not processed by Cloud Run |

This split prevents an always-on cloud task from accidentally duplicating a bill submission. Once external integrations are confirmed, each can receive its own scoped connector, audit logs, rate limits, idempotency and approval gates.

## Security and troubleshooting

- Never place \`SUPABASE_SECRET_KEY\` in the browser. It bypasses Supabase RLS; grant only trusted Google service identities access to the secret.
- Verify the Cloud Run job actually has the \`SUPABASE_URL\` set to this exact independent OMS project. The worker refuses unknown projects.
- If the job remains **Waiting**, check Cloud Run → Jobs → executions and Cloud Logging, and Google Cloud Scheduler's execution history. The website cannot run the job until Google Cloud is connected.
- If a report is **Review needed**, check the original PDF. OCR can be wrong, and fields are never automatically applied.
- If a cloud run crashes after claiming a job, the job may remain Running for administrator review. No automatic retry is attempted.
- The original PJS Delivery Control repo and Supabase remain unchanged.
