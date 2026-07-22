# Twin Visit Logger — Phase 1 Audit & Technical Recommendation

**Prepared for:** Cherry (Lead Manager), Twin Home Buyer / Equity Track Inc.
**Date:** July 22, 2026
**Scope:** Audit only. No implementation. The original workbook was **not** modified.

**Sources reviewed**
- **Property Visit Tracking** — workbook, analyzed from the supplied `.xlsx` export (13 sheets)
- **Property Visit SOP** — `Property_Visit_SOP.docx`, *"Property Visit Folder, WhatsApp Group & Photo Upload Process"*, Owner: Lead Manager, v1.0, effective June 26, 2026

> **Format finding (decisive for the recommendation):** although supplied as `.xlsx`, this workbook is
> a **Google Sheets** file at heart. Its dashboards are built on Google-only functions —
> `FILTER()` and `REGEXMATCH()` — which appear in the `.xlsx` as dead `__xludf.DUMMYFUNCTION`
> wrappers because **Excel cannot evaluate them**. In other words, the reporting layer already
> *only works in Google Sheets*. See §6.

---

## 1. Executive summary

The Property Visit Tracking workbook is a **real, actively maintained pipeline** (370 property
records, 71 currently Active) with a mature stage vocabulary, per-field dropdowns, a date-driven
dashboard, and a computed stage roll-up. The bones of the Twin Visit Logger are solid and worth
keeping.

But measured against the project's core rule — *every active property must have one current stage,
one next action, one owner, and one due date* — the workbook satisfies **only one of the four**:

| Requirement | Present today? | Gap |
|---|:--:|---|
| One current **stage** | ⚠️ Partial | Stage lives in **three independent** dropdowns (`Deal Stage` + `Deal Status` + `Inspection Status`) with nothing keeping them consistent |
| One clear **next action** | ❌ No | Next steps are prose inside `Status update` / `Notes` — not a filterable field |
| One assigned **owner** | ❌ No | Ownership is split across `Inspector name`, `Closer`, `Agent` — filled on only 84 / 6 / 55 of 370 rows |
| One exact **due date** | ❌ No | No next-action / follow-up date column exists anywhere |

Three of the four are missing, so Cherry **cannot today produce the one view the project exists to
deliver**: a single list of "what needs action, by whom, by when." She has to reconstruct it by
hand from narrative notes.

**Recommendation (§6–7):** a **combination approach, sequenced** — upgrade the existing **Google
Sheets** workbook into the structured system of record first (add the four required fields, add
cross-field validation, add a Cherry-facing "Opportunity Board," fix the broken pivot), then layer
**Apps Script automation** for the daily report and alerts. A dedicated **web app is recommended
only later**, if/when volume or multi-editor needs outgrow the sheet. **Do not convert to Excel** —
it would break the existing Google-native dashboards.

---

## 2. Current workbook structure (documented)

**13 sheets — but only 4 are visible; 9 are hidden helper/archive sheets.** Names, states, and
sizes are exact (read directly from the file).

| # | Sheet | State | Size | Role |
|---|---|:--:|---|---|
| 1 | `Summary` | hidden | B1:G993 | Hidden summary/scratch |
| 2 | `KPI` | **visible** | A2:P105 | **"Appointments Tracker dashboard"** — date-range filter, "appointments today/tomorrow," nav links |
| 3 | `Data` | **visible** | A1:AG405 | **Main pipeline — one row per property (370 records)** |
| 4 | `Calc` | **visible** | A1:BT1000 | **Computed stage roll-up** feeding the dashboard (COUNTIFS + Google FILTER) |
| 5 | `Sheet19` | hidden | A2 | Empty helper |
| 6 | `Ref (Deals) - Tags definition` | **visible** | A1:D28 | **Legend / dropdown vocabulary + definitions** |
| 7 | `Contracts` | hidden | A1:N45 | Closed-deal / revenue-per-deal + mail cadence history |
| 8 | `Sheet12` | hidden | A1:O1000 | Hidden data (mail list) |
| 9 | `Appointments` | hidden | A1:H416 | Hidden appointments data |
| 10 | `Sheet10` | hidden | A1:L383 | Hidden data (mail list) |
| 11 | `direct mail` | hidden | A1:U62 | Direct-mail inspected leads + mini-pivot |
| 12 | `Under Contract` | hidden | A1:H6 | Small deals snapshot |
| 13 | `Pivot Table 1` | hidden | A1 | Pivot — **collapsed / broken** (source ref invalid) |

