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
   **booked-appointment task complete**, and only after the visit is verified on Juan's calendar AND a
   handover has demonstrably reached the team. It is off unless `REI_COMPLETE_TASKS=true`, it is gated by
   `src/rei/task-gate.mjs`, and a selector matching delete/remove/trash/archive/cancel/discard is
   refused at runtime. Everything else remains forbidden: never edit a contact, change a stage,
   delete anything, send a text/email, or click destructive controls.

   **"Handover" is no longer only the WhatsApp group.** With WhatsApp out, a rule insisting on a group
   could never be satisfied, so the task would stay open forever — not caution, a broken feature. Any ONE
   of `groupVerified`, `briefingPosted` or `rowWritten` satisfies the gate; **none** is still a refusal.

   `rowWritten` is what the intake actually uses, and the reason is an ordering one. The client asked for
   the booking and the closed task in a SINGLE Chat message — *"i need the template that will notify in
   the gc about booked and the task is completed"* — so the closure has to happen BEFORE that message is
   sent, and a posted briefing cannot be its precondition or nothing would ever close. The dashboard row
   is a fair substitute and arguably the better one: it is what the team works from, it is what the 11am
   and 3pm cards are built from, and unlike a chat message it does not scroll away. The condition was
   never "a message was sent" — it was "the booking is recorded somewhere a person will see it".

   **The cost, stated because it is real:** a Chat delivery that then fails leaves the task closed and
   nobody told. The calendar event and the row are still there and the failure is in the log, but it is
   not in front of anybody. A two-message ordering avoided that; one message cannot. The client chose one
   message knowing this.

   An unconfirmed click is reported as ⚠️, never ✅ — `completeTask` re-reads the row, and a tick nobody
   can trust is worse than a warning because it stops anyone going to look.

   The completion now also runs from the **intake** (`src/services/process.mjs`), not only from the
   WhatsApp watcher. It lived solely in the watcher, which is off — so with WhatsApp disabled the write
   had no path to execute at all and `REI_COMPLETE_TASKS=true` would have done nothing, silently. A
   failure there is caught and logged, never fatal: by that point the row, the calendar event and the
   briefing have all landed, and an uncompleted task is the visible loose end it is designed to be.
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
- **REI's Lead Stage values are documented, all eleven, in `src/rei/stage-map.mjs`** — from the client's own
  *CRM Cheat Sheet*, which is the authority on them. Its categories are `ACTIVE = 1–8`, `LOST = 0, 9`,
  `WON = 10`. Two consequences worth keeping in mind: **`6 Cancelled Contract` is ACTIVE, not dead** (stage 7
  `Reinstated` exists because these come back), and **`10 Acquired` is WON**, which `Current Stage` cannot
  express because it stops at `Contract Signed` — so `Final Disposition` = `Contracted` carries it.
  `2 Follow Up` stays unmapped on purpose: the cheat sheet gives it its own *Follow-Up Reason* field precisely
  because the stage alone does not say where the lead is.
- `Current Stage` is the team's, not the automation's, and is NOT in `REI_WINS`. There are now THREE
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
  3. → `Active Negotiation` when REI says `6 Cancelled Contract` or `7 Reinstated` (`stageContractCancelled`).
     Also a backward move, and necessary: the lead was at `5 Under Contract` so the tracker reads
     `Contract Signed`, and a board still showing a signed deal after the contract collapsed is claiming a
     contract that does not exist. The contract DATES are never cleared — they are the history of a contract
     that really was signed and then cancelled. Refused onto `Lost / Closed Out` or `Long-Term Nurture`.

  When REI's stage is *earlier* than the tracker's and none of the three applies, `stageBehindTracker` reports
  and logs it rather than rewinding: the tracker holds Contract Sent/Signed Date and Transaction Handoff Status
  and REI has no equivalent, so REI being behind means REI is missing information.
- **`Visit Status` moves off `Scheduled` when REI has let go of the appointment** (`appointmentGoneFromRei`).
  Jose Anguiano's About panel showed Appointment Date, Time and Assigned To all empty, stage `2 Follow Up`,
  Next Step *"Follow up on this lead"* — REI held no appointment at all — while the tracker still read
  `Visit Date 2026-08-01 / Scheduled`, so the card kept asking somebody to chase a visit that existed nowhere
  but our sheet. The client: *"for jose its already follow up and its already updated, what's wrong with
  that?"* Nothing was, on REI's side.

  FOUR conditions, all required, because "a blank from REI never overwrites" is otherwise right: the page
  rendered (REI gave a Lead Stage), REI holds no appointment date, REI's stage is not `3 Appointment Booked`,
  and the Tasks panel **opened** and held no booked-appointment task — `visitTaskState === 'none'`, which is
  now distinct from `'unknown'` (never managed to look). Reading "we could not look" as "there is nothing
  there" is the confident wrong answer this guards against.

  It writes `Reschedule Needed`, not `Canceled`: the visit did not happen and the lead is still wanted —
  Jose's own note has him postponed to January. The visit DATE is never cleared (it is the history of a visit
  that really was booked), `Current Stage` is never moved, and any Visit Status a person set — Completed,
  Canceled, Skipped — is their record and is never overwritten by an absence.
