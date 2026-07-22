# Twin Visit Logger — Phase 1 Audit & Technical Recommendation

**Prepared for:** Cherry (Lead Manager), Twin Home Buyer / Equity Track Inc.
**Date:** July 22, 2026
**Scope:** Audit only. No implementation. The original workbook was **not** modified.

**Sources reviewed**
- **Property Visit Tracking** — Google Sheets workbook (the live system of record)
- **Property Visit SOP** — `Property_Visit_SOP.docx`, *"Property Visit Folder, WhatsApp Group & Photo Upload Process"*, Owner: Lead Manager, v1.0, effective June 26, 2026

> A note on file format: the request refers to an "Excel workbook," but the live file is a
> **native Google Sheet**, not an `.xlsx`. This matters for the technical recommendation
> (see §6) and is good news — it makes automation cheaper and faster.

---

## 1. Executive summary

The Property Visit Tracking workbook is a **genuinely useful, actively maintained pipeline** — it
already has a defined stage vocabulary (a 4-stage / 25-status legend), dashboards, and a working
roll-up of visits by stage. The bones of the Twin Visit Logger are here and worth keeping.

But measured against the project's core rule — *every active property must have one current stage,
one next action, one owner, and one due date* — the workbook satisfies **only one of the four**
today:

| Requirement | Present today? | Gap |
|---|:--:|---|
| One current **stage** | ⚠️ Partial | Stage is split across **three** columns (`Deal Stage` + `Deal Status` + `Inspection Status`) that can drift out of sync |
| One clear **next action** | ❌ No | Next steps are buried as prose inside the `Status update` / `Notes` free-text cells — not a filterable field |
| One assigned **owner** | ❌ No | Ownership is fragmented across `Inspector name`, `Closer`, and `Agent`, many blank |
| One exact **due date** | ❌ No | No next-action / follow-up date column exists anywhere |

Because three of the four are missing, Cherry **cannot today produce the one view the project is
built to deliver**: a single list of "what needs action, by whom, by when." That view has to be
reconstructed by hand each time by reading narrative notes.

**Recommendation (detail in §6–7):** a **combination approach, sequenced** — upgrade the existing
Google Sheets workbook into the structured system of record first (add the four required fields,
tighten validation, fix the broken pivot, add a Cherry-facing "Opportunity Board" view), then layer
**Apps Script automation** for the daily report and alerts. A dedicated **web app is recommended
only later**, if and when volume or multi-user editing outgrows the sheet. Building the web app
first would be premature for the current data size (~73 active records) and the team's existing
Google-Workspace + REI BlackBook workflow.

---

## 2. Current workbook structure (documented)

The workbook contains **13 regions/tabs**. Row and column details are exact; a few tab *names* are
inferred from their content because the export did not preserve every sheet title (flagged with ⓘ —
verify against the live file).

| # | Tab | Type | Rows | Role |
|---|---|---|:--:|---|
| 1 | KPI Summary strip | Summary | 6 | Top-line counts (scheduled / completed / cancelled + lead-source split) |
| 2 | Appointments Tracker dashboard | Dashboard / nav | — | Date-range filter, "appointments today/tomorrow," links into stage tables |
| 3 | **Property Visit Tracking (MAIN)** | **Live pipeline** | **~73** | **The operational heart — one row per property/lead** |
| 4 | Dashboard stage tables | Report / roll-up | ~34 | Side-by-side sub-tables per stage, computed from Tab 3 |
| 5 | **Deal Stage / Deal Status legend** | **Key / validation** | 25 | Authoritative dropdown vocabulary + definitions |
| 6 | Zillow link | Stray cell | 1 | Leftover reference |
| 7 | REI BlackBook – Revenue Per Deal | History | ~45 | Closed-deal attribution + 6-touch mail cadence (2023–2025) |
| 8 | Mail Tracker (Check offers) | Data + mini-pivot | ~165 | Mailing history w/ frequency distribution |
| 9 | Mail List (Check) | Data | ~311 | Raw mailing list |
| 10 | Mail List 2 (Owner / Offer %) | Data | ~207 | Mailing list w/ owner address + offer % |
| 11 | Direct Mail Inspected | Data + mini-pivot | ~62 | Inspected direct-mail leads |
| 12 | Acquisitions mini-list | Data | 5 | Snapshot of top deals |
| 13 | Pivot: COUNTA of Phone | Pivot | 8 | Lead Source × Inspection Status — **currently broken (`#REF!`)** |

