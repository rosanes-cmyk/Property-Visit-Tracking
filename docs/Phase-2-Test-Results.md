# Phase 2 — Test Results

**Date:** July 22, 2026 · **Artifact under test:** `build/Twin_Visit_Logger_DEV_reference.xlsx`
**Records:** 19 (10 migrated pilot + 9 test) · **Evaluation date pinned:** 2026-07-22

## Validation method (and its honest limits)
LibreOffice (the offline recalculation engine bundled with the xlsx skill) **cannot run in this
environment** — it requires Java, which is absent (`failed to launch javaldx`). So Phase 2 formulas
were validated two independent ways instead, both reproducible via `build/validate_logic.py`:

- **A. Static lint** of every formula string (balanced parentheses and quotes).
- **B. Reference re-implementation** of the identical business rules in Python, computing each
  formula column for all 19 records, plus assertions on expected outcomes.

The **authoritative recalculation happens in Google Sheets on deployment** (Google Sheets natively
evaluates every function used — `IF/AND/OR/TODAY/MAX/COUNTIFS/NETWORKDAYS/SUBSTITUTE/TEXTJOIN/IFS/QUERY`).
No Excel-only function is used anywhere.

## A. Formula lint
```
PASS — 9 formula columns, all parentheses & quotes balanced.
```

## B. Computed values (all 19 records)
```
ID        Stage                          DQ          Ovd  Stall Dup        Note
TVL-0001  Visit Scheduled                Incomplete  0    No               missing REI BlackBook Link
TVL-0002  Visit Scheduled                Incomplete  0    No               missing REI BlackBook Link
TVL-0003  Offer Sent                     Exception   0    No               Offer Sent needs Amount + Sent Date
TVL-0004  Lost / Closed Out              OK               No
TVL-0005  Lost / Closed Out              OK               No
TVL-0006  Lost / Closed Out              OK               No
TVL-0007  Lost / Closed Out              OK               No
TVL-0008  Lost / Closed Out              OK               No
TVL-0009  Offer Sent                     Exception   5    Yes              Offer Sent needs Amount + Sent Date
TVL-0010  Lost / Closed Out              OK               No
TEST-01   Verbal Agreement               OK          0    No               priority 100
TEST-02   Contract Sent                  OK          0    No
TEST-03   Contract Signed                OK          2    No               (green/complete)
TEST-04   Visit Completed — Needs Review OK          1    No
TEST-05   Long-Term Nurture              OK          0    No
TEST-06   Offer Sent                     OK          14   Yes              stalled + overdue
TEST-07   Active Negotiation             Exception   0    No    Duplicate
TEST-08   Visit Scheduled                Exception   0    Yes   Duplicate
TEST-09   Lost / Closed Out              OK               No               revival (110 days dormant)
```

## C. Assertions

| # | Test | Input | Expected | Actual | Result |
|---|---|---|---|---|---|
| 1 | Missing REI link flags active record | TVL-0001 no REI link | Incomplete | Incomplete | **PASS** |
| 2 | Offer Sent needs amount+date | TVL-0003 Offer Sent, no amount/date | Exception | Exception | **PASS** |
| 3 | Offer Sent needs amount+date | TVL-0009 same | Exception | Exception | **PASS** |
| 4 | Closed records exempt from active-required | TVL-0004 Lost, disp+reason set | OK | OK | **PASS** |
| 5 | Dormant lost → revival | TEST-09 Lost, 110d since activity | ≥45d | 110d | **PASS** |
| 6 | Verbal Agreement priority | TEST-01 | 100 | 100 | **PASS** |
| 7 | Contract Signed healthy | TEST-03 | OK | OK | **PASS** |
| 8 | Stalled detection | TEST-06 Offer Sent, 20d idle | Yes | Yes | **PASS** |
| 9 | Duplicate address | TEST-07 & TEST-08 same normalized addr | Duplicate on both | Duplicate | **PASS** |
| 10 | Nurture future date | TEST-05 due 2026-09-20 | OK | OK | **PASS** |

**Result: ALL PASS** (10/10 assertions, lint clean).

## Fix applied during testing
The first run flagged **Lost / Closed Out** records as *Incomplete* (missing Next Action / Owner /
Due / REI link). The business rule scopes required-fields to **active** records only, so this was a
real bug. `Missing Required Fields` now returns blank for `Lost / Closed Out`. Fixed in
`build/build_workbook.py`, `apps-script/Setup.gs`, and re-validated → PASS. Recorded in
`docs/Change-Log.md`.

## Structure checks (by inspection of the built workbook)
- [x] 59 columns, 9 groups, headers row 1, data row 2, frozen header + first 2 columns
- [x] Data-validation dropdowns on all 19 controlled fields (verified in `build_workbook.py`)
- [x] Cherry Opportunity Board: 10 sections + display columns + section sort orders
- [x] Exception Queue + Migration Log + Dropdowns + READ ME sheets present
- [x] Conditional formatting: red (exception/overdue), orange (incomplete/stalled), green (signed)
- [x] 10 pilot records migrated; 2 offer-sent uncertain rows correctly routed to Exception; original untouched

## Pending (only doable post-deployment)
- [ ] Final recalculation confirmation in the live Google Sheet after `setup()` runs (expected clean;
      every function is Google-native). Any discrepancy will be recorded here.
