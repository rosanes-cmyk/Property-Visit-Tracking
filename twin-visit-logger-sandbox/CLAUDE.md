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
2. Treat REI as read-only, with ONE narrow exception agreed with the client: marking a
   **booked-appointment task complete**, and only after the visit is verified both on Juan's calendar
   and as a WhatsApp group. It is off unless `REI_COMPLETE_TASKS=true`, it is gated by
   `src/rei/task-gate.mjs`, and a selector matching delete/remove/trash/archive/cancel/discard is
   refused at runtime. Everything else remains forbidden: never edit a contact, change a stage,
   delete anything, send a text/email, or click destructive controls.
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
- For cancelled tasks, set `Visit Status` to `Canceled` (ONE l — the workbook's dropdown spelling; a
  value outside a dropdown fails the whole row write, not just its own cell). **Do not remove the
  Calendar event.** The client's ops lead reversed that rule: *"if the status of the calendar is
  cancelled it should not be removed in the calendar and this will notify as well."* The event is kept
  on its date, its title prefixed `[CANCELED] `, and every reminder stripped — `tagEventCancelled` in
  `src/google/calendar.mjs` and `markVisitEvents_` in `apps-script/WebApp.gs` do the same thing on
  purpose. Deletion happens only when a row has no visit date left to sit on.
- **REI is the source of truth for the fields it holds, and a stale tracker cell loses.** Changed at the
  client's instruction, asked three times over: *"all of the new update on that lead should be included,
  will automatic update in the dashboard."* `REI_WINS` in `src/rei/recheck.mjs` lists them — Assigned
  Owner, Assigned Visitor, Approved Offer Amount, all six Gift columns, Next Action, Last Contact Result —
  alongside `RECHECKABLE` (Visit Date/Time/Status, Seller Name, Phone, Email).

  This replaced a fill-if-blank rule I argued for and the evidence did not support: every conflict found in
  a full day of live runs was REI right and the tracker stale — Amelia's owner, David's phone, Rob's and
  Marlene's gifts, Toledo's and Sylvia Chan's dispositions, Amelia's $930,000. Not one the other way.
  The team works in REI; the tracker is the reporting layer.

  **The cost, stated because it is real:** a value typed on the dashboard can be overwritten from REI
  within twenty minutes. The remedy is to change it in REI. Three protections remain and must not be
  removed: a BLANK from REI never overwrites (a missing field means the page did not render), `mapOwner`/
  `mapVisitor` still refuse a value the workbook's dropdown does not hold (REI really does contain
  `"Thea, Cherry"`, and an illegal value fails the whole row write), and every change is logged old→new in
  the `Automation Log` so a wrong overwrite is visible and reversible.

  Still never written: `Visit Notes`, `Seller Motivation`, `Seller Timeline`, `Asking Price`,
  `Seller Concerns` — written by whoever stood in the property, with no REI equivalent to copy from.
- `Current Stage` is the team's, not the automation's, and is NOT in `REI_WINS`. There are now TWO
  exceptions and no more.
  1. `Visit Scheduled` → `Visit Completed — Needs Review` when REI shows the appointment task complete,
     because the workbook makes that same move itself and a Sheets API write does not fire `onEdit`.
     Never move a stage that a person has already advanced past `Visit Scheduled`.
  2. → `Lost / Closed Out` when **REI's own stage field** says lost or dead. Added at the client's
     instruction over David Jackowitz: *"add this in david, its already tagged as a dead lead, lost deal,
     and then you can see the lead stage is dead, so it already updated."* This is the only move the
     automation makes BACKWARDS, so it is guarded three ways in `stageCloseOut`: REI's stage FIELD must say
     it (never a tag — David carries `Dead Lead`, `Lost Deal` **and** `Follow up` at once); anything from
     `Verbal Agreement` onwards is refused and reported through `closeOutRefusal`, because closing a
     nearly-done deal automatically could bury it; and `Long-Term Nurture` or an already-closed lead is
     left alone. `Final Disposition` = `Lost` and a `Closeout Reason` quoting REI go with it, fill-if-blank,
     so the board can say *why* a lead is dead.
- **Chat notifications are a shorter list than the changes.** A visit that MOVES updates the row, the
  dashboard and Juan's calendar event and posts **nothing** — the client's instruction: *"i dont want the
  update for this in the chat, it will confuse my teammate; as long as its updating in the dashboard its
  fine."* Only a `Visit Status` change and a new gift post. Do not add notifications without asking.

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

The core Gmail -> REI browser -> tracker -> dashboard -> calendar path is finished, so the original
"no WhatsApp" and "no historical migration" exclusions have been lifted by the client and both are
now built (`src/whatsapp/`, `build/migrate_legacy_data.py`).

Still out of scope: direct REI API integration, auto-sending seller communication (creating a group
is permitted; sending a message is not, and no send function exists), PDF reports, and advanced
dashboard redesign.

**WhatsApp automation is OFF, and `WHATSAPP_ENABLED` now defaults to `false` in `src/config.mjs`.
THREE numbers have been banned or restricted running it.**

The third went the same way as the first two on a run that had `WHATSAPP_SKIP_WARMUP=true`, a 20-minute gap
between sessions, a cap of five groups a day, and exactly one group created. The limits are not the variable:
the automation is. Do not propose tuning them further, and do not treat a disabled scheduled task as an off
switch — the config default is the switch, because anyone can run the command by hand.

Automating WhatsApp Web breaches Meta's terms of service and they detect it — this was a stated risk from the
start of the project and it happened. No technique removes that risk, and the official WhatsApp Business Cloud
API has no group management at all, so there is no compliant way to automate the group. Do not re-enable it or
propose a "safer" scraping approach; the honest answer is that one does not exist.

The briefing now goes to Google Chat (`CHAT_WEBHOOK_URL`), which is the client's own Workspace and permitted to
automate. That was always the valuable part — the visitor having the property, the drive plan, the numbers and
the call in front of them before setting off. The group itself is created by hand, as the team did before.

The rest of the WhatsApp code is left in place and switchable, for a number the business can afford to lose.

The visit WhatsApp groups are TEAM ONLY (`WHATSAPP_INCLUDE_SELLER=false`), decided by the client
after seeing that their own hand-built groups contain no sellers. Adding one would expose whatever
the team posts — offer numbers, motivation reads, equity estimates — to the person being negotiated
with. Do not flip that default without the client saying so explicitly.
