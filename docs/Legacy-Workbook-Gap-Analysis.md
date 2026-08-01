# Gap analysis — live "Property Visit Tracking" workbook vs. Twin Visit Logger

Source examined: `Property_Visit_Tracking_2.xlsx`, 13 tabs, **409 rows on the `Data` tab**
(379 real records; 30 rows are completely empty).

Answering two questions: **what is this workbook tracking that our system had no home for**, and
**how much of it can actually be automated**.

---

## 1. Every field on the legacy `Data` tab, and where it now lands

| Legacy column | Filled | Tracker column | Status |
|---|---:|---|---|
| *(unnamed col A)* — created date | 379 | `Created Date` | already covered |
| Name | 378 | `Seller Name` | already covered |
| Phone | 378 | `Phone` | already covered |
| Address | 379 | `Property Address` | already covered |
| City | 379 | **`City`** | **column added** |
| Inspection Status | 378 | `Visit Status` | mapped — see §2 |
| Lead Source | 377 | `Lead Source` | already covered, all 8 values already legal |
| Contract | 23 | **`Contract Status`** | **column added** |
| Deal Stage | 289 | **`Deal Stage`** | **column added** |
| Deal Status | 288 | **`Deal Status`** | **column added** |
| Appointment date | 153 | `Visit Date` | already covered |
| Inspector name | 87 | `Assigned Visitor` | already covered |
| Closer | 6 | **`Closer`** | **column added** |
| Golden Needle | 407 | **`Golden Needle`** | **column added** |
| Agent | 56 | `Assigned Owner` | mapped — see §2 |
| Notes | 347 | `Visit Notes` | already covered |
| Status update | 307 | **`Market Status Update`** | **column added** |
| Last update | 49 | `Last Updated Date` | already covered |

**Seven columns were genuinely missing.** They are appended to the end of `HEADERS`, so every
existing column keeps its position on the live sheet.

### The biggest single finding: we were not using the company's own taxonomy

The workbook has a `Ref (Deals) - Tags definition` tab defining **Deal Stage** (Active / On Hold /
Won / Lost) and **26 Deal Status** values. Our tracker had invented its own 10-value `Current Stage`
list and nothing that matched the taxonomy the team actually uses in REI BlackBook.

