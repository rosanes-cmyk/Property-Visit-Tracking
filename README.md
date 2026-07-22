# Twin Visit Logger — Upgrade Project

**Owner:** Cherry (Lead Manager) · **Company:** Equity Track Inc. / Twin Home Buyer
**Status:** Independently **verified in the dev copy** (2026-07-22) — **30/30 tests passed**, Data = 10 real pilot rows, TEST isolated, Exception Queue = TVL-0001/0002/0003/0009, formulas/validation to row 500, original untouched. **Verified but NOT yet fully operational:** triggers are OFF and four records need REI BlackBook data. Go-live steps: [`docs/Go-Live-Checklist.md`](docs/Go-Live-Checklist.md).

**Dev copy:** *"Property Visit Tracking — DEV COPY (Twin Visit Logger Upgrade)"* —
<https://docs.google.com/spreadsheets/d/1gxjc3vO1l3Q-dffzhgnDDh86mqFv5zmBqZaWyAPVKT4/edit>
(the original "Property Visit Tracking" is never modified).

---

## What this project is

The **Twin Visit Logger** is the system Twin Home Buyer uses to track properties from
a confirmed visit through offer, negotiation, contract, and closeout. Today it lives in a
Google Sheets workbook ("Property Visit Tracking") plus a written SOP ("Property Visit Folder,
WhatsApp Group & Photo Upload Process").

The upgrade goal is a system that lets **Cherry instantly see which visited properties need an
offer, follow-up, negotiation, contract action, nurture, or closeout** — and eventually
automates the routine review, alerting, and reporting around those stages.

### The non-negotiable rule for every active property

Every active property must always have:

1. **One current stage**
2. **One clear next action**
3. **One assigned owner**
4. **One exact due date**

---

## Where the project stands

| Phase | Description | Status |
|-------|-------------|--------|
| **Phase 1** | Audit the current workbook + SOP, document structure, identify reusable vs. missing pieces, recommend a technical approach | ✅ Complete |
| **Phase 2** | Build the upgraded system (59-column `Data`, dropdowns, formulas, Cherry Opportunity Board, Exception Queue, pilot migration) | ✅ Deployed & verified in the dev copy |
| **Phase 3** | Automation (edit + time-driven rules, daily report, alerts, escalations) | ✅ Deployed; `runAllTests()` 16/16 PASS. Triggers OFF pending go-ahead |

All work is on the **development copy**; the original workbook has **not** been modified. The Phase 3
automation scripts are **ready to deploy** — they have not yet been executed (Apps Script runs inside
Google Sheets and must be run by a person; see the deploy guide).

## How to deploy

Follow [`docs/Deployment-Guide.md`](docs/Deployment-Guide.md) — paste the `apps-script/` files into
the dev copy's Apps Script editor, run `setup()` → `installTriggers()` → `runAllTests()`.

## Repository layout

- **`apps-script/`** — Google Apps Script for the live sheet: `Config.gs` (schema, headers,
  dropdowns), `Setup.gs` (builds the sheet structure), `Automation.gs` (edit + time-driven rules),
  `DailyReport.gs` (daily Opportunity Report), `Tests.gs` (`runAllTests`), `appsscript.json` (manifest).
- **`build/`** — offline artifacts: `Twin_Visit_Logger_DEV_reference.xlsx` (validated reference
  workbook), `build_workbook.py` (builder), `validate_logic.py` (logic validator).
- **`docs/`** — project documentation (below).

## Documents

- [`docs/Phase-1-Audit-Report.md`](docs/Phase-1-Audit-Report.md) — the full Phase 1 audit and technical recommendation.
- [`docs/Phase-2-Build-Spec.md`](docs/Phase-2-Build-Spec.md) — the Phase 2 build specification.
- [`docs/Data-Dictionary.md`](docs/Data-Dictionary.md) — the 59 columns, 10 stages, formulas, and migration mapping.
- [`docs/Automation-Rules.md`](docs/Automation-Rules.md) — the edit + time-driven automation and validation rules.
- [`docs/Phase-2-Test-Results.md`](docs/Phase-2-Test-Results.md) — Phase 2 logic validation results.
- [`docs/Phase-3-Automation-Test-Results.md`](docs/Phase-3-Automation-Test-Results.md) — Phase 3 test scenarios (ready, pending execution).
- [`docs/User-Guide.md`](docs/User-Guide.md) — task-based guide for Cherry and the team.
- [`docs/Deployment-Guide.md`](docs/Deployment-Guide.md) — step-by-step deploy to the dev copy.
- [`docs/Go-Live-Checklist.md`](docs/Go-Live-Checklist.md) — the 8-step go-live checklist (REI records → triggers → verify).
- [`docs/Phase-2-Cherry-Approval-Summary.md`](docs/Phase-2-Cherry-Approval-Summary.md) — one-page approval summary for Cherry.
- [`docs/Change-Log.md`](docs/Change-Log.md) — version history (v2.0, v1.0).

## Source files reviewed (read-only)

- **Property Visit Tracking** — Google Sheets workbook (system of record): 13 sheets, 370 property records, 71 currently Active. Analyzed from a supplied `.xlsx` copy; the original was not modified.
- **Property_Visit_SOP.docx** — "Property Visit Folder, WhatsApp Group & Photo Upload Process" (the Twin Visit Logger SOP)
