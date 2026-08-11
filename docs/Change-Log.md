# Change Log — Twin Visit Logger

> **⚠️ Maintenance rule — the bound script is NOT auto-linked to this repo.**
> The Google Sheet's Apps Script (`Code.gs`) is a manual copy of `apps-script/Code.combined.gs`.
> **Every code change means: (1) re-paste the latest `Code.combined.gs` into the bound `Code.gs`
> and Save, then (2) Deploy → Manage deployments → New version.** Skipping either step leaves a
> stale snapshot live (e.g. the first web-app deploy shipped the pre-WebApp build and lacked the
> JSON API until it was re-synced). The `/exec` URL stays the same across new versions.

## 2026-08-11 — the work-queue card checks the buckets BEFORE it sends

Asked for in these words: *"it should be like this ok do you get me you will check first the 8 bucket
send ing the updates in to the gc."* Twice before that, in other words: *"but all lead in 8 bucket should
be chekd before sending the notif right?"* and, after a card told the whole team nobody had recorded five
outcomes a colleague had written up in REI that morning, *"im asking why did the sysytem nofit the gc nit
cheking of those?"*

**What was there before:** two independent clocks. The bucket sweep was *scheduled* 15 minutes ahead of
each card (08:45 / 10:45 / 15:45 on the PC), and the card printed how old the sweep was. If the sweep was
slow, crashed, or the PC was asleep, the card still went out — carrying an old picture with a small
apology attached. That is "send, and hope the sweep ran".

**What it does now.** The 9am / 11am / 4pm trigger no longer posts. It reads the sweep's stamp and:

| sweep finished | what happens |
| --- | --- |
| within 90 minutes | posts immediately, as before |
| older, or never | **posts nothing**, and comes back in 10 minutes — up to 3 times |
| still not swept after 3 waits | posts anyway, with the card saying the data may be out of date |

Ninety minutes is not a slack allowance: Apps Script fires a daily trigger anywhere inside the named
*hour*, so the 08:45 sweep is legitimately 74 minutes old when a 09:59 card runs.

**The one trade-off, stated plainly.** A card can now arrive up to **30 minutes after its hour**. And the
wait is bounded on purpose — if the PC is off, no amount of waiting produces a sweep, and a work queue
that goes *silent* on those days is worse than one that arrives late with a warning, because silence
reads as "nothing needs doing". So the guarantee is: the buckets are checked before the card is sent, and
on the days that is impossible the card says so instead of leaving anyone to assume.

**A real bug found while building it.** The sweep's stamp was written inside `if (APPLY &&
auditRows.length)` — and `auditRows` only gets a line when something *changed*. So the ordinary sweep, the
one that reads a dozen leads and finds them all still correct, wrote no stamp at all. Under the old
"print how fresh it is" behaviour that produced a slightly wrong subtitle. Under check-first it would have
held **every** card for half an hour and then posted "may be out of date" on the days everything was
fine — which is the most damaging thing this could do, because it trains the team to ignore the warning.
A sweep that found nothing to change is a completed check, and now says so; so is a sweep that finds the
card empty. The two lock exits ("REI is busy", "a run died holding the lock") still stamp nothing, which
is the whole point.

**Also fixed:** the region of `ChatNotify.gs` copied verbatim into the sandbox used to *end* at the words
"Post the 3pm work queue" in a doc comment. Renaming that comment made the copy silently truncate to
nothing. The boundary is now an explicit sentinel comment, and `sync-attention-rules.mjs` refuses to write
rather than emptying the copy when a marker is missing.

**Menu behaviour is unchanged:** *"💬 Post work queue now"* posts immediately and never waits — somebody
standing at the screen is asking for what the sheet holds this second. The toast tells them how stale REI
is instead.

**Turning the digest OFF now also cancels any pending retry**, so "OFF" is not followed by one more card
ten minutes later.

**To deploy:** re-paste `apps-script/Code.combined.gs` into the bound `Code.gs`, Save, then
Deploy → Manage deployments → ✏️ → New version. On the PC, replace
`twin-visit-logger-sandbox/scripts/recheck-rei.mjs`. No trigger or scheduled-task changes are needed —
the same five triggers and eight tasks carry this.

## 2026-08-01 — dashboard URL corrected

The live dashboard is the deployment already recorded in `Cowork-Zapier-Setup-Task.md`:

`https://script.google.com/a/macros/twinhomebuyer.com/s/AKfycbxp7ACEnlumHkspmbOOuY7PO4InKOUeMEmAuejfft-GTfNJI23Hr5izbt2Cxgelo3nLOg/exec`