### 2.1 The main pipeline tab (Tab 3) — column by column

One row per property/lead. Header, in order:

```
[date] · Name · Phone · Address · City · Inspection Status · Lead Source · Contract ·
Deal Stage · Deal Status · Appointment date · Inspector name · Closer · Golden Needle ·
Agent · Notes · Status update · Last update
```

| Column | Kind | Notes |
|---|---|---|
| (col A, unlabeled) | Date | Added / appointment date — no header |
| Name, Phone, Address, City | Identity | Core property/seller info |
| **Inspection Status** | Dropdown | Pending Inspection / Inspected / Cancelled / Skipped – offer made |
| Lead Source | Dropdown | PPC, Direct Mail, TV, PPL variants, Facebook |
| Contract | Text | **Empty in 0 of 73 rows — unused** |
| **Deal Stage** | Dropdown | Active / On Hold / Won / Lost |
| **Deal Status** | Dropdown | 25 granular sub-statuses (see legend) |
| Appointment date | Date | |
| **Inspector name** | Person | e.g. Juan Diaz |
| **Closer** | Person | Mostly blank |
| Golden Needle | Boolean | All `FALSE` — unused flag |
| **Agent** | Person | Mostly blank |
| Notes | Free text | Background |
| **Status update** | Free text | Contains the *real* "Next step: …" info — but as prose |
| Last update | Date | Manual |

**Observed live distribution (Tab 3):**
- **Deal Stage:** Active 33 · Lost 25 · On Hold 11 · Won 3
- **Deal Status (top):** We're Passing 19 · On Hold – Nurture 12 · Offer Made 10 · Under Review 9 · Appointment Scheduled 4 · Seller Rejected Offer 4 · Did Not Proceed 3 · Under Contract 3 …
- **Inspection Status:** Inspected 48 · Cancelled 16 · Pending Inspection 7 · Skipped – offer made 1

### 2.2 The stage legend (Tab 5) — the asset to build on

Tab 5 is the authoritative vocabulary. Header: `Deal Stage · Definition · Deal Status · Definition`.
Four stages, 25 statuses, each defined:

- **Active** → Lead Received · Appointment Scheduled · Pending Reschedule · Under Review · Offer Made · Under Contract
- **On Hold** → Follow Up Scheduled · Nurture · Awaiting Seller · Probate/Legal · Seller Timeline
- **Won** → Acquired · Acquired – In Rehab · Acquired – Listed · Acquired – Sold · Wholesale – Buyer Assigned · Wholesale – Deal Closed
- **Lost** → Not Qualified · We're Passing · Contract Cancelled · Seller Rejected Offer · Did Not Proceed · Sold to Competitor · Sold with Realtor · Referred to Realtor · Already Listed · Sold (unknown buyer)

**Every stage Cherry cares about is already expressed here** — offer (Offer Made), follow-up
(Follow Up Scheduled), negotiation (Seller Rejected Offer), contract (Under Contract), nurture
(Nurture), closeout (Acquired / Sold / Deal Closed). The gap is not vocabulary — it's that these
statuses are not tied to an **owner, a next action, or a due date**, and not surfaced as a worklist.

---

## 3. What can be reused

The upgrade should be **additive, not a rebuild.** These carry forward:

