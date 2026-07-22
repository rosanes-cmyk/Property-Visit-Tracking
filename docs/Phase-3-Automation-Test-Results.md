# Phase 3 — Automation Test Results

**Date:** July 22, 2026 · **Harness:** `apps-script/Tests.gs` → `runAllTests()`

## Honest status of this phase
Apps Script **cannot be executed from this environment** — it runs inside the Google Sheets
container, which requires a human to open the dev copy, paste the scripts, authorize the OAuth
scopes, and run the functions. Therefore the automation tests below are **written and ready**, and
each row states the expected result and *how* it is verified. Rows are marked:

- **✅ Logic-verified** — the outcome is produced by a formula already validated in
  `docs/Phase-2-Test-Results.md` (deterministic, independent of Apps Script execution).
- **🟡 Ready — pending execution** — a scripted test exists in `runAllTests()`; the actual PASS/FAIL
  will be filled in when it runs on the dev copy (see `docs/Deployment-Guide.md`).

No result below is reported as PASS unless it was actually observed. After deployment, run
`runAllTests()`; it writes a "Test Results" sheet — copy those results into the "Actual" column here.

## Scenarios

| # | Scenario | Harness test | Expected result | Verification | Actual |
|---|---|---|---|---|---|
| 1 | Scheduled visit creates/updates one record | `TEST-A1` | Current Stage=Visit Scheduled | 🟡 Ready | _pending_ |
| 2 | Duplicate address flagged | `TEST-A1b` | Duplicate Address Flag=Duplicate | ✅ Logic-verified (Phase 2 #9) | _confirm_ |
| 3 | Completed visit → Needs Review | `TEST-A2` | Current Stage=Visit Completed — Needs Review | 🟡 Ready | _pending_ |
| 4 | Jonathan receives review assignment | `TEST-A2` | Assigned Owner=Jonathan | 🟡 Ready | _pending_ |
| 5 | Missing offer decision flagged after 1 business day | `checkNoDecision` | Due forced to today + escalate-to-Cherry log | 🟡 Ready (time-driven) | _pending_ |
| 6 | Approved offer assigns Kyle | `TEST-A3` | Owner=Kyle, Stage=Offer Preparation | 🟡 Ready | _pending_ |
| 7 | Offer sent creates follow-up | `TEST-A3` | Stage=Offer Sent + Next Action Due set | 🟡 Ready | _pending_ |
| 8 | Seller counter notifies Cherry/Juan | `TEST-A4` | Stage=Active Negotiation + NOTIFY log | 🟡 Ready | _pending_ |
| 9 | Verbal agreement creates contract task | `TEST-A5` | Owner=Kyle, Stage=Verbal Agreement | 🟡 Ready | _pending_ |
| 10 | Contract sent creates follow-up reminders | `TEST-A6` | Stage=Contract Sent + Due set + daily-follow-up log | 🟡 Ready | _pending_ |
| 11 | Contract signed creates JM handoff | `TEST-A6` | Stage=Contract Signed, Owner=JM, Disposition=Contracted | 🟡 Ready | _pending_ |
| 12 | Stalled property appears on board | `checkStalled` + Board §4 | Stalled Status=Yes → board section 4 | ✅ Logic-verified (Phase 2, TEST-06) | _confirm_ |
| 13 | Long-Term Nurture requires future date | `TEST-A7` | Exception Reason mentions FUTURE date | ✅ Logic-verified (formula rule 7) | _confirm_ |
| 14 | Lost record requires closeout reason | `TEST-A8` | Exception Reason mentions Lost needs disp+reason | ✅ Logic-verified (formula rule 8) | _confirm_ |
| 15 | Gift recommendation requires approval | `TEST-A9` | Gift review task logged; nothing sent | 🟡 Ready | _pending_ |
| 16 | Missing required fields create an exception | `TEST-A10` | Data Quality=Incomplete | ✅ Logic-verified (Phase 2 #1) | _confirm_ |
| 17 | Duplicate alerts are prevented | `checkStalled` note marker | Only one NOTIFY per stalled spell | 🟡 Ready | _pending_ |
| 18 | No seller message sent automatically | design review | No `MailApp`/message to any seller address anywhere | ✅ Verified by code review (see below) | **PASS** |

## Test 18 — no automatic seller contact (verified by code review, now)
Searched the entire `apps-script/` tree: the only outbound email is `sendDailyReport()` →
`MailApp.sendEmail({ to: CFG.REPORT_TO, ... })`, where `CFG.REPORT_TO` is an **internal staff**
address (blank by default). No handler sends to a seller phone/email; seller `Phone`/`Email`
columns are never passed to `MailApp`, `GmailApp`, or any messaging API. **PASS.**

## After deployment
1. Run `setup()` → `installTriggers()` → `runAllTests()` on the dev copy.
2. Copy the "Test Results" sheet output into the **Actual** column above.
3. Re-run any 🟡 rows that fail, fix, and record the fix in `docs/Change-Log.md`.