The `AKfycbx13gEK…` URL below is a **second, older deployment of the same script**. Two deployments
means two frozen snapshots: "Deploy → New version" updates only the one you pick, so the other keeps
serving old code indefinitely. That is the trap that made earlier fixes look like they had not
worked. Keep one deployment; delete the other.

## v3.1 — 2026-07-23 (Web dashboard DEPLOYED — URL later superseded, see above)

The Apps Script Web App dashboard was deployed on the DEV COPY and verified live.
- URL: `https://script.google.com/a/macros/twinhomebuyer.com/s/AKfycbx13gEK5suKTAnQztKFAJWViZSrL40edm3CpC25RnQC_rHoUl37VQRbIBB5QLtU0aBXjg/exec`
- Version 1 · Execute as rosanes@twinhomebuyer.com · Access: Anyone within **equitytrack.org**
  (org-internal; twinhomebuyer.com is an alias on that Workspace org).
- Verified: 10 live records, real sellers only, no TEST/Auto rows, sections render correctly.
- The DEV COPY's bound script was updated to the full latest `Code.combined.gs` (it had lacked the
  dashboard section); original workbook untouched; no scope/trigger changes during deploy.
- Sheet remains the database; dashboard is a live view + guarded quick-action layer.

## v3.0 — 2026-07-22 (PILOT ACTIVATED in dev copy)

Pilot automation went live in the DEV COPY. Original *Property Visit Tracking* workbook untouched.
- **Triggers installed & confirmed active (4):** `onEditInstallable` (on edit), `checkNoDecision`
  (hourly), `checkStalled` (daily), `sendDailyReport` (daily). `installTriggers` completed 4:53:46 PM.
- **`CFG.REPORT_TO`** set to an internal Twin Home Buyer address; Daily Report previewed.
- **Real-update test PASS:** TVL-0002 (Steve Giorgi) Visit Status → Completed correctly set
  Current Stage = Visit Completed — Needs Review, Owner = Jonathan, Next Action + same-day Due Date,
  created one Task Queue row, surfaced on the Board — no duplicates, no seller contact.
- **Exception Queue = 4** Cherry-approved documented exceptions (TVL-0001/0002/0003/0009); missing
  REI values intentionally left blank (not invented).
- **Kill switch** `removeAllTriggers()` available. See `docs/Pilot-Go-Live-Report.md`.

Pilot scope only: existing 10 real records; no full REI BlackBook load; no automatic pricing,
negotiation, gift, or seller contact.

## v2.3-final — 2026-07-22 (INDEPENDENTLY VERIFIED in dev copy; triggers still OFF)

Final verified status of the development copy (independent review):

- **30 of 30 tests passed.**
- **Data** contains only the **10 real pilot records**.
- **TEST records isolated** in the Test Data sheet.
- **Cherry Opportunity Board** excludes Source = TEST.
- **Daily Report** excludes Source = TEST.
- **Exception Queue** contains exactly **TVL-0001, TVL-0002, TVL-0003, TVL-0009**.
- **Task Queue** contains only the real operational task.
- **Migration Log** exists.
- **Gift Approved By** and **Gift Approval Date** present.
- **Formulas, validation, and formatting extend through row 500.**
- **Test cleanup no longer deletes rows.**
- **No operational formula errors** found.
- **Original workbook untouched.**
- **Live automation triggers are OFF.**