| Asset | Reuse as |
|---|---|
| **Tab 3 main pipeline** (Name, Phone, Address, City, Lead Source, Appointment date, Notes) | The record backbone — keep every identity/context column |
| **Deal Stage + Deal Status legend (Tab 5)** | The controlled vocabulary for the new single "Current Stage" (map, don't reinvent) |
| **Inspection Status field** | Trigger for "completed visit → needs offer decision" automation |
| **Dashboard stage tables (Tab 4)** | Template for the new Opportunity Board — it already groups by stage |
| **Appointments dashboard (Tab 2)** date-range filter + "today/tomorrow" logic | Pattern for the daily "due today / overdue" view |
| **KPI summary (Tab 1)** | Pattern for pipeline health metrics |
| **REI BlackBook mail-cadence model (Tab 7)** — 1st–6th mail dates | Proven follow-up-cadence pattern to formalize into due-date automation |
| **Inspector / Closer / Agent** person columns | Source data to consolidate into the single Owner field |

---

## 4. What is missing

### 4.1 Missing fields
1. **Current Stage (single, canonical).** Today split across `Deal Stage` + `Deal Status` +
   `Inspection Status` with nothing keeping them consistent.
2. **Next Action (structured).** Exists only as prose inside `Status update`. Not filterable,
   sortable, or reportable.
3. **Owner (single).** Fragmented across `Inspector name` / `Closer` / `Agent`, frequently blank.
   "Who owns this deal right now?" is unanswerable at a glance.
4. **Due Date (next-action date).** Does not exist. "Call me back in 60 days" lives only in text.
5. **Stage-changed timestamp / Days-in-stage.** No way to measure aging or spot stalls.
6. **Last-contact date** distinct from the manual `Last update`.

### 4.2 Missing stages / status structure
- No explicit **"needs offer decision"** state after a completed visit (Inspection Status flips to
  *Inspected*, but there is no action queue that fires from it).
- **Negotiation** is only implicitly captured (`Seller Rejected Offer`); no active "In Negotiation"
  working state distinct from "rejected/dead."
- **Contract handoff** has no checklist/owner-transfer step between *Offer Accepted* and
  *Under Contract*.

### 4.3 Missing validations
- No rule keeping `Deal Stage` ↔ `Deal Status` consistent (a Status can be picked that doesn't
  belong to its Stage).
- No **required-field enforcement**: an Active row can (and does) exist with no owner and no date.
- No free-text-to-dropdown discipline (`Golden Needle` unused; `Contract` empty).

### 4.4 Missing automation rules (the eventual target)
None exist today — everything is manual. The target automations:

| Automation | Trigger | Action |
|---|---|---|
| **Completed-visit review** | Inspection Status → *Inspected* | Create action "Review & decide: offer / pass," assign owner, set due date (+1–2 days) |
| **Offer preparation** | Stage → *Offer* | Spawn offer-prep task (contract, Key Issues & Strategy per SOP), due before send |
| **Offer follow-up** | Offer Made + N days, no response | Set follow-up action + due date; nudge owner |
| **Stalled-deal alert** | Due date passed, or no update in N days | Flag on board + alert owner/Cherry |
| **Negotiation escalation** | Seller Rejected Offer / counter received | Escalate to closer; set next-action date |
| **Contract handoff** | Stage → *Under Contract* | Handoff checklist to closer/transaction coordinator |
| **Daily opportunity report** | Every morning | Email Cherry: due today, overdue, needs-action-with-no-owner-or-date |

### 4.5 Broken / dead pieces to fix
- **Tab 13 pivot shows `#REF!`** — the reporting layer is partially non-functional.
- `Contract` column and `Golden Needle` flag are defined but unused — decide keep/repurpose/remove.
- Stray Zillow cell (Tab 6).

---

## 5. Target model — the four guarantees

Add a small, structured **"Action" block** to each active row so every property carries:

| New field | Values | Sourced from |
|---|---|---|
| **Current Stage** | Visit Review · Offer · Follow-Up · Negotiation · Contract · Nurture · Closeout | Derived/mapped from existing Deal Stage + Deal Status |
| **Next Action** | Short structured text (verb + object), e.g. "Send offer," "Call seller back" | Extracted from `Status update`, then maintained as a field |
| **Owner** | One person | Consolidated from Inspector/Closer/Agent |
| **Due Date** | One date | New |

Mapping the 6 stages Cherry named onto the existing legend:

| Cherry's stage | Maps to existing Deal Status |
|---|---|
| **Offer** | Under Review → Offer Made |
| **Follow-Up** | On Hold – Follow Up Scheduled |
| **Negotiation** | Seller Rejected Offer / counter (new "In Negotiation") |
| **Contract** | Under Contract |
| **Nurture** | On Hold – Nurture / Awaiting Seller / Seller Timeline |
| **Closeout** | Acquired · Acquired – Sold · Wholesale – Deal Closed |

(Plus **Visit Review** = the just-inspected-needs-a-decision state that is missing today.)

---

## 6. Technical recommendation: Excel, web app, or both?

**Recommendation: a combination — but sequenced, not simultaneous.**

**Now (Phase 2): upgrade the existing Google Sheets workbook.** It becomes the structured *system
of record*. This is the fastest, lowest-cost, lowest-friction path to the four guarantees and the
Opportunity Board, and the team already lives here.

**Then (Phase 3): add Apps Script automation** on top of the same sheet — daily report, alerts,
escalations, handoffs. Google Apps Script runs natively on the sheet, sends email via the existing
Gmail, and needs no servers or hosting.

**Later (optional): build a thin web app** *only if* one of these becomes true — concurrent
multi-user editing causes conflicts, record volume grows well past a few hundred active deals, you
need enforced required-fields/permissions the sheet can't guarantee, or you want a polished mobile
"today's worklist" for the field.

### Why not "upgraded Excel workbook"?
The live file is a **Google Sheet**, and the team's stack is Google Workspace (Drive folders,
Gmail, shared drives per the SOP) plus REI BlackBook. Converting to Excel would *break* the
existing dashboards, sharing, and any automation, and fragment the workflow. The right reading of
"upgraded workbook" here is **upgraded Google Sheet.**

