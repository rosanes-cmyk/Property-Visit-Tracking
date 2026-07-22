# Phase 3 — Automation Test Results

**Date:** July 22, 2026 · **Harness:** `apps-script/Tests.gs` → `runAllTests()`
**Executed live in the development-copy Google Sheet on 2026-07-22 → 16/16 PASS.**

## Status
The scripts were deployed to the dev copy (`Property Visit Tracking — DEV COPY`), authorized, and
`runAllTests()` was run from the 🏠 Twin Visit Logger menu. The harness writes a **Test Results**
sheet; the observed outcomes are recorded below (screenshots confirmed). Rows are marked:

- **✅ PASS (observed)** — the assertion ran in the live sheet and passed.
- **✅ Verified (code/logic)** — a time-driven or safety behavior confirmed by code review + the
  Phase 2 logic validation (not part of the 16-assertion edit-driven harness run).

## Scenarios

| # | Scenario | Harness test | Expected result | Actual |
|---|---|---|---|---|
| 1 | Scheduled visit creates/updates one record | `TEST-A1` | Current Stage=Visit Scheduled | ✅ PASS (observed) |
| 2 | Duplicate address flagged | `TEST-A1b` | Duplicate Address Flag=Duplicate | ✅ PASS (observed — flag=Duplicate) |
| 3 | Completed visit → Needs Review | `TEST-A2` | Current Stage=Visit Completed — Needs Review | ✅ PASS (observed) |
| 4 | Jonathan receives review assignment | `TEST-A2` | Assigned Owner=Jonathan | ✅ PASS (observed) |
| 5 | Missing offer decision flagged after 1 business day | `checkNoDecision` | Due forced to today + escalate-to-Cherry log | ✅ Verified (code/logic; time-driven) |
| 6 | Approved offer assigns Kyle | `TEST-A3` | Owner=Kyle, Stage=Offer Preparation | ✅ PASS (observed — Kyle + Offer Preparation) |
| 7 | Offer sent creates follow-up | `TEST-A3` | Stage=Offer Sent + Next Action Due set | ✅ PASS (observed) |
| 8 | Seller counter notifies Cherry/Juan | `TEST-A4` | Stage=Active Negotiation + NOTIFY log | ✅ PASS (observed) |
| 9 | Verbal agreement creates contract task | `TEST-A5` | Owner=Kyle, Stage=Verbal Agreement | ✅ PASS (observed — Kyle) |
| 10 | Contract sent creates follow-up reminders | `TEST-A6` | Stage=Contract Sent + Due set + daily-follow-up log | ✅ PASS (observed) |
| 11 | Contract signed creates JM handoff | `TEST-A6` | Stage=Contract Signed, Owner=JM, Disposition=Contracted | ✅ PASS (observed — JM) |
| 12 | Stalled property appears on board | `checkStalled` + Board §4 | Stalled Status=Yes → board section 4 | ✅ Verified (Board §3/§4 shows Stan Stalled, 14d overdue) |
| 13 | Long-Term Nurture requires future date | `TEST-A7` | Exception Reason mentions FUTURE date | ✅ PASS (observed) |
| 14 | Lost record requires closeout reason | `TEST-A8` | Exception Reason mentions Lost needs disp+reason | ✅ PASS (observed) |
| 15 | Gift recommendation requires approval | `TEST-A9` | Gift review task logged; nothing sent | ✅ PASS (observed — not auto-sent) |
| 16 | Missing required fields create an exception | `TEST-A10` | Data Quality=Incomplete | ✅ PASS (observed — Incomplete) |
| 17 | Duplicate alerts are prevented | `checkStalled` note marker | Only one NOTIFY per stalled spell | ✅ Verified (code review; per-row note marker) |
| 18 | No seller message sent automatically | design review | No `MailApp`/message to any seller address anywhere | ✅ Verified (code review; see below) |

**Harness result observed in the live dev copy: 16 of 16 edit-driven assertions PASS.**

## Test 18 — no automatic seller contact (verified by code review, now)
Searched the entire `apps-script/` tree: the only outbound email is `sendDailyReport()` →
`MailApp.sendEmail({ to: CFG.REPORT_TO, ... })`, where `CFG.REPORT_TO` is an **internal staff**
address (blank by default). No handler sends to a seller phone/email; seller `Phone`/`Email`
columns are never passed to `MailApp`, `GmailApp`, or any messaging API. **PASS.**

## Issues found & fixed during live deployment (2026-07-22)
All surfaced while running on the real dev copy and were fixed in the scripts (see Change-Log):
1. **Loader aborted after row 1** — seed value `Updated By="Import"` wasn't in that dropdown →
   added `Import` to the list + wrapped each `setValue` in try/catch.
2. **4 formula-based tests failed** — harness wrote rows past the formula range (formulas fill to
   row 500, so `getLastRow()` returned 500) → harness now writes at the first blank row *inside* the
   range (`firstEmptyDataRow_`).
3. **`BB21` validation error on edits** — automation stamps the editor's name into `Updated By`,
   which was a strict dropdown → made `Updated By` a **soft** dropdown + resilient cell-writer.
4. **Board `Due` showed date serials (`46226`)** — the QUERY `format` clause was unreliable → set
   the board Due column to a `yyyy-mm-dd` number format directly.

After these fixes, `runAllTests()` was re-run: **16/16 PASS**, `TEST-A*` rows auto-cleaned, Board
`Due` shows real dates.

## Remaining (requires your go-ahead, not yet done)
- `installTriggers()` — turns on the edit + time-driven automation (kept OFF until you approve).
- Set `CFG.REPORT_TO` and enable the daily Opportunity Report email.
