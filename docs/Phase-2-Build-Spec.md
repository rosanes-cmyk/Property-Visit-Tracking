# Phase 2 — Build Specification (Google Sheets Upgrade)

**Project:** Twin Visit Logger upgrade · **Phase:** 2 (Google Sheets structure)
**Basis:** Approved Phase 1 audit · **Date:** July 22, 2026
**Original workbook:** untouched. All work is on the **development copy**.

---

## 0. Execution model (important)

My tools can create/copy/read Drive files but cannot edit cells, set data validation,
or run Apps Script *inside* Google Sheets directly. So Phase 2 is delivered as:

1. **A validated reference workbook** — `build/Twin_Visit_Logger_DEV_reference.xlsx` — that
   concretely implements the schema, dropdowns, portable formulas, the Cherry Opportunity Board,
   Exception Queue, Migration Log, and migrated pilot + test records.
2. **An Apps Script setup routine** — `apps-script/Setup.gs` — that builds the identical structure
   **natively** on the Google Sheets dev copy (columns, validations, formulas using Google's
   `QUERY`/`FILTER`, conditional formatting, filter views). This is the one manual step; see
   `docs/Deployment-Guide.md`.

The reference workbook and `Setup.gs` share one schema (defined in `build/build_workbook.py` and
`docs/Data-Dictionary.md`). The `.xlsx` uses LibreOffice/Excel-portable formula syntax so it can be
machine-validated; `Setup.gs` uses the Google-native equivalents.

---

## 1. Development copy & backup

- **Dev copy:** *"Property Visit Tracking — DEV COPY (Twin Visit Logger Upgrade)"* — created in Drive
  as a full copy of the live Google Sheet, preserving every sheet, live formula, dropdown, and all
  370 historical rows. This copy is both the working environment and the backup.
- The **original** `Property Visit Tracking` is not opened for writing at any point.

---

## 2. What is preserved vs. changed

| Item | Decision |
|---|---|
| Original `Data` rows (370) | **Preserved** — legacy columns kept; new columns added alongside; nothing deleted |
| `Ref (Deals) - Tags definition` legend | **Preserved** — informs the Current Stage mapping |
| `Contracts`, `direct mail`, `Appointments`, `Sheet10/12`, `Summary` (hidden) | **Preserved** — dependencies documented in `docs/Data-Dictionary.md §Hidden Sheets`; not deleted |
| `KPI` / `Calc` dashboards (Google `FILTER`/`REGEXMATCH`) | **Preserved but superseded** by the Cherry Opportunity Board; audit flagged them dead-on-export. In the live copy they still function |
| `Pivot Table 1` (broken `#REF!`) | **To repair** (audit finding) — rebuilt from the current `Data` range |
| `Golden Needle` (unused, all FALSE) | **Retired** from the new structure; legacy column left in place, not carried forward |

**No hidden sheet is deleted.** Their roles are documented before any cleanup is proposed.

---

## 3. Main data structure

One row per property on the **`Data`** sheet, headers on row 1, data from row 2.
**59 columns** in 9 groups (full definitions, types, and dropdowns in `docs/Data-Dictionary.md`):

1. **Property (8):** Property ID · Property Address · Normalized Address\* · Seller Name · Phone · Email · Lead Source · REI BlackBook Link
2. **Visit (10):** Visit Date · Visit Time · Visit Status · Assigned Visitor · Visit Notes · Property Condition · Occupancy Status · Photos Link · Video Link · File Link
3. **Seller (5):** Seller Motivation · Seller Timeline · Asking Price · Price Expectation · Seller Concerns
4. **Offer (6):** Approved Offer Amount · Offer Status · Offer Prepared Date · Offer Sent Date · Offer Received Confirmation · Counteroffer Amount
5. **Follow-up (9):** Last Contact Date · Last Contact Result · Next Action · Next Action Due Date · Assigned Owner · Blocker · Days Since Last Activity\* · Days Overdue\* · Stalled Status\*
6. **Relationship (4):** Gift Status · Gift Recommendation Reason · Gift Approval Owner · Gift Sent Date
7. **Closeout (6):** Current Stage · Final Disposition · Closeout Reason · Contract Sent Date · Contract Signed Date · Transaction Handoff Status
8. **Computed (3):** Missing Required Fields\* · Duplicate Address Flag\* · Opportunity Priority\*
9. **System (8):** Created Date · Last Updated Date · Updated By · Source · Data Quality Status\* · Exception Reason\* · REI Update Required · REI Update Completed

