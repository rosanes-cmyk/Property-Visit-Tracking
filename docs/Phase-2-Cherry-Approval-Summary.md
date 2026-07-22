# Phase 2 — Approval Summary for Cherry

**Date:** 2026-07-22 · **For:** Cherry (Lead Manager) · **Purpose:** approve Phase 2 (the rebuilt
Google Sheet) before we switch on Phase 3 automation.

Everything below was built on a **development copy** of the sheet. The original "Property Visit
Tracking" was never touched, so there is no risk to your live data.

## What changed

Your tracking sheet was rebuilt into one clean row-per-property structure (59 columns, grouped by
Property, Visit, Seller, Offer, Follow-up, Relationship, Closeout, and system fields). All 370
historical rows are preserved in a hidden **"Legacy Pipeline (archive)"** sheet — nothing was
deleted.

## The 30-second Opportunity Board

There's a new **Cherry Opportunity Board** you can scan in seconds to see exactly what needs action.
It's read-only and updates itself. Ten sections:

1. Contracts Possible This Week · 2. Visited — No Offer Decision · 3. Offer Sent — Follow-Up Due ·
4. Stalled Deals · 5. Overdue Tasks · 6. Negotiation Decisions · 7. Contract Handoffs ·
8. Gift Review · 9. Revival Opportunities · 10. Exceptions Requiring Review.

Colors: **red = error/overdue**, **orange = warning/incomplete/stalled**, **green =
signed/complete**. Quick filters let you see My Tasks, Due Today, Overdue, and more.

## The rule that keeps it honest

Every **active** property must always have **one Current Stage**, **one Next Action**, **one
Assigned Owner**, and **one exact Next Action Due Date**. If any is missing, the property is flagged
and shown in the Exception Queue and Board section 10 — so nothing quietly falls through the cracks.
(Closed-out deals are exempt.)

## What the pilot proved

We migrated the 10 most-recent visits and ran the full logic check (see
`docs/Phase-2-Test-Results.md`):

- **All logic checks pass** — 10/10 assertions, formulas clean.
- **2 legacy offer-sent rows correctly went to the Exception Queue** because no offer amount or sent
  date was ever captured. That's the guardrail working exactly as intended.
- Duplicate detection, stalled detection, overdue counting, revival (dormant lost deals), and the
  priority ranking all behaved correctly.

## What needs your decision

1. **Owner mapping for legacy rows with no closer/agent** — some old rows have a blank owner. Confirm
   how to assign them (or leave them in the Exception Queue until reviewed).
2. **Confirm the assumption-based dropdown lists** — we proposed values for **Offer Status**,
   **Occupancy Status**, **Property Condition**, **Seller Timeline**, and **Transaction Handoff
   Status**. Please confirm or adjust the wording.
3. **Daily-report recipient** — confirm the internal email address for the daily Opportunity Report
   (e.g. rosanes@twinhomebuyer.com), or keep it as a sheet-only report.
4. **Approve turning on the automation triggers** (Phase 3) — the edit-driven and time-driven rules,
   plus the daily report. Reminder: the system **never** contacts sellers; all alerts are internal.

## Next steps

1. You approve Phase 2 (this document) and the four decisions above.
2. We deploy the scripts to the dev copy and run the automation tests (`docs/Deployment-Guide.md`).
3. Once the pilot passes live, we migrate the remaining legacy rows and go live.
