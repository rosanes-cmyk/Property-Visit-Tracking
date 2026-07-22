# Change Log — Twin Visit Logger

## v2.0 — 2026-07-22 (Phase 2 build + Phase 3 automation, ready to deploy)

The upgrade rebuilds the tracking system on the development copy while preserving all history. The
original **"Property Visit Tracking"** is untouched.

### Data structure

- **New 59-column `Data` structure** in 9 groups (Property, Visit, Seller, Offer, Follow-up,
  Relationship, Closeout, Computed, System) — one row per property, headers on row 1, data from row 2.
- **Single source of truth for workflow fields:** one **Current Stage**, one **Next Action**, one
  **Assigned Owner**, one **Next Action Due Date** per active record (the four-guarantee rule).
- **10 canonical stages:** Visit Scheduled · Visit Completed — Needs Review · Offer Preparation ·
  Offer Sent · Active Negotiation · Verbal Agreement · Contract Sent · Contract Signed ·
  Long-Term Nurture · Lost / Closed Out.
- **Stable primary key** `Property ID` (`TVL-####`) so a future web app / API can key on it rather
  than row position.

### New computed fields

- **Normalized Address** + **Duplicate Address Flag** — duplicate detection and cross-system matching
  (only one active record per normalized address).
- **Days Since Last Activity**, **Days Overdue**, **Stalled Status** — activity and overdue tracking
  (stalled = 3+ business days idle, excluding Nurture/Signed/Closed).
- **Missing Required Fields**, **Data Quality Status** (OK / Incomplete / Exception), **Exception
  Reason** — enforce the four-guarantee rule and the 10 cross-field validation rules.
- **Opportunity Priority** — stage weight (Verbal 100 → Lost 0) + overdue + stalled bump; the board
  sort key.

### New sheets

- **Cherry Opportunity Board** — actionable opportunities in **10 live sections**: Contracts
  Possible This Week · Visited — No Offer Decision · Offer Sent — Follow-Up Due · Stalled Deals ·
  Overdue Tasks · Negotiation Decisions · Contract Handoffs · Gift Review · Revival Opportunities ·
  Exceptions Requiring Review. Color key: red = error/overdue, orange = warning/incomplete/stalled,
  green = signed/complete.
- **Exception Queue** — every Incomplete/Exception record in one place.
- **Migration Log** — legacy → new field mapping and per-row migration decisions.

### Automation (Apps Script — written and ready to deploy, not yet executed)

- **Edit-driven rules** (`onEditInstallable`) that set stage, owner, next action, and due dates as
  values are entered (visit scheduled/completed, offer approved/sent, counter, verbal agreement,
  contract sent/signed, nurture, closeout, gift review).
- **Time-driven rules:** hourly no-offer-decision check (`checkNoDecision`), daily 06:00 stalled
  check (`checkStalled`).
- **Daily Opportunity Report** (`sendDailyReport`, business days 07:00) — writes the "Daily Report"
  sheet and, if `CFG.REPORT_TO` is set to an internal address, emails it internally.
- **Safety:** the system never contacts sellers. All notifications are internal only (Automation Log
  sheet and optional internal email).

### Legacy handling

- **Legacy `Data` archived, not deleted** — renamed to **"Legacy Pipeline (archive)"** (hidden); all
  370 historical rows preserved. Other hidden sheets preserved with dependencies documented.
- **Golden Needle retired** — the unused (all-FALSE) legacy column is not carried into the new
  structure; the legacy column is left in place in the archive.
- **Broken `Pivot Table 1` (`#REF!`) to be repaired** — rebuilt against the current `Data` range.
  Working Google-native `FILTER`/`REGEXMATCH` dashboards (`KPI`/`Calc`) left intact but superseded
  by the Cherry Opportunity Board.

### Fixes during testing

- **Lost / Closed Out records were being wrongly flagged Incomplete.** The first validation run
  flagged closed records for missing Next Action / Assigned Owner / Next Action Due Date / REI link.
  The business rule scopes required fields to **active** records only, so this was a genuine bug.
  **Fix:** `Missing Required Fields` now returns blank for `Lost / Closed Out`, exempting them from
  the active-required-field rule. Applied in `build/build_workbook.py` and `apps-script/Setup.gs`,
  re-validated → PASS (see `docs/Phase-2-Test-Results.md`).

---

## v1.0 — Phase 1 audit

Audit of the existing "Property Visit Tracking" workbook and the Property Visit SOP; documented the
current structure, identified reusable vs. missing pieces, and recommended the technical approach.
See `docs/Phase-1-Audit-Report.md`.
