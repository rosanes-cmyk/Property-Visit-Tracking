# Deployment Guide — Twin Visit Logger

How to apply the Phase 2 structure and Phase 3 automation to the development copy of the Google
Sheet. These steps must be run by a person inside Google Sheets — the scripts cannot be executed
from the build environment.

**Target sheet (DEV COPY only):**
*"Property Visit Tracking — DEV COPY (Twin Visit Logger Upgrade)"*
<https://docs.google.com/spreadsheets/d/1gxjc3vO1l3Q-dffzhgnDDh86mqFv5zmBqZaWyAPVKT4/edit>

> The original **"Property Visit Tracking"** is never modified. All work happens on the dev copy.

---

## a. Confirm you are in the DEV COPY, not the original

1. Open the link above.
2. Check the title bar reads **"Property Visit Tracking — DEV COPY (Twin Visit Logger Upgrade)"**.
3. If the title says only "Property Visit Tracking" (no "DEV COPY"), **stop** — you are in the
   original. Close it and reopen the dev-copy link.

## b. Open the Apps Script editor

- In the dev copy: **Extensions → Apps Script**.

## c. Create the script files and manifest

Create one file per source file below and paste its contents from the repo's `apps-script/` folder
(keep the exact file names; the `.gs` extension is added by the editor):

| Editor file | Paste from |
|---|---|
| `Config.gs` | `apps-script/Config.gs` |
| `Setup.gs` | `apps-script/Setup.gs` |
| `Automation.gs` | `apps-script/Automation.gs` |
| `DailyReport.gs` | `apps-script/DailyReport.gs` |
| `Tests.gs` | `apps-script/Tests.gs` |

Then set the manifest: **Project Settings (gear icon) → check "Show 'appsscript.json' manifest file
in editor"**, open `appsscript.json`, and replace its contents with `apps-script/appsscript.json`.
The manifest requests these OAuth scopes: `spreadsheets.currentonly`, `script.scriptapp`,
`script.send_mail`, `userinfo.email`. Save all files.

## d. Run `setup()` and authorize

1. In the editor's function dropdown, select **`setup`** and click **Run**.
2. Google will prompt for authorization — review and **Allow** the scopes above.
3. `setup()` will:
   - rename the legacy **Data** sheet to **"Legacy Pipeline (archive)"** and hide it (370 rows preserved),
   - build a fresh **Data** sheet (59 columns, 9 groups, headers on row 1, frozen header + first 2 columns),
   - apply all dropdowns, formulas, and conditional formatting,
   - build the **Cherry Opportunity Board** (10 sections), **Exception Queue**, **Dropdowns**, and **Migration Log** sheets.

## e. Install the triggers

- Select **`installTriggers`** and click **Run**. This installs: the installable **on-edit**
  handler (`onEditInstallable`), the hourly **no-decision** check (`checkNoDecision`), the daily
  06:00 **stalled** check (`checkStalled`), and the business-day 07:00 **daily report**
  (`sendDailyReport`).

## f. (Optional) Set the daily-report recipient

- In `Config.gs`, set `CFG.REPORT_TO` to an **internal** staff address for the daily email, e.g.
  `'rosanes@twinhomebuyer.com'`. Leave it blank to write the report only to the "Daily Report"
  sheet. **Never** put a seller address here — the system only ever emails internal staff.

## g. Run the tests and record results

1. Select **`runAllTests`** and click **Run**.
2. It writes a **"Test Results"** sheet. Review the PASS/FAIL rows.
3. Copy those results into the **Actual** column of `docs/Phase-3-Automation-Test-Results.md`
   (the harness leaves temporary `TEST-*` rows cleaned up via `cleanupTests_`).

## h. Migrate the 10 pilot rows

Automation is applied to the pilot first — do **not** bulk-migrate all 370 legacy rows until the
pilot passes. Choose one:

- **Import the reference workbook:** **File → Import → Upload** `build/Twin_Visit_Logger_DEV_reference.xlsx`
  → **Insert new sheet(s)**, then copy the 10 pilot rows into the new `Data` sheet (rows 2+).
- **Paste the pilot rows:** copy the 10 most-recent migrated visits directly into `Data` starting at
  row 2, matching the 59-column order in `Config.gs`.

After migrating, confirm the Board renders and the two offer-sent rows with no captured amount/date
land in the Exception Queue (expected — see `docs/Phase-2-Test-Results.md`).

## i. Rollback

There is nothing to undo on the original — it was never touched. If anything looks wrong on the dev
copy, you can re-run `setup()` (it rebuilds the working sheets from the preserved
"Legacy Pipeline (archive)"), or simply discard the dev copy and make a fresh copy of the original.

---

## Troubleshooting

- **Dropdowns not showing** — re-run `setup()`; data validation is applied by `applyDropdowns_`.
  Confirm the **Dropdowns** sheet exists and you are editing the new `Data` sheet, not the archive.
- **`#REF!` on the Cherry Opportunity Board** — the board is built from live `QUERY` formulas over
  `Data!A2:BZ`. A `#REF!` usually means the `Data` sheet is missing/renamed or `setup()` didn't
  finish. Re-run `setup()`; each section falls back to "— none —" when a query is empty.
- **Trigger authorization** — if edits don't auto-update, the installable trigger may not be
  authorized. Re-run `installTriggers()` and re-approve the OAuth prompt. Check **Triggers** (clock
  icon) in the editor to confirm all four are listed.