### 2.1 The main pipeline sheet (`Data`) — column by column

370 populated rows. Header (row 1), in order:

```
A:(date) · B:Name · C:Phone · D:Address · E:City · F:Inspection Status · G:Lead Source ·
H:Contract · I:Deal Stage · J:Deal Status · K:Appointment date · L:Inspector name ·
M:Closer · N:Golden Needle · O:Agent · P:Notes · Q:Status update · R:Last update
```

**Every dropdown-driven column and its exact validation list (verified):**

| Col | Field | Dropdown values |
|---|---|---|
| F | **Inspection Status** | Cancelled · Inspected · Pending Inspection · Skipped - offer made |
| G | Lead Source | Direct Mail · Direct Mail - Postcard · PPC · TV · Facebook · SEO · PPL - Property Leads · PPL - Motivated Leads |
| H | **Contract** | Under Contract · Acquired · Cancelled Contract |
| I | **Deal Stage** | Active · On hold · Won (closed) · Lost |
| J | **Deal Status** | 26 values (Lead Received → Already listed — the full legend) |
| L | Inspector name | Juan Diaz · Jose Herrera · Manny Morales · Lily · Alan Hernandez · Cesar |
| M | **Closer** | Juan Diaz · **Cherry** · Jose Herrera · Cesar |
| O | Agent | *(free text — no dropdown)* |

Non-dropdown columns: `Name/Phone/Address/City` (identity), `Appointment date` (K, date),
`Golden Needle` (N, boolean — all `FALSE`), `Notes` (P), `Status update` (Q — holds the real
"Next step: …" prose), `Last update` (R, manual date).

**Verified live distributions (of 370 records):**
- **Deal Stage:** Lost 156 · Active 71 · On hold 40 · Won (closed) 14 · *blank 89*
- **Contract (H):** populated on 23 rows (Under Contract 13 · Acquired 5 · Cancelled Contract 5)
- **Owner fill rates:** Inspector 84 · Agent 55 · Closer 6 → *no field is reliably populated*

### 2.2 The legend (`Ref (Deals) - Tags definition`) — the asset to build on

Header: `Deal Stage · Definition · Deal Status · Definition`. Four stages, ~26 statuses, each with a
full written definition. Highlights that already describe the exact lifecycle Cherry wants:

- **Active** → Lead Received · Appointment Scheduled · Pending Reschedule · Under Review · Offer Made · Under Contract
- **On Hold** → Follow Up Scheduled *("call me back in 30/60/90 days")* · Nurture *("CRM drip campaign")* · Awaiting Seller · Probate/Legal · Seller Timeline
- **Won** → Acquired · Acquired – In Rehab · Acquired – Listed · Acquired – Sold · Wholesale – Buyer Assigned · Wholesale – Deal Closed
- **Lost** → Not Qualified · We're Passing · Contract Cancelled · Seller Rejected Offer · Did Not Proceed · Sold to Competitor · Sold with Realtor · Referred to Realtor · Already Listed · Sold (unknown buyer)

**The vocabulary is not the gap.** Every stage Cherry named already exists here. The gap is that
these statuses aren't tied to an **owner, a next action, or a due date**, and aren't surfaced as a
prioritized worklist.

### 2.3 The reporting layer (`KPI` + `Calc`) — Google-native

- **`KPI`** is the "Appointments Tracker dashboard": a `Start`/`End` date filter (B6/B7), a
  `=TODAY()` cell, a live *"Leads with booked appointments for tomorrow and today"* block, and
  "Click to go to table »" navigation links.
- **`Calc`** computes the stage roll-up. Two formula families:
  - `COUNTIFS(...)` metrics keyed to the date range — **portable** (work in Excel and Sheets).
  - `FILTER(...)` / `REGEXMATCH(...)` list-builders that pull the actual names into each stage
    table — **Google Sheets only.** In this `.xlsx` they are inert `__xludf.DUMMYFUNCTION`
    wrappers showing cached values.

This is the single clearest signal that the workbook belongs in Google Sheets (§6).

---

## 3. What can be reused

The upgrade should be **additive, not a rebuild.** Carry forward:

| Asset | Reuse as |
|---|---|
| `Data` identity columns (Name, Phone, Address, City, Lead Source, Appointment date, Notes) | The record backbone — keep every context column |
| `Ref (Deals)` legend | Controlled vocabulary for the new single "Current Stage" (map, don't reinvent) |
| Per-column dropdowns (F, G, H, I, J, L, M) | Reuse and extend; they already enforce clean values per field |
| `Inspection Status` field | Trigger for the "completed visit → needs offer decision" automation |
| `Calc` COUNTIFS metrics | Portable KPIs — keep as-is |
| `KPI` date-range + "today/tomorrow" logic | Pattern for the daily "due today / overdue" view |
| `Contracts` mail-cadence history (1st–6th mail dates) | Proven follow-up-cadence pattern to formalize into due-date automation |
| `Inspector` / `Closer` / `Agent` (incl. **Cherry** as a Closer) | Source data to consolidate into the single Owner field |

---

## 4. What is missing

### 4.1 Missing fields
1. **Current Stage (single, canonical).** Split today across `Deal Stage` + `Deal Status` +
   `Inspection Status`; nothing keeps them consistent, and 89 rows have no Deal Stage at all.
2. **Next Action (structured).** Exists only as prose in `Status update`. Not filterable/sortable.
3. **Owner (single).** Fragmented across three columns, each sparsely filled (84 / 6 / 55 of 370).
4. **Due Date (next-action date).** Does not exist. "Call me back in 60 days" lives only in text.
5. **Stage-changed timestamp / Days-in-stage.** No aging or stall metric is possible.
6. **Last-contact date** distinct from the manual `Last update`.

### 4.2 Missing stages / status structure
- No explicit **"needs offer decision"** queue after a completed visit (Inspection flips to
  *Inspected*, but nothing fires from it).
- **Negotiation** is captured only as an end-state (`Seller Rejected Offer`); there is no active
  *In Negotiation* working state.
- **Contract handoff** has no checklist/owner-transfer step between offer acceptance and *Under
  Contract*.

### 4.3 Missing validations (per-field dropdowns exist; these do not)
- **No cross-field consistency** between `Deal Stage` and `Deal Status` — you can pick a Status
  that doesn't belong to its Stage.
- **No required-field enforcement** — an Active row can exist (and many do) with no owner and no
  date.
- **Data hygiene:** `Deal Stage` values carry trailing spaces (`"Active"`, `"Lost "`); `Agent`
  is free-text; `Golden Needle` is unused.

### 4.4 Missing automation rules (the eventual target — none exist today)

| Automation | Trigger | Action |
|---|---|---|
| **Completed-visit review** | Inspection Status → *Inspected* | Create "Review & decide: offer / pass," assign owner, set due date (+1–2 days) |
| **Offer preparation** | Stage → *Offer* | Spawn offer-prep task (contract + Key Issues & Strategy per SOP), due before send |
| **Offer follow-up** | Offer Made + N days, no response | Set follow-up action + due date; nudge owner |
| **Stalled-deal alert** | Due date passed, or no update in N days | Flag on board + alert owner/Cherry |
| **Negotiation escalation** | Seller Rejected Offer / counter received | Escalate to closer; set next-action date |
| **Contract handoff** | Stage → *Under Contract* | Handoff checklist to closer / transaction coordinator |
| **Daily opportunity report** | Every morning | Email Cherry: due today, overdue, needs-action-with-no-owner-or-date |

### 4.5 Broken / dead pieces to fix
- **`Pivot Table 1`** is collapsed / its source reference is invalid — the pivot reporting is
  non-functional.
- **`Calc` FILTER/REGEXMATCH lists are dead in Excel** — only recompute in Google Sheets.
- `Golden Needle` flag unused; `Deal Stage` trailing-space values need cleanup.

---

## 5. Target model — the four guarantees

Add a small structured **"Action" block** to each active row so every property carries:

| New field | Values | Sourced from |
|---|---|---|
| **Current Stage** | Visit Review · Offer · Follow-Up · Negotiation · Contract · Nurture · Closeout | Derived/mapped from existing Deal Stage + Deal Status |
| **Next Action** | Short structured text (verb + object), e.g. "Send offer," "Call seller back" | Extracted from `Status update`, then maintained as a field |
| **Owner** | One person | Consolidated from Inspector / Closer / Agent |
| **Due Date** | One date | New |

Mapping the six stages Cherry named onto the existing legend:

| Cherry's stage | Maps to existing Deal Status |
|---|---|
| **Offer** | Under Review → Offer Made |
| **Follow-Up** | On Hold – Follow Up Scheduled |
| **Negotiation** | Seller Rejected Offer / counter (new *In Negotiation* working state) |
| **Contract** | Under Contract |
| **Nurture** | On Hold – Nurture / Awaiting Seller / Seller Timeline |
| **Closeout** | Acquired · Acquired – Sold · Wholesale – Deal Closed |

(Plus **Visit Review** = the just-inspected-needs-a-decision state that is missing today.)

---

## 6. Technical recommendation: Excel, web app, or both?

**Recommendation: a combination — sequenced, not simultaneous — and stay on Google Sheets.**

**Now (Phase 2): upgrade the existing Google Sheets workbook** into the structured system of
record. Fastest, lowest-cost, lowest-friction path to the four guarantees and the Opportunity
Board, and the team already lives here.

**Then (Phase 3): add Google Apps Script automation** on the same sheet — daily report, alerts,
escalations, handoffs. Apps Script runs natively on the sheet and emails via the existing Gmail —
no servers, no hosting.

**Later (optional): build a thin web app** *only if* one of these becomes true — concurrent
multi-editor conflicts, record volume grows well past a few hundred active deals, you need enforced
required-fields/permissions the sheet can't guarantee, or you want a polished mobile field worklist.

### Why NOT convert to "an upgraded Excel workbook" — this is now evidence-based
The dashboards are built on **Google-only `FILTER()` / `REGEXMATCH()`** functions, already dead in
the `.xlsx` (the `__xludf.DUMMYFUNCTION` wrappers). Committing to Excel would mean **rebuilding the
entire reporting layer** and abandoning the Drive/Gmail/shared-drive workflow the SOP is built
around. The correct reading of "upgraded workbook" here is **upgraded Google Sheet.**

### Why NOT a web application first
- **Data is modest** (370 total rows, 71 active) — a database-backed app is overkill today.
- **Adoption:** the team is fluent in the sheet; a new UI is a change-management cost.
- **Cost/time:** sheet upgrade + Apps Script ships in days at $0 hosting; a web app is weeks plus
  ongoing hosting/auth/maintenance.
- **REI BlackBook is already the CRM of record** for property detail; the Logger's job is the
  *action layer*, which a sheet does well.

### Why "both," eventually
A web app is strongest at exactly the sheet's weak points — enforced data entry, role-based
permissions, clean mobile worklists, push notifications — which become worth the cost at scale, not
before. Building the sheet first also defines the precise data contract a future app would sit on,
de-risking it.

### Comparison

| Criterion | Upgraded Google Sheet + Apps Script | Web application |
|---|:--:|:--:|
| Time to first value | **Days** | Weeks+ |
| Cost / hosting | **$0** | Ongoing |
| Fits current team habits | **High** | Medium (retraining) |
| Reuses existing dashboards | **Yes (Google-native)** | No (rebuild) |
| Enforced required fields / permissions | Medium | **High** |
| Mobile worklist / push | Low–Medium | **High** |
| Handles current volume (~370 / 71 active) | **Excellent** | Overkill |
| Handles large scale / many editors | Medium | **Excellent** |

---

## 7. Recommended roadmap (for approval — not yet started)

**Phase 2 — Upgrade the workbook (system of record).** Work on a **copy**, never the original.
1. Add the four fields — **Current Stage, Next Action, Owner, Due Date** — to `Data`.
2. Consolidate Inspector / Closer / Agent into the single **Owner** (Cherry already in the list).
3. Add validation: Stage↔Status consistency; required Owner + Due Date on every Active row; clean
   the trailing-space Stage values.
4. Build the **Cherry Opportunity Board** — one screen grouped by the six stages, showing
   Next Action / Owner / Due Date, with Due Today / Overdue / Missing-owner-or-date highlights.
5. Repair `Pivot Table 1`; retire/repurpose `Golden Needle`.

**Phase 3 — Automation (Apps Script + Gmail).**
Completed-visit review → offer prep → offer follow-up → stalled-deal alerts → negotiation
escalation → contract handoff → **daily opportunity email to Cherry.**

**Phase 4 — (Optional) Web app**, only if scale / permissions / mobile needs justify it, sitting on
the data contract defined in Phase 2.

---

## 8. Constraints honored in this phase
- ✅ Original workbook **not modified** (analyzed a supplied copy, read-only).
- ✅ **No implementation** started — audit and recommendation only.
- ✅ Both source documents (workbook + SOP) read and documented.

**Next step:** review this audit and approve the Phase 2 scope before any building begins.