- **Chat notifications are a shorter list than the changes.** A visit that MOVES updates the row, the
  dashboard and Juan's calendar event and posts **nothing** — the client's instruction: *"i dont want the
  update for this in the chat, it will confuse my teammate; as long as its updating in the dashboard its
  fine."* Only a `Visit Status` change and a new gift post. Do not add notifications without asking.

## Pausing

`AUTOMATION_PAUSED=true`, or a file at `./data/PAUSED` (written by `scripts\pause.cmd`), stops the jobs that
go BACK to already-tracked leads and rewrite them — the REI re-check, the hourly notes audit, the WhatsApp
watcher — before the lock and before any REI or Sheets access.

**It does NOT stop the intake.** `run-once` (a booking email → tracker row → Juan's calendar) keeps running,
at the client's correction: *"i said you only pause the check in REI auto update, not the auto add in
calendar and check in email and auto update the dashboard, right?"* Pausing intake means a visit booked
today exists nowhere but REI, and the team works off the calendar. Either one pauses; BOTH must be cleared to resume, and `resume.cmd` says so
when it removes the file but `.env` still holds the flag.

Asked for by the client while debugging: *"can we stop the auto update, we need to pause this for now, we
have bug in the system."*

It is in the code, not the scheduler, for the reason already learned over WhatsApp: a disabled scheduled
task is not an off switch, and on this machine `schtasks /Change /DISABLE` answered "Access is denied" for
one of the two tasks, so the documented workaround did not even work.

`--force` runs one command anyway. Pausing is about the automation acting unattended; it must not stop the
person debugging it from checking a lead.

**Not covered:** the 9am/11am/4pm Chat digest, which Apps Script posts from Google's own timers. Stopping
that means deleting its triggers in the Apps Script editor, and `pause.cmd` says so on screen.

## The work-queue card checks the buckets before it sends

At the client's instruction — *"you will check first the 8 bucket send ing the updates in to the gc"* — the
9am/11am/4pm trigger does not post directly. `digestWithFreshRei_` reads the bucket sweep's `SWEEP` stamp
from the `Automation Log`; if it is older than 90 minutes (or absent) the card posts **nothing** and a
one-off trigger tries again in 10 minutes, up to three times. Only then does it post anyway, with the
subtitle saying the data may be out of date — because a queue that goes silent reads as "nothing needs
doing", and the leads on it still need working. The visible cost is that a card can arrive up to 30 minutes
after its hour.

Two rules about that stamp, both learned the hard way, that must not be undone:

- **A sweep that changed nothing still stamps.** It was written inside `if (APPLY && auditRows.length)`,
  and `auditRows` only fills when something changed — so the ordinary sweep wrote nothing, and check-first
  would have held every card on the days everything was fine. An empty card stamps too: that is a finished
  check with a result of zero.
- **The lock exits stamp nothing.** "Another REI run is active" and "REI stayed busy for 12 minutes" are
  precisely the cases where the card must know the buckets were *not* checked.

The menu item posts immediately and never waits; a person who clicked it is asking for what the sheet holds
this second.

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
API has no group management at all, so there is no compliant way to automate the group. Do not propose a
"safer" scraping approach on your own initiative; the honest answer is that one does not exist.

**`WHATSAPP_SEED_ONLY=true` is the client's decision, taken against my advice, and it is not a safety
feature.** Asked for repeatedly across one session: *"create a gc add 1 member in then ... my colleauge will
add the all members"*, with the briefing going to Google Chat for a person to paste. The mode creates the
group with ONE member and sends nothing at all; the handover — who is still to add, and the briefing text —
is posted to Chat, which is the client's own Workspace and permitted to automate.

It is genuinely less exposure than what ran before: one contact instead of four, and no message sending,
which is the most heavily detected action of the lot. It is **not** protection, and the next person to read
this should not mistake it for one. All three bans ran against an already-logged-in profile and the third
created exactly ONE group. What Meta reads is a program driving WhatsApp Web at all — and the participants
here are saved colleagues with daily chat history, which was never the suspicious part. My estimate, given
to the client: around 80% that a working business number is banned or restricted within a month, and a real
chance in the first week. My advice, also given, was to run it on a number the business can afford to lose.

Three things hold that mode to what was agreed, and none may be removed:
`participants()` returns exactly one and **never the seller**; `maybePostNote` refuses at the top, so all
three posting paths are covered — including PASS 2, which reruns over groups that already exist and would
otherwise have typed the briefing in on the very next run; and `WHATSAPP_ENABLED` still gates everything,
so seeding does nothing until the client switches WhatsApp on themselves.

**`promoteToAdmin` is the SECOND write this project makes to WhatsApp**, and it exists because the client's
own screenshot showed a group the automation had created with *Add other members* switched OFF — so the
seeded colleague could not add Juan, and the Chat message would have asked for something WhatsApp forbids.
Promoting them is smaller than flipping that permission: an admin can add people whatever the toggle says,
and the group is not loosened for everybody. The client asked for both; only the promotion is done, because
doing both is extra clicking inside WhatsApp for no gain.

Its guards must not be relaxed. The open conversation's header must match the group name; there must be
**exactly one** other participant (in seed mode that is the whole group, and WhatsApp shows saved contact
NAMES rather than the number we hold, so anything else means we are looking at the wrong group); the menu
item is matched on anchored text `^make (group )?admin$` and passed through `assertSafe`, which now also
refuses `remove` and `dismiss` — both sit one row away in that same menu; and the result is confirmed by
re-reading the row rather than assuming the click landed. `groupInfoOpen` and `groupParticipantRows` in
`config/whatsapp-selectors.json` are **unconfirmed candidates** written without a live session and will
likely need correcting on the first real run; the guards are what make a wrong selector fail loudly instead
of acting on the wrong person. A failed promotion is not fatal — the group and the briefing still go out,
and the Chat message says the promotion must be done by hand.

The visit briefing is the ONE message allowed to keep the seller's phone and email — `notifyChat(...,
{ keepContactDetails: true })`, at exactly one call site, asserted by `tests/notify.test.mjs`. A redacted
briefing sends the visitor to a house to meet somebody they cannot ring. Both destinations are team-only.

The briefing is a WhatsApp thing and does NOT go to Google Chat. It was routed there when WhatsApp was
switched off; the client saw it land in the alerts channel and decided otherwise — *"it should be in the
whatsapp only, so we dont need that in the alert gc, and should be only in the whatsapp if we enable again."*
`CHAT_VISIT_BRIEFING` defaults to `false`. Nothing is lost: a booking still creates the row, the dashboard
entry and Juan's calendar event, and still appears on the 11am/3pm work queue under Upcoming Visit.

Google Chat (`CHAT_WEBHOOK_URL`) remains the client's own Workspace and permitted to
automate. That was always the valuable part — the visitor having the property, the drive plan, the numbers and
the call in front of them before setting off. The group itself is created by hand, as the team did before.

The rest of the WhatsApp code is left in place and switchable, for a number the business can afford to lose.

The visit WhatsApp groups are TEAM ONLY (`WHATSAPP_INCLUDE_SELLER=false`), decided by the client
after seeing that their own hand-built groups contain no sellers. Adding one would expose whatever
the team posts — offer numbers, motivation reads, equity estimates — to the person being negotiated
with. Do not flip that default without the client saying so explicitly.

### The fourth number, 2026-08-11

WhatsApp was switched on again at the client's instruction, in seed-only mode, on **the same number that had
already been restricted** — their words: *"no its the same number."* The risk was stated once and not
re-litigated; it is their business and their account.

The sequence took about ten minutes. `whatsapp-login` reported *"Logged in and saved."* A second login attempt
showed the QR again. `whatsapp-doctor` then found the page sitting at:

```
web.whatsapp.com/?post_logout=1&logout_reason=0
```

WhatsApp's own words for "this session has been ended". No group was created, nothing was typed, nothing sent.

**This is the fourth data point, and it is the cheapest one to learn from: the session did not survive
linking.** It is no longer an estimate that a working number gets restricted — it is four for four.

Two things came out of it worth keeping:

- `whatsapp-doctor` reported **"Looks logged in (no QR on screen)"** on that logout page, because it only
  checked for a QR canvas. The three missing selectors underneath then read as a selector problem on a working
  login, when the truth was the opposite and far more serious. It now checks the URL first. A diagnostic that
  reports the wrong state is worse than none: it sends somebody to fix selectors while the real answer is to
  stop.
- The argument for the mode is weaker than it was. The briefing — the only part that carried value — now
  reaches Google Chat automatically at 07:30 for every visit that day, with nobody running anything. So the
  automation is risking a working business number to save the few seconds it takes a colleague to create a
  group by hand.
