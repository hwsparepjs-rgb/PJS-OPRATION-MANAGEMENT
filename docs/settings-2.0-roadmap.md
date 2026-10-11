# PJS Operations — Settings Control Center v2 implementation plan

Status: **Phase 1 prototype implemented on a feature branch; not merged to production.**
Project: `pjsspare098-svg/PJS-OPRATION-MANAGEMENT`
Target deployment: `pjs-oms-independent-pjsspare098-2655.vercel.app`
Backend: independent Supabase project `tbkytdktututiyeoqkwa` only.

## Non-negotiable invariants

1. Never modify the original PJS Delivery Control project or legacy Supabase.
2. Do not reset, overwrite, drop, or bulk-update existing OMS records. Existing identity, team authorization, private storage, and RLS must remain intact.
3. Preserve Data Store, DataDoc, Dispatch Tracking, Check List, Done Pick List albums, invoice/PDF extraction, login, team invitations, and historical CSV import.
4. Do not claim a job was executed because it was queued. The office PC worker is currently **not connected**.
5. No privileged keys or unredacted operational secrets in Vite/browser bundles. Changes to sensitive state require authorized server operations, not simply hidden UI.
6. Require source-aware human approval before overwriting invoice fields; Process No. OCR alone does not grant access to a document.
7. Changes only move from feature branch to production after verified build, automated regression, manual UAT, and reversible approval.
8. Maintain current dispatch defaults: E-Way Bill ₹50,000; re-track 3 days; reminders 10 days.

## Current verified backend (October 2026)

- `oms_preferences` persists the current three numeric rules per authenticated user.
- `oms_teams`, `oms_team_members`, and `oms_team_invites` already implement team membership and the roles **admin, operator, viewer**.
- `oms_jobs` records queued work but no active office-side job executor is connected.
- `oms_events` is the existing workflow audit event source.
- `oms_processes`, `oms_documents`, `oms_done_pick_albums`, and `oms_done_pick_photos` already support operational records and private attachments.
- Existing API code uses PDF.js and Tesseract, with exact Process No. review for Done Pick List linking.
- Historical CSV import exists in the previous Settings page and must remain accessible.

## UX information architecture

Layout: retain blue/navy PJS visual identity, responsive website sidebar and topbar.
Within Settings: contextual Settings navigation (horizontal on small screens); each category contains status, explanatory copy, actionable controls only if connected, and documented next-phase items.
Categories: Overview, Office Worker, Automation, Users & Roles, Dispatch Rules, PDF/OCR, Camera & Photos, Notifications, Backup & Recovery, Security & Audit, Appearance.

Status vocabulary:
- LIVE SETTINGS: connected end-to-end and has a real Save action
- EXISTING: links to an already implemented workflow
- MONITORING ONLY: reads current backend rows, no executor
- AWAITING SETUP / PLANNED: never represented as an active switch

### Phase 1 — Safe Settings foundation (implemented in feature branch)

Scope:
- Dedicated SettingsControlCenter React component and scoped CSS, with category navigation.
- Keep dispatch edit/save on existing `ops.updatePreferences`; use a local draft, validation and Discard before writing. Do not write when value invalid or in demo mode.
- Display actual process/job/event counts from the already loaded app state.
- Preserve TeamWorkspace under Users & Roles, HistoricalImport under Backup & Recovery, and links to Done Pick List / Audit / Pending Task Review.
- Add browser-local density preference only; it must never modify Supabase.
- No database migrations, key changes, worker commands, or modifications to existing customer data.

Acceptance:
- Login and demo both render Settings; demos cannot save preferences or access team/CSV import.
- Threshold 0..100,000,000, tracking/reminder whole days 1..90. Default configuration remains 50000/3/10.
- Save persists after refresh for authenticated users; Discard does not write.
- Existing team invitation, CSV import, navigation, and uploads still function.
- Desktop/mobile navigation, keyboard focus, contrast and long copy inspected.
- All existing build regression tests pass. Branch Vercel preview is READY. Final production release requires live UAT.

### Phase 2 — User administration and security

Implement only after Phase 1 acceptance.
- Reuse existing admin/operator/viewer policy, extend with a documented permission matrix for sensitive actions (manage team, invite, edit settings, queue job, view documents, export records).
- Gate state changes in Supabase/RLS or vetted RPCs; never trust a `role` string from the browser.
- Use current team membership tables. If a new settings record is required, propose **additive, versioned migrations** reviewed and approved before running them; back up metadata and test in a separate environment.
- Add security-setting event records with actor, target, old/new values (excluding secrets), timestamp, and request correlation ID.
- Test with separate admin/operator/viewer identities, including cross-team isolation and revocation. No automatic sharing of personal records.

Exit: unauthorized updates rejected at DB level; privileges tested on client and RPC, invite expiry and revocation working.

### Phase 3 — Worker control and automation