Status: **Phase 2 + Phase 3 verified in the dev copy — NOT yet fully operational.** The system is
marked fully operational only after (a) the four REI BlackBook records below are completed and
(b) live triggers are installed successfully (see `docs/Go-Live-Checklist.md`).

Remaining manual work (complete from REI BlackBook — **do not invent or estimate**):
- **TVL-0001, TVL-0002** — add **REI BlackBook Link**.
- **TVL-0003, TVL-0009** — add **REI BlackBook Link**, **Approved Offer Amount**, **Offer Sent Date**.

## v2.3 — 2026-07-22 (deployment verified in dev copy; triggers still OFF)

Verified live in the development-copy Google Sheet after the round-2 fixes:
- **Expanded test suite passes** (edit-driven + coverage + TEST-exclusion + go-live-cleanup),
  including test #16 now correctly reading *Incomplete*.
- **Live Exception Queue = exactly 4** real pilot records: TVL-0001 & TVL-0002 (Incomplete —
  missing REI BlackBook Link) and TVL-0003 & TVL-0009 (Exception — missing REI link + Approved
  Offer Amount + Offer Sent Date). No Source=TEST rows leak into the live queue.
- **Data** = 10 real pilot rows; **Task Queue** = only real operational tasks; **Test Data**,
  **Migration Log**, formulas/validation to row 500 all confirmed.
- `runAllTests()` made idempotent (clears leftover TEST-A rows at start) so the duplicate-address
  contamination that had flipped #16 to Exception no longer occurs.

Automation triggers remain OFF pending explicit go-ahead.

## v2.2 — 2026-07-22 (deployment-review round 2; triggers still OFF)

**Root cause found:** a prior run of the old `deleteRow()`-based cleanup had shrunk the Data grid
below 500 rows, so `repairSheet()` threw when writing to row 500 and aborted before rebuilding the
Board/Exception Queue. Fixes:

1. **Board** — every section formula now explicitly excludes `Source = 'TEST'`.
2. **Exception Queue** — live queue formula excludes `Source = 'TEST'`.
3. **Grid guard `ensureRows_()`** — `setup`, `repairSheet`, `writeFormulas_`, `applyDropdowns_`
   now insert rows first so formulas, validations, number formats & conditional formatting always
   reach **row 500** (fixes the "only reaches 488" symptom).
4. **Test Data** sheet built by setup/repair (Source = TEST records shown there only).
5. **Migration Log** sheet built by setup/repair; documents the 10 pilot mappings + the
   intentionally-blank fields to complete from REI BlackBook.
6. **Gift Approved By / Gift Approval Date** in schema, dropdowns, gift rule, and Data Dictionary
   (Gift Status = Sent is an Exception unless both are set).
7. **`removeTestArtifacts()`** — archives TEST rows to Test Data, clears them in place (no row
   deletion, formulas restored), purges TEST/TEST-A rows from Task Queue and Automation Log, and
   **keeps Test Results**.
8. **Task Queue** contains only real operational tasks after `removeTestArtifacts()`.
9. **`repairSheet()`** now performs all of the above and shows a summary toast: formula end row,
   validation end row, live Board records, live Exception records, and test records isolated.
10. **New tests** (item 10): Board=0 TEST, Exception Queue=0 TEST, formula coverage→500,
    validation coverage→500, Gift Sent fails without approver+date, and `removeTestArtifacts`
    does not shrink the grid.

Triggers remain installed only by explicit menu action.

## v2.1 — 2026-07-22 (SOP-review corrections; triggers still OFF)

Corrections after reviewing the deployed dev copy against the SOP. No triggers installed.

1. **`cleanupTests_()` no longer uses `deleteRow()`** — it clears TEST-A* rows in place and restores
   their computed formulas, so the formula / conditional-format / validation ranges never shrink.
   New shared helpers `clearRecordRow_()` + `restoreFormulasRow_()`.