Both now exist. `Current Stage` stays — it is what drives the dashboard's sections — and `Deal
Stage` / `Deal Status` carry the company's language alongside it. The dropdown lists are copied
verbatim from that tab.

---

## 2. The two mappings that are not one-to-one

**Inspection Status → Visit Status**

| Legacy | Tracker | Count |
|---|---|---:|
| Inspected | `Completed` | 241 |
| Cancelled | `Canceled` *(tracker spells it with one L)* | 101 |
| Pending Inspection | `Scheduled` | 30 |
| Skipped - offer made | `Skipped — Offer Made` *(new dropdown option)* | 6 |

**Agent → Assigned Owner.** The legacy column is free text. Three cells hold an explanation rather
than a name — `"Matt-since it was Juan"`, `"danica since member is no longer with team"`,
`"Matt- since it was Cherry"`. The migration extracts the name and appends the rest to `Visit Notes`
as `Agent note: …`, so nothing is lost and nothing breaks validation. `Arly`, `Matt`, `Darius`,
`Danica`, and `Team` were added to the `Assigned Owner` dropdown — they are real people doing real
work and the list did not have them.

---

## 3. Derived `Current Stage` — the decision table

Applied in this order. First match wins.

| Condition | `Current Stage` |
|---|---|
| Contract = `Acquired` or `Under Contract` | `Contract Signed` |
| Contract = `Cancelled Contract` | `Lost / Closed Out` |
| Deal Stage = `Lost` | `Lost / Closed Out` |
| Deal Stage = `Won (closed)` | `Contract Signed` |
| Deal Stage = `On hold` | `Long-Term Nurture` |
| Deal Stage = `Active`, Deal Status starts `On Hold` | `Long-Term Nurture` |
| Deal Stage = `Active`, Deal Status starts `Acquired`/`Wholesale` | `Contract Signed` |
| Deal Stage = `Active`, Deal Status = `Under Contract` | `Contract Signed` |
| Deal Stage = `Active`, Deal Status = `Offer Made` | `Offer Sent` |
| Deal Stage = `Active`, Deal Status = `Under Review` | `Offer Preparation` |
| Deal Stage = `Active`, Deal Status = `Lead Received` / `Appointment Scheduled` / `Pending Reschedule` | `Visit Scheduled` |
| Deal Stage = `Active`, Deal Status = `Seller Rejected Offer` / `Did Not Proceed` | `Lost / Closed Out` |
| No Deal Stage, Inspection = `Inspected` | `Visit Completed — Needs Review` |
| No Deal Stage, Inspection = `Pending Inspection` | `Visit Scheduled` |
| **anything else** | **left blank on purpose** |

Result across the 379 records:

| Stage | Records |
|---|---:|
| Lost / Closed Out | 165 |
| Long-Term Nurture | 50 |
| Visit Completed — Needs Review | 47 |
| Contract Signed | 35 |
| Offer Sent | 20 |
| Offer Preparation | 18 |
| Visit Scheduled | 17 |
| **(blank — needs a human)** | **27** |

Those **27** are mostly *"inspection cancelled, no deal stage ever recorded"*. The old sheet never
said whether they were dead or dormant, and inventing an answer would be worse than surfacing it.
They land in the dashboard's **⚑ Unrouted — Needs Attention** section — that section exists for
exactly this.

---

## 4. What is automated, and what is not

**Fully automated today** (booking in REI → sheet + Juan's calendar, no typing):
Property Address · Seller Name · Phone · Email · Lead Source · Visit Date · Visit Time ·
Visit Status · Assigned Visitor · Visit Notes · REI BlackBook Link · Created / Last Updated Date ·
Current Stage (initial) · the calendar event itself.

**Automated by the sheet's own formulas** (never typed):
Normalized Address · Days Since Last Activity · Days Overdue · Stalled Status ·
Missing Required Fields · Duplicate Address Flag · Opportunity Priority · Data Quality Status ·
Exception Reason.

**Still a human decision — and correctly so:**
Approved Offer Amount · Offer Status and dates · Counteroffer · Seller Floor / Our Max ·
Blocker · Next Action and its due date · Gift decisions · Final Disposition · Closeout Reason ·
Deal Stage / Deal Status after the visit.

These are judgement calls. Automating them would mean the system inventing a business decision.

**Cannot be automated from REI — needs a source we do not have:**

| Field | Why |
|---|---|
| `City` | Not a separate REI field; it is inside the address string. Imported from legacy; parsed out for new records only if we add address-splitting. |
| `Closer` | Not exposed on the REI contact page. |
| `Golden Needle` | A manual flag. Only 1 of 407 rows is `True`. |
| `Market Status Update` | Comes from Redfin/Zillow lookups pasted by hand. Automating it means a property-data API — a separate project. |
| `Contract Status` | Lives in the contract process, not in REI. |

---

## 5. The other 12 tabs

They are **not** visit-tracking data and were deliberately not merged:

| Tab | Rows | What it is |
|---|---:|---|
| `Appointments`, `Sheet12`, `Sheet10` | 415 / 415 / 382 | Direct-mail campaign lists — check numbers, mail dates, campaign type. Three overlapping copies of the same data. |
| `direct mail` | 61 | Mail-touch history per lead (1st–6th mail, recycled flags). |
| `Contracts` | 44 | Revenue per deal, contract/acquired dates, mail attribution. |
| `Under Contract` | 5 | A 5-row snapshot, already inside `Data`. |
| `Summary`, `KPI`, `Calc`, `Pivot Table 1` | — | Reporting built on `Data`. Recreated live by the dashboard. |
| `Ref (Deals) - Tags definition` | 27 | The taxonomy. **Adopted** — see §1. |
| `Sheet19` | 0 | Empty. |

`Contracts` (revenue per deal) and the direct-mail tabs are a **marketing-attribution** system:
which campaign produced which contract, and what it earned. That is a real thing worth building,
but it is a different question from "which visited property needs an offer", and folding 415 rows of
mail history into the visit tracker would bury the pipeline. Flagging it as the natural next project
rather than silently dropping it.

---

## 6. Row capacity

`CFG.MAX_ROWS` was **500**. 379 imported + 10 pilot = 389 — it would have fit, with 111 rows of
headroom, and then silently stopped maintaining formulas. Raised to **1200**.

**Run "Repair sheet" before importing** so the formulas actually reach that far.
