# Runbook: Deploy the Twin Visit Logger Web Dashboard

**For:** whoever deploys the web app (Claude Cowork or a teammate) using the Twin Home Buyer Google
account that owns the DEV COPY. **Scope:** DEV COPY only — do **not** touch the original workbook.

## Context
- The Twin Visit Logger is an Apps Script project bound to the Google Sheet titled
  **"Property Visit Tracking — DEV COPY (Twin Visit Logger Upgrade)"**.
- The script is already installed and working (menu "🏠 Twin Visit Logger" appears; setup + triggers done).
- The web dashboard code is in that same project (functions `doGet`, `webGetData`, `webAction`,
  `dashboardHtml_`). Source of truth in Git: repo `rosanes-cmyk/property-visit-tracking`, branch
  `claude/twin-visit-logger-audit-klfeyo`, file `apps-script/Code.combined.gs` (latest commit).
- The task is only to **deploy** it as a Web App and return the URL. Do not change code or scopes.

## Preconditions (verify first)
1. Open the DEV COPY sheet → **Extensions → Apps Script**.
2. Confirm the editor's `Code.gs` begins with `TWIN VISIT LOGGER — SINGLE-FILE BUILD` and contains a
   `function doGet()`. If it does not, paste the latest `apps-script/Code.combined.gs` (from the Git
   branch above) into `Code.gs`, **Save**, then continue.

## Deploy steps
1. Top-right **Deploy → New deployment**.
2. In the dialog, click the **gear ⚙ (Select type) → Web app**.
3. Set:
   - **Description:** `Twin Visit Logger Dashboard`
   - **Execute as:** **Me** (the account that owns the DEV COPY)
   - **Who has access:** **Anyone within Twin Home Buyer** (Google Workspace domain).
     - If that option is absent (non-Workspace account), use **Only myself** to validate, and ask the
       owner before choosing "Anyone with the link."
4. Click **Deploy**.
5. If prompted, **Authorize access** → choose the owner account → on the "unverified" screen:
   **Advanced → Go to project → Allow**. (Scopes requested: Sheets read/write, triggers, send email
   as the user, read the user's email — all expected; approve.)
6. Copy the **Web app URL** (ends in `/exec`).

## Verify
1. Open the `/exec` URL in a browser.
2. Confirm the header **🏠 Twin Visit Logger** loads and the subtitle shows a date + live record count.
3. Confirm sections render (e.g. *Offer Sent — Follow-Up Due* shows Carmen Green / James White) and
   **no** rows named "Test …" or "Auto …" appear (Source = TEST is excluded).
4. Do **not** click quick-action buttons during verification unless testing a real, intended update.

## Report back
- The **Web app URL** (`/exec`).
- Access level chosen (domain / only-myself / link).
- Confirmation the dashboard loaded with live data and no TEST rows.
- Any authorization or access error, verbatim.

## Guardrails
- DEV COPY only; original *Property Visit Tracking* must stay untouched.
- Do not edit code, change OAuth scopes, or install/remove triggers as part of deployment.
- Updating later (after code changes): **Deploy → Manage deployments → ✏️ edit → Version: New
  version → Deploy** (keeps the same URL).
