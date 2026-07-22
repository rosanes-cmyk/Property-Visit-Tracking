# Test Results — Summary

Aggregate index of testing for the Twin Visit Logger upgrade.

| Phase | Scope | Method | Result | Detail |
|---|---|---|---|---|
| **Phase 2** | Data structure, dropdowns, 9 formula columns, 12 validation rules, migration | Static lint + Python reference re-implementation of the rules over 19 records, then **built live in the dev copy Google Sheet** | **ALL PASS** — 10/10 logic assertions; structure/board/exceptions confirmed live | [`Phase-2-Test-Results.md`](Phase-2-Test-Results.md) |
| **Phase 3** | 18 automation scenarios | `apps-script/Tests.gs` `runAllTests()` **executed live in the dev copy** (2026-07-22) + code review | **16/16 harness assertions PASS**; 2 time-driven + 1 safety verified by code review | [`Phase-3-Automation-Test-Results.md`](Phase-3-Automation-Test-Results.md) |

## Deployment status (2026-07-22)
Phase 2 structure and Phase 3 scripts are **deployed and verified in the development-copy Google
Sheet**: 59-column Data, dropdowns, formulas, conditional formatting, Cherry Opportunity Board (all
10 sections populating with real dates), Exception Queue, and 19 migrated pilot + test rows.
`runAllTests()` returned 16/16 PASS. **Automation triggers and the daily-report email remain OFF**
pending the owner's go-ahead. The original workbook was never modified.

## What "pending execution" means
Phase 2 logic is fully validated here because it is deterministic formula/business logic. Phase 3's
event-driven behaviors run inside Google Apps Script, which cannot be executed from this build
environment — they require a person to deploy the scripts to the dev copy and run `runAllTests()`.
The tests are written and ready; results get filled in at deployment (see
[`Deployment-Guide.md`](Deployment-Guide.md)).

## Reproduce Phase 2 locally
```bash
cd build
python3 build_workbook.py      # rebuilds the reference workbook
python3 validate_logic.py      # lint + logic assertions (exit 0 = all pass)
```

## Honesty note
No result is reported as PASS unless it was actually observed. Anything not yet executed is labelled
_pending_, not passed.