### Why not "web application" first?
- **Data size is small** (~73 active rows) — a database-backed app is overkill today.
- **Adoption:** the team is already fluent in the sheet; a new UI is a change-management cost.
- **Cost/time:** a sheet upgrade + Apps Script ships in days with $0 hosting; a web app is weeks
  plus ongoing hosting/auth/maintenance.
- **REI BlackBook is already the CRM of record** for property detail; the Logger's job is the
  *action layer*, which a sheet does well.

### Why "both," eventually?
A web app shines at exactly the things a sheet is weak at — enforced data entry, role-based
permissions, clean mobile worklists, and push notifications. Those become worth the cost at scale,
not before. Building the sheet first also produces the exact data contract a future app would sit on,
so the sequencing de-risks the app.

### Comparison

| Criterion | Upgraded Google Sheet + Apps Script | Web application |
|---|:--:|:--:|
| Time to first value | **Days** | Weeks+ |
| Cost / hosting | **$0** | Ongoing |
| Fits current team habits | **High** | Medium (retraining) |
| Enforced required fields / permissions | Medium | **High** |
| Mobile worklist / push | Low–Medium | **High** |
| Handles small data (~73) | **Excellent** | Overkill |
| Handles large scale / many editors | Medium | **Excellent** |

---

## 7. Recommended roadmap (for approval — not yet started)

**Phase 2 — Upgrade the workbook (system of record).** Work on a **copy**, never the original.
1. Add the four fields — **Current Stage, Next Action, Owner, Due Date** — to the main tab.
2. Consolidate Inspector/Closer/Agent into the single **Owner**.
3. Add data validation: Stage↔Status consistency; required Owner + Due Date on every Active row.
4. Build the **Cherry Opportunity Board** — one screen grouped by the six stages, showing
   Next Action / Owner / Due Date, with Due Today / Overdue / Missing-owner-or-date highlights.
5. Fix the broken Tab 13 pivot; retire/repurpose unused `Contract` and `Golden Needle`.

**Phase 3 — Automation (Apps Script + Gmail).**
Completed-visit review → offer prep → offer follow-up → stalled-deal alerts → negotiation
escalation → contract handoff → **daily opportunity email to Cherry.**

**Phase 4 — (Optional) Web app**, only if scale/permissions/mobile needs justify it, sitting on the
same data contract defined in Phase 2.

---

## 8. Constraints honored in this phase
- ✅ Original workbook **not modified**.
- ✅ **No implementation** started — audit and recommendation only.
- ✅ Both source documents (workbook + SOP) read and documented.

**Next step:** review this audit and approve the Phase 2 scope before any building begins.
