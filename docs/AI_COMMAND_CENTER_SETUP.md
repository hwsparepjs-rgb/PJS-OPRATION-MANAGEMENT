# PJS OMS — AI Command Center

Production: https://pjs-oms-independent-pjsspare098-2655.vercel.app/

This replaces **Pending Task Review** with an account-private command center. The old PJS Delivery Control and AppDeploy sites are unchanged.

## What works immediately (without an external AI API key)

- Chat interface with persistent private conversation history in \`oms_agent_messages\` (protected by Supabase RLS)
- Explicit text commands to create tasks, schedule reminders, list/complete pending tasks, find a Process No., and summarize *loaded* records
- A workflow-stage change for **Email to Client** or **Dispatch Tracking**, with **explicit confirmation** before saving, and existing permission/exception rules
- Persistent \`oms_agent_tasks\` across phone and desktop browsers for the same authenticated account
- A Supabase \`pg_cron\` job creates due notifications every minute; \`oms_agent_notifications\` persists these until viewed and marked read
- Unread alerts in the topbar, reminder panel, and browser notifications **only when the site is open and the user has allowed browser notifications**
- Public web-search fallback link if AI browsing is not configured, without claiming the internet has been searched by the assistant

Supported command examples:

\`\`\`
create task Follow up Process 292168
remind me to call customer tomorrow at 9am
remind me to review Process 292168 in 2 hours
show my pending tasks
show overdue tasks
complete task 1
find process 292168
summarize my operations
move process 292168 to Email
search web for India logistics updates
\`\`\`

Use an explicit time for reminders: "tomorrow at 9am", "in 2 hours", or "on 2026-10-15 at 10:30". Ambiguous dates prompt for clarification. Clock times use the browser's local timezone.

## Enable real natural-language AI answers and web browsing

The protected Supabase Edge Function \`pjs-agent\` is deployed to project \`tbkytdktututiyeoqkwa\`, with \`verify_jwt=true\`.

1. Obtain your own OpenAI API key from the OpenAI developer platform. ChatGPT subscription access is **not** the same as OpenAI API billing. Enable billing as appropriate.
2. Go to [Supabase Edge Function Secrets](https://supabase.com/dashboard/project/tbkytdktututiyeoqkwa/settings/functions).
3. Add the secret **OPENAI_API_KEY** with its private value. Never put it in a Vite environment variable, the browser, the public GitHub repository, or this chat.
4. Optionally add **OPENAI_MODEL** with an API model allowed by your account; the function defaults to \`gpt-5-mini\`.
5. Refresh PJS OMS. The AI Command Center should show "AI + Web Ready" once the Edge Function reads the secret.
6. Ask a normal question, or type "search web for ...". The Edge Function uses OpenAI's Responses API and its built-in web search tool, returns any available source URLs, and never grants the model direct writes to PJS records.

Notes:
- An AI answer can be mistaken. Verify any important information or instructions.
- Only a minimal loaded-process summary, plus one explicitly referenced process's core status (if requested), is sent as context. Document file bytes, API keys, and full customer databases are not supplied by the assistant.
- Model responses are **not** allowed to execute hidden tools. Task creation, task completion, and confirmed stage changes are implemented as restricted OMS commands, not unconstrained AI tool calls.
- Server-side API usage can cost money; monitor your API billing and usage.

## Known limits — not yet implemented

- Sending Outlook email, changing DataDoc bills or submitting to carriers still requires the office worker, which is currently **offline**.
- The agent does not control a Windows PC or navigate arbitrary websites using a cloud browser; OpenAI web search summarizes public web information after a key is provided.
- Browser notifications are displayed only while the website is running with permission. **Offline phone push**, Android notifications while Chrome is closed, and SMS/WhatsApp/email alert delivery are **not** configured.
- \`pg_cron\` creates in-app notification records even if the website is closed. They can be viewed when the user next signs in. Cron is scheduled once per minute.
- Team-shared task lists, recurring tasks, tasks with attachments, and autonomous background agents have not been built.

## Safe acceptance tests

1. Log into the **independent** PJS OMS with Google.
2. In AI Command Center, type \`create task Follow up Process 292168\` and verify it appears in the Tasks panel and survives refresh.
3. Type \`remind me to test the notification in 2 minutes\`. Wait until due and check the bell badge and Notifications tab. Enable browser notifications only with explicit permission.
4. Type \`find process 292168\`, verify its stage against Data Store, and use Open Process.
5. Type \`move process 292168 to Email\`; confirm the stage does **not** change before the Confirm button. Only confirm on a safe test process.
6. Ask \`search web for ...\`; without the API key expect a Google search link, **not a fabricated live answer**.
7. Confirm another signed-in account cannot read these tasks/messages/alerts due to RLS. Test this with non-customer sample data.

Keep the GitHub repository private. Do not paste or commit API keys, Supabase service keys, customer documents, or passwords.