Architecture:
- Office Python 3.13 automation remains on the office PC. Start at Windows logon using a reviewed Task Scheduler task or service configured on that PC, not an insecure browser command.
- Introduce a narrowly scoped worker registration credential stored locally using appropriate Windows secret storage, and server verification.
- Worker polls or subscribes to jobs scoped to an authorized operator/team; updates a heartbeat and progress.
- Server-side queue claim must be atomic, with lease expiry and idempotency token. Existing `oms_jobs` queue records must never be re-run blindly.
- Implement pause new claims, worker status, failed job logs with sensitive data redacted, deliberate retry and cancel requests. Start/Stop is a remote **request**, not a claim that a disconnected PC was controlled.
- For DataDoc billing and customer email submission, store external submission identifiers. A partially successful action must be verified against DataDoc/Outlook before any retry.

Exit: test an inert job, then a mocked DataDoc job; verify claim, timeout, disconnect, resume, duplicate retry, authorization; only then pilot one approved real transaction.

### Phase 4 — Advanced dispatch

- Keep existing `oms_preferences` fields and effective behavior for every existing account.
- Add optional, separately versioned rules for late shipment alert lead time, transporter frequency, E-Way Bill validity warning, escalation tier, quiet hours, and holiday calendar.
- Validate ranges on both client and server, show preview of consequences on synthetic shipment data before activating.
- Explicit opt-in and rollback to existing rules. Account-specific vs team-level rule precedence must be documented and policy-enforced.

Exit: deterministic date/window tests including timezone Asia/Kolkata and calendar day boundaries; legacy 50000/3/10 tests unchanged.

### Phase 5 — OCR, invoice/PDF and camera configuration

- Keep PDF.js text/layout first, OCR fallback; compare source/confidence and require manual confirmation.
- Source-sensitive field mappings: Process No., Party Name, SO No., PO No., PO Date, Payment Terms, invoice ID/amount, LR and E-Way Bill.
- Add versioned vendor/template mappings with a safe test bench against non-production documents.
- Prevent overwriting a verified PO/invoice field from an unrelated document. Keep partial extraction on errors.
- Preserve Done Pick List multi-photo thumbnail/confirm flow, verified Process No. association, authenticated storage. Add compression and album-size options only when applied consistently to client/server/storage constraints.
- Do not add unwanted OCR Process No. controls to the Done Pick List completion flow.

Exit: varied digital and scanned sample PDFs, mislabeled invoices, different rotations, duplicate images, wrong Process No., partial extraction, offline/retry and private access tests.

### Phase 6 — Notifications

- Start with in-app queue and worker/error/overdue notifications; add read/unread state and source entity links.
- Opt-in email alerts only after secure server integration; no secrets in frontend.
- Include deduplication keys, timezone, digest and quiet hours, per-role recipients, escalation stages.
- WhatsApp/SMS require approved provider and explicit opt-in; never automatically send customer data.

Exit: fake triggers demonstrate one alert per event, no duplicate notifications, correct access scoping, audit of delivery attempts.

### Phase 7 — Backup and recovery

- Existing process CSV is a data export, **not** a full backup. Maintain it as explicitly labelled.
- Inventory Supabase managed backup/PITR capabilities for this plan and confirm enabled retention and actual testable recovery before showing any 'backup healthy' indicator.
- Protect Postgres row history plus private object storage with independently verified manifests and retention; restrict backups to operators with administrative recovery permissions.
- Restore rehearsal must use a clean, non-production project and must prove attachment linkage and RLS without exposing secrets.
- Never expose a one-click restore to the public website.

Exit: signed off test-restore with sample processes/documents, permissions verified, RPO/RTO documented.

### Phase 8 — Appearance, QA, release

- Extend browser-local density settings to per-user preference only if approved and permitted by RLS; add optional dark theme only once all pages pass contrast/readability checks.
- Add route/section-focused tests to existing Vite build pipeline and confirm no regressions in all current tests.
- QA matrix: 360px, 768px, 1366px; mobile camera; keyboard; screen reader label and focus; save/error/refresh; signed-out, admin, operator, viewer; OCR scanned/digital; upload/download; worker absent.
- Capture production baseline, deploy a preview branch, run signed-in real-device acceptance, then merge deliberately. Roll back UI via commit revert if release fails; never revert user data or delete schema to restore UI.

## Deployment and rollback checklist

- [ ] Verify feature branch does not point to the old PJS project.
- [ ] Confirm no SQL schema/data mutation in Phase 1.
- [ ] Confirm Vercel preview build Ready and current test suite passes.
- [ ] Real user checks Settings rendering, dispatch saving, TeamWorkspace, HistoricalImport in preview.
- [ ] Verify PDF/OCR and Done Pick List working with two authorized test records and correct storage.
- [ ] Review PR; merge only when accepted.
- [ ] Monitor errors after production deployment.
- [ ] Roll back only new UI commits if issue, retaining independent Supabase records intact.
