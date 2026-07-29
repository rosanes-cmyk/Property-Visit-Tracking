# Claude Code Project Rules: Twin Visit Logger Sandbox

## Goal

Finish and verify a local Node.js automation that reads REI appointment notification emails, opens the REI link in a persistent Playwright sandbox browser, extracts the complete visible contact/task/property/notes information, upserts the DEV Google Sheet tracker, lets the existing dashboard formulas update, and creates or updates the correct Google Calendar event.

The runtime must not require Claude or any LLM after setup.

## Non-negotiable architecture

```text
Gmail API -> direct REI link -> Playwright persistent context -> REI extraction
-> Google Sheets API upsert -> existing dashboard -> Google Calendar API upsert
```

Do not replace this with Claude browser control, an autonomous Claude loop, Google Apps Script browser automation, or direct REI API integration.

## Safety

1. Work only against the configured DEV/sandbox sheet and calendar until acceptance tests pass.
2. Treat REI as read-only. Never edit a contact, complete a task, change a stage, send a text/email, or click destructive controls.
3. Never store a REI password in source code or `.env`. Login is manual through `npm run login:rei` and persists in `browser-data/rei-sandbox`.
4. Never commit `.env`, Google credentials/token, browser-data, debug screenshots/HTML, or seller data.
5. Do not write directly to dashboard cells. Only upsert the tracker; dashboard formulas/charts must remain intact.
6. Do not guess missing dates, times, addresses, owners, or seller names. Flag missing/conflicting data.
7. Do not create a Calendar event without a valid appointment start and property address.
8. Do not create duplicate tracker rows or Calendar events.

## First action

Read `README.md`, `.env.example`, `config/rei-selectors.json`, and every file under `src/` before changing code.

Then run:

```powershell
npm install
npm run install-browser
npm run check
```

Do not ask the user to re-explain the project.

## Selector mapping

The initial selectors are candidates because the actual REI DOM was not supplied when this package was generated.

1. Confirm the user has run `npm run login:rei`.
2. Run:

```powershell
npm run inspect:rei -- "REAL_REI_LINK"
```

3. Inspect the generated local `debug/*-rei-inspection.json` and HTML.
4. Update `config/rei-selectors.json` with stable selectors in this priority:
   - `data-testid` or `data-test`
   - stable semantic/ARIA selectors
   - stable field/container classes
   - label-based extraction
   - text/regex fallback only as the last option
5. Modify `src/rei/scraper.mjs` only when configuration cannot express the real page structure.
6. Prefer exact container-scoped selectors. Do not use broad selectors that can return unrelated fields.

## Required extracted fields

Capture when visible to the logged-in account:

- sellerName
- phone
- email
- propertyAddress
- appointmentStartIso
- assignedOwner
- reiLink
- reiRecordId
- taskTitle
- taskStatus
- contactStage
- propertyDetails
- notes
- latestActivity
- nextAction
- leadSource
- scrapedAt

Open only safe navigation tabs such as Notes, Tasks/Appointments, Property, and Activity/Timeline. Never click controls that mutate data.

## Data priority

1. Explicit field on the REI appointment/task/contact/property page
2. Directly associated label/value on the REI page
3. REI task title visible on the page
4. Gmail subject fallback
5. General visible-text regex fallback

When two high-confidence sources conflict, keep the REI page value, add a warning, and set Automation Status to `Needs Review`.

## Sheets behavior

- Use the existing tracker header row and aliases in `src/google/sheets.mjs`.
- Add missing columns only when `ADD_MISSING_COLUMNS=true`.
- Preserve unrelated values/formulas in an existing row by updating mapped cells only.
- Match an existing row by REI record ID, then REI link, then normalized address with phone verification when available.
- Store the Google Calendar Event ID in the tracker.
- Keep Visit Status=`Scheduled` and Current Stage=`Visit Scheduled` for active appointments.
- For cancelled tasks, set tracker status/stage to `Cancelled` and remove the linked Calendar event.

## Calendar behavior

- Timezone: `America/Los_Angeles` unless `.env` explicitly changes it.
- Summary: `Property Visit | Seller Name | Property Address`
- Location: full property address
- Description: seller, phone, email, property, owner, stages/statuses, notes, activity, next action, lead source, and REI link
- Reuse the stored Calendar Event ID.
- If it is missing, search Calendar private extended properties by REI record ID or REI link hash.
- A reschedule must update the same event, not insert another event.
- Do not send guest updates.

## Gmail behavior

- Use Gmail API with `gmail.modify`.
- Process only messages matching `GMAIL_QUERY`.
- Use labels for idempotency:
  - `THB-VisitLogger-Processed`
  - `THB-VisitLogger-Error`
- Do not mark an expired REI login as a permanent message error. Leave it unlabeled so it can retry after `npm run login:rei`.
- Do not reset or remove existing processed labels.

## Acceptance tests

Use one real sandbox appointment and prove all of these:

1. First run creates one tracker row and one Calendar event.
2. Seller, full address, appointment date/time, owner, link, and notes match REI exactly.
3. Calendar time is correct in Pacific Time.
4. Second run creates no duplicate row or event.
5. A new email for a rescheduled appointment updates the same row and same Calendar Event ID.
6. A cancellation updates the row and removes the event.
7. Missing/invalid appointment time creates no event and flags the row.
8. Expired REI login provides a clear error and allows retry.
9. Existing dashboard formulas and styling are unchanged.
10. `npm run check` passes.

## Scope control

Do not work on WhatsApp, direct REI API integration, auto-sending seller communication, PDF reports, advanced dashboard redesign, or unrelated historical data migration. Finish the Gmail -> REI browser -> tracker -> dashboard -> calendar path first.