`*` = formula-driven (Section 6).

### Website-ready design
- **Property ID** is a stable primary key (`TVL-####`) — a future web app / API keys on it, not row position.
- **Normalized Address** gives a second natural key for dedupe and cross-system matching.
- Flat, single-row-per-record, typed columns and controlled vocabularies form a clean **data
  contract** an API can read/write without touching workflow logic. No merged cells in `Data`.
- Computed fields are derived, never hand-entered, so a web layer can recompute them identically.

---

## 4. Dropdowns (controlled vocabularies)

Exact spec values used verbatim. Assumption-based lists (not fixed by the spec) are flagged in the
Data Dictionary.

- **Visit Status:** Scheduled · Completed · Canceled · Reschedule Needed
- **Current Stage:** Visit Scheduled · Visit Completed — Needs Review · Offer Preparation · Offer Sent · Active Negotiation · Verbal Agreement · Contract Sent · Contract Signed · Long-Term Nurture · Lost / Closed Out
- **Assigned Owner:** Jonathan · Kyle · Cherry · Juan · JM
- **Final Disposition:** Contracted · Lost · Long-Term Nurture · Closed Out
- **Gift Status:** Not Reviewed · Recommended · Approved · Sent · Not Appropriate
- **Blocker:** Price · Title · Tenant · Family · Access · Timing · Documents · Property Condition · Seller Unresponsive · Other
- *(assumptions):* Offer Status · Occupancy Status · Property Condition · Seller Timeline · Transaction Handoff Status · Offer Received Confirmation (Yes/No) · REI Update Required/Completed (Yes/No) · Source · Data Quality Status

---

## 5. Validation rules

**Required-field flagging (active records).** A record is **Incomplete** (and appears in the
Exception Queue) if any of these is blank: Property Address · Current Stage · Next Action ·
Next Action Due Date · Assigned Owner · REI BlackBook Link. → `Missing Required Fields` column.

**Cross-field rules** (evaluated in `Exception Reason`; a non-empty result ⇒ Data Quality = Exception):

1. Completed visit ⇒ Visit Notes required
2. Completed visit ⇒ Seller Motivation (or an explicit Exception note) required
3. Offer Sent ⇒ Approved Offer Amount **and** Offer Sent Date required
4. Active Negotiation ⇒ Last Contact Result **and** Next Action **and** Owner **and** Due Date required
5. Contract Sent ⇒ Contract Sent Date **or** File Link required
6. Contract Signed ⇒ Contract Signed Date required
7. Long-Term Nurture ⇒ an exact **future** follow-up date required
8. Lost / Closed Out ⇒ Final Disposition **and** Closeout Reason required
9. Gift Status = Sent ⇒ prior approval (Gift Approval Owner) required
10. Only one active record per Normalized Address (`Duplicate Address Flag`)
11. Unclear records ⇒ Exception Queue
12. No record counts as complete while required fields are blank

Dropdown data-validation additionally blocks invalid values at entry on every controlled field.

---

## 6. Formula & status logic (Google-Sheets-compatible)

Portable functions only (`IF`, `AND`, `OR`, `TODAY`, `MAX`, `COUNTIFS`, `NETWORKDAYS`,
`SUBSTITUTE`, `TRIM`, `LOWER`, `TEXTJOIN`). No Excel-only functions. Exact formulas per column are
in `docs/Data-Dictionary.md`; summary of behavior:

| Field | Logic |
|---|---|
| **Normalized Address** | lower-case, strip commas/periods/#, remove " apt "/" unit ", collapse spaces, trim |
| **Days Since Last Activity** | `TODAY() − MAX(Last Contact Date, Last Updated Date, Visit Date)` |
| **Days Overdue** | `TODAY() − Next Action Due Date` if past due, else 0 |
| **Stalled Status** | "Yes" if ≥3 **business** days (`NETWORKDAYS`) since last activity and stage not Nurture/Signed/Closed |
| **Missing Required Fields** | `TEXTJOIN` of the blank required fields |
| **Duplicate Address Flag** | "Duplicate" if >1 non-closed record shares the Normalized Address |
| **Opportunity Priority** | stage weight (Verbal 100 → Lost 0) + min(Days Overdue,20) + stalled bump |
| **Data Quality Status** | Exception if `Exception Reason`≠"", else Incomplete if missing required, else OK |
| **Exception Reason** | `TEXTJOIN` of every cross-field rule (1–10) currently failing |

**Repaired formula:** the broken `#REF!` `Pivot Table 1` is rebuilt against the current `Data`
range (documented in `docs/Change-Log.md`). Working Google-native `FILTER`/`REGEXMATCH` dashboards
are left intact in the live copy.

---

## 7. Cherry Opportunity Board

New visible sheet **`Cherry Opportunity Board`** — actionable opportunities only. Ten sections, each
a live `QUERY` over `Data`:

1. Contracts Possible This Week · 2. Visited — No Offer Decision · 3. Offer Sent — Follow-Up Due ·
4. Stalled Deals · 5. Overdue Tasks · 6. Negotiation Decisions · 7. Contract Handoffs ·
8. Gift Review · 9. Revival Opportunities · 10. Exceptions Requiring Review

Each row shows: Property Address · Seller Name · Current Stage · Next Action · Assigned Owner ·
Due Date · Days Overdue · Blocker · Last Contact Result · REI BlackBook Link.

**Sort within each section:** (1) Opportunity Priority desc (contract-likelihood) → (2) Days Overdue
desc → (3) nearest Due Date → (4) most recent Last Contact Date.

**Quick filters** (saved Filter Views built by `Setup.gs`): My Tasks · Due Today · Overdue ·
Stalled · Needs Offer Decision · Offer Follow-Up · Negotiation Decision · Contracts Possible This
Week · Gift Review · Exceptions.

**Formatting:** Red = error/overdue · Orange = warning/incomplete/stalled · Green =
signed/complete · neutral = standard. Accuracy over decoration.

---

## 8. Data migration (pilot)

- **Pilot size:** the **10 most-recent** property visits (per spec's 5–10). Full automation is **not**
  applied to all 370 until pilot tests pass.
- Mapping of `Deal Stage`, `Deal Status`, `Inspection Status`, `Inspector`, `Closer`, `Agent`,
  `Status Update` → new fields is in `docs/Data-Dictionary.md §Migration` and the workbook's
  **Migration Log** sheet.
- **Uncertain mappings are not guessed** — the record is migrated with what is certain and routed to
  the Exception Queue (e.g., an offer-sent legacy row with no captured amount/date). Legacy prose is
  preserved in Visit Notes.

---

## 9. Acceptance criteria (Phase 2)

- [ ] 59 columns present, grouped, headers on row 1, `Data` starts row 2
- [ ] Every controlled field has a working dropdown
- [ ] All 9 formula columns compute without error on the pilot data
- [ ] Required-field + 10 cross-field rules drive `Data Quality Status` / `Exception Reason`
- [ ] Cherry Opportunity Board renders all 10 sections and is sorted as specified
- [ ] 10 pilot records migrated; uncertain ones in the Exception Queue; original untouched
- [ ] Test records exercise the healthy path for every stage/section
- [ ] Results recorded in `docs/Phase-2-Test-Results.md`

Phase 3 (Apps Script automation) begins only after these pass.