2. **`repairSheet()`** added (menu: *Repair sheet*) — reapplies headers, dropdowns, formulas,
   number formats, and conditional formatting through row 500 and rebuilds the view sheets, without
   changing any user-entered data.
3. **Source = TEST excluded** from the live **Cherry Opportunity Board**, **Exception Queue**, and
   **Daily Report**. Test records now show only in a new read-only **Test Data** sheet.
4. **New automated tests**: no-offer-decision escalation (#5), stalled status + alert (#12),
   Daily Report creation, REI-Update-Required on contract signed, no-email-while-blank, and a
   separate opt-in `testTriggerCycle()` for trigger install/remove.
5. **Internal task delivery**: a visible **Task Queue** sheet (owner, property, task, due, status)
   is written for every task, with optional internal email via `OWNER_EMAILS` (blank in pilot).
   No seller is ever contacted.
6. **Real scheduled-visit reminder**: scheduling a visit now enqueues a Task Queue item for the
   visitor due on the visit date (not just a log line).
7. **Gift approval strengthened**: new **Gift Approved By** + **Gift Approval Date** columns;
   `Gift Status = Sent` is an Exception unless both are recorded.
8. **Days Since Last Activity** and **Days Overdue** now formatted as integers.
9. **Migration Log** sheet is now actually built by `setup()`/`repairSheet()`, documenting every
   pilot→live mapping (incl. the intentionally-blank REI/offer fields to complete manually).
10. **`removeTestData()`** (menu) removes only Source = TEST records in place — no row deletion,
    formulas preserved.
11. **`sendDailyReport()`** returns `{emailed,total}` and sends nothing while `REPORT_TO` is blank
    (safe preview) — asserted by a test.
12. Triggers are still installed only by explicit menu action.

Kept intentionally visible (real pilot exceptions — complete manually from REI BlackBook, not
invented): **TVL-0001/0002** missing REI links; **TVL-0003/0009** missing REI links + Approved
Offer Amount + Offer Sent Date.

## v2.0.1 — 2026-07-22 (live deployment to the dev copy)

Deployed the Apps Script build to the development-copy Google Sheet and ran it end to end. Fixes
made while deploying live (all found by running on the real sheet):

- Added `Import` to the **Updated By** list and wrapped the loader's cell writes in try/catch so the
  pilot loader can't abort on a single value.
- **Updated By** changed to a **soft** dropdown (accepts any editor name); `RowAccessor.flush` now
  writes each cell defensively so a validated cell can never abort an automation update.
- Test harness now writes its rows **inside** the formula range (`firstEmptyDataRow_`) instead of
  past `getLastRow()`, fixing the four formula-dependent test failures.
- Cherry Opportunity Board **Due** column now uses a `yyyy-mm-dd` number format (the QUERY `format`
  clause rendered date serials).
- Added `loadPilotData()` / `clearAllData()` and an `onOpen` menu; single-file `Code.combined.gs`.

**Result:** structure, dropdowns, formulas, conditional formatting, Board (10 sections, real dates),
Exception Queue, and 19 migrated pilot + test rows all live and correct. `runAllTests()` → **16/16
PASS**. Automation triggers and the daily-report email remain **OFF** pending owner go-ahead.

## v2.0 — 2026-07-22 (Phase 2 build + Phase 3 automation, ready to deploy)

The upgrade rebuilds the tracking system on the development copy while preserving all history. The
original **"Property Visit Tracking"** is untouched.

### Data structure

- **New 59-column `Data` structure** in 9 groups (Property, Visit, Seller, Offer, Follow-up,
  Relationship, Closeout, Computed, System) — one row per property, headers on row 1, data from row 2.
- **Single source of truth for workflow fields:** one **Current Stage**, one **Next Action**, one
  **Assigned Owner**, one **Next Action Due Date** per active record (the four-guarantee rule).
- **10 canonical stages:** Visit Scheduled · Visit Completed — Needs Review · Offer Preparation ·
  Offer Sent · Active Negotiation · Verbal Agreement · Contract Sent · Contract Signed ·
  Long-Term Nurture · Lost / Closed Out.
- **Stable primary key** `Property ID` (`TVL-####`) so a future web app / API can key on it rather
  than row position.

### New computed fields

- **Normalized Address** + **Duplicate Address Flag** — duplicate detection and cross-system matching
  (only one active record per normalized address).
- **Days Since Last Activity**, **Days Overdue**, **Stalled Status** — activity and overdue tracking
  (stalled = 3+ business days idle, excluding Nurture/Signed/Closed).
- **Missing Required Fields**, **Data Quality Status** (OK / Incomplete / Exception), **Exception
  Reason** — enforce the four-guarantee rule and the 10 cross-field validation rules.
- **Opportunity Priority** — stage weight (Verbal 100 → Lost 0) + overdue + stalled bump; the board
  sort key.

### New sheets

- **Cherry Opportunity Board** — actionable opportunities in **10 live sections**: Contracts
  Possible This Week · Visited — No Offer Decision · Offer Sent — Follow-Up Due · Stalled Deals ·
  Overdue Tasks · Negotiation Decisions · Contract Handoffs · Gift Review · Revival Opportunities ·
  Exceptions Requiring Review. Color key: red = error/overdue, orange = warning/incomplete/stalled,
  green = signed/complete.
- **Exception Queue** — every Incomplete/Exception record in one place.
- **Migration Log** — legacy → new field mapping and per-row migration decisions.

### Automation (Apps Script — written and ready to deploy, not yet executed)

- **Edit-driven rules** (`onEditInstallable`) that set stage, owner, next action, and due dates as
  values are entered (visit scheduled/completed, offer approved/sent, counter, verbal agreement,
  contract sent/signed, nurture, closeout, gift review).
- **Time-driven rules:** hourly no-offer-decision check (`checkNoDecision`), daily 06:00 stalled
  check (`checkStalled`).
- **Daily Opportunity Report** (`sendDailyReport`, business days 07:00) — writes the "Daily Report"
  sheet and, if `CFG.REPORT_TO` is set to an internal address, emails it internally.
- **Safety:** the system never contacts sellers. All notifications are internal only (Automation Log
  sheet and optional internal email).

### Legacy handling

- **Legacy `Data` archived, not deleted** — renamed to **"Legacy Pipeline (archive)"** (hidden); all
  370 historical rows preserved. Other hidden sheets preserved with dependencies documented.
- **Golden Needle retired** — the unused (all-FALSE) legacy column is not carried into the new
  structure; the legacy column is left in place in the archive.
- **Broken `Pivot Table 1` (`#REF!`) to be repaired** — rebuilt against the current `Data` range.
  Working Google-native `FILTER`/`REGEXMATCH` dashboards (`KPI`/`Calc`) left intact but superseded
  by the Cherry Opportunity Board.

### Fixes during testing

- **Lost / Closed Out records were being wrongly flagged Incomplete.** The first validation run
  flagged closed records for missing Next Action / Assigned Owner / Next Action Due Date / REI link.
  The business rule scopes required fields to **active** records only, so this was a genuine bug.
  **Fix:** `Missing Required Fields` now returns blank for `Lost / Closed Out`, exempting them from
  the active-required-field rule. Applied in `build/build_workbook.py` and `apps-script/Setup.gs`,
  re-validated → PASS (see `docs/Phase-2-Test-Results.md`).

---

## v1.0 — Phase 1 audit

Audit of the existing "Property Visit Tracking" workbook and the Property Visit SOP; documented the
current structure, identified reusable vs. missing pieces, and recommended the technical approach.
See `docs/Phase-1-Audit-Report.md`.
