# Change Log — Twin Visit Logger

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
