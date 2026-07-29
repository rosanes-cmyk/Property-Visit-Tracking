# Twin Visit Logger Sandbox

A local, non-AI runtime that performs this workflow:

```text
REI task/email -> Gmail API -> REI link -> persistent Playwright browser
-> REI contact/task/property/notes extraction -> Google Sheet tracker
-> existing dashboard formulas -> Google Calendar
```

Claude Code is only used to install and map the real REI page selectors once. After setup, the Node.js script runs locally every five minutes and does not consume Claude credits.

## Safety rules

- Use the DEV/sandbox spreadsheet copy first.
- The browser is read-only in REI. It may open pages and tabs, but it must not send messages, edit contacts, complete tasks, or change statuses.
- The REI browser profile, Google OAuth token, screenshots, HTML captures, and credentials stay local and are excluded by `.gitignore`.
- Never commit `.env`, `credentials/`, `browser-data/`, `debug/`, or `data/`.
- Do not use the user's normal Chrome profile. The project creates `browser-data/rei-sandbox`.
- Do not guess missing appointment dates or addresses. Missing critical data is written as `Needs Review`/`Error`, and Calendar is not changed.

## Information captured

The scraper attempts to capture all visible information needed by the visit workflow:

- Seller/contact name
- Phone
- Email
- Full property address
- Appointment date and time
- Assigned owner
- REI BlackBook link and record ID
- Task title and task status
- Contact/lead stage
- Property details
- Contact or visit notes
- Latest activity/timeline
- Next action
- Lead source
- Last-scraped timestamp

It cannot read data that the logged-in REI account is not allowed to view. Exact selectors must be mapped against the actual REI BlackBook page once because the REI DOM is not included in this package.

## Recommended REI task title

The link may be in the automatic email body or title. Keep the full title as a fallback:

```text
Booked appointment | Seller Name | Full Property Address | July 29, 2026 2:00 PM | Owner Name | https://app.reiblackbook.com/...
```

The REI page is the primary source. The email title is only fallback data when the page does not expose a field.

## Prerequisites

- Windows 10/11
- Node.js 20 or newer
- npm
- A Google account that can read the notification Gmail, edit the DEV spreadsheet, and edit the selected Calendar
- A Google Cloud project
- A REI BlackBook account with permission to view the relevant records

## 1. Install

Open PowerShell in this folder:

```powershell
Copy-Item .env.example .env
npm install
npm run install-browser
```

Edit `.env` and set at least:

```text
SPREADSHEET_ID=<DEV spreadsheet ID>
TRACKER_SHEET=<DEV tracker tab name>
CALENDAR_ID=<sandbox calendar ID or primary>
```

Keep `REI_HEADLESS=false` until the full real test works.

## 2. Configure Google Cloud

In one Google Cloud project:

1. Enable the Gmail API.
2. Enable the Google Sheets API.
3. Enable the Google Calendar API.
4. Configure the OAuth consent screen. For a company Google Workspace project, use Internal when available.
5. Create an OAuth client with application type **Desktop app**.
6. Download the JSON and save it as:

```text
credentials/credentials.json
```

Authorize once:

```powershell
npm run auth:google
```

A local `credentials/token.json` will be created. It is excluded from Git.

## 3. Prepare the DEV tracker

The script works with an existing tracker and maps common alternate header names. It does not overwrite dashboard formulas. To create any missing automation columns in the configured DEV tracker tab:

```powershell
npm run setup:sheet
```

When `ADD_MISSING_COLUMNS=true`, missing fields are appended to the right side of the header row. Change it to `false` after mapping the existing production headers.

The dashboard updates only if its formulas/charts already reference the tracker. Do not make the automation write directly into dashboard cells.

## 4. Save the REI login in the sandbox browser

```powershell
npm run login:rei
```

A Chromium window opens using `browser-data/rei-sandbox`. Log in manually and complete MFA. After the REI dashboard is fully loaded, return to PowerShell and press Enter.

The password is not stored in source code. The browser profile keeps the authenticated session locally. When REI expires the session, rerun `npm run login:rei`.

## 5. Map the actual REI selectors

Use one real REI link that contains a booked appointment:

```powershell
npm run inspect:rei -- "PASTE_REAL_REI_LINK"
```

The command creates local files under `debug/`:

- PNG screenshot
- HTML snapshot
- JSON list of useful labels, IDs, data attributes, and visible field text

Give Claude Code the local paths and tell it to update only:

```text
config/rei-selectors.json
src/rei/scraper.mjs (only when selector configuration is insufficient)
```

Do not upload these debug files publicly because they can contain seller information.

## 6. One real sandbox test

Create one new REI task. Make sure the automatic Gmail notification includes a direct REI link.

Run:

```powershell
npm run once
```

Confirm:

- One tracker row was created or updated.
- Visit Status is `Scheduled`.
- Current Stage is `Visit Scheduled`.
- Seller, address, appointment, owner, notes, and REI link are populated when present in REI.
- The row appears in Upcoming Visits through the existing dashboard formulas.
- One Calendar event was created.
- The Calendar event description contains the REI details and link.
- The Gmail message received the label `THB-VisitLogger-Processed`.

Run `npm run once` again. It must not create another row or another event.

Then reschedule the test appointment in REI and generate a new notification. The same tracker row and same Calendar Event ID must be updated.

## 7. Automatic five-minute schedule

### Option A: Windows Task Scheduler

Run PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-task.ps1
```

Logs are appended to:

```text
logs/scheduled-task.log
```

Remove the schedule with:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-windows-task.ps1
```

### Option B: Keep a polling terminal open

```powershell
npm run poll
```

The polling loop waits until each run finishes before scheduling the next one, so browser sessions do not overlap.

## Accuracy and duplicate protection

The script uses this identity order:

1. REI record ID derived from the direct REI link
2. Exact REI link
3. Normalized property address, with phone as an additional check when available

Calendar matching uses the stored Calendar Event ID. If that ID is missing, the script searches private Calendar event properties using the REI record ID or a hash of the REI link.

The Calendar timezone is fixed by `.env` and defaults to:

```text
America/Los_Angeles
```

The event duration defaults to 60 minutes. Change `DEFAULT_VISIT_DURATION_MINUTES` when the team's actual visit duration is different.

## Gmail labels

- Successful: `THB-VisitLogger-Processed`
- Non-retryable error or critical missing information: `THB-VisitLogger-Error`
- Expired REI login: no label is added, allowing the same email to retry after login is restored

To retry an email after fixing selectors, remove the error label from that Gmail message.

The default Gmail query only checks the last two days. Do not widen it until duplicate behavior has been proven in the DEV tracker.

## Error files

When `DEBUG_CAPTURE=true`, every scrape creates local diagnostic files in `debug/`. Disable successful captures after launch to reduce storage, or modify `captureDebug` to capture only errors.

## Production cutover checklist

Do not switch the spreadsheet ID to production until all checks pass:

- Real REI link opens in the sandbox profile.
- Seller, full address, appointment, owner, and notes map correctly.
- Appointment time is correct in Pacific Time.
- Duplicate rerun creates no duplicate row/event.
- Reschedule updates the same Calendar event.
- Cancellation removes the Calendar event and updates the tracker.
- Expired login produces a clear retryable error.
- Existing dashboard formulas remain unchanged.
- `.gitignore` excludes credentials, browser profile, and debug captures.

Then change only the production spreadsheet/calendar IDs and keep a backup of the DEV copy.
