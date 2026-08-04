# 3:00 PM Lead Notification — Cherry's structure

**Requested by:** Cherry · **Owner:** Jonathan Rosanes · **System:** Twin Visit Logger → Google Chat
**Status:** `READY FOR CHERRY APPROVAL` — built and tested, **not deployed**. The live 3:00 PM message
is still the old four-bucket version. Four decisions below are open.

Implemented in `apps-script/ChatNotify.gs` (`ATTENTION_BUCKETS`, `attentionBucket_`, `giftPending_`,
`sendAttentionDigestToChat`), mirrored into `apps-script/Code.combined.gs`. Calendar behaviour in
`apps-script/WebApp.gs` (`syncVisitCalendar_`, `markVisitEvents_`, `notifyVisitTagged_`). Covered by
`tests/attention-digest.test.mjs` — 95 checks, 0 failing.

> **History.** An earlier revision built eight buckets around *missing fields* — missing owner, missing
> next action, missing seller motivation. Cherry replaced it: *"notification should be like this only"*,
> naming five pipeline stages plus gifts. Hers is the better structure and is what is built. This
> document describes only that. The field-based design is gone, not hidden.

---

## 1. The six sections

| # | Section | Fires when | Action expected |
|---|---|---|---|
| 1 | 📅 Upcoming Visit | `Current Stage` = `Visit Scheduled` | Confirm the visit is going ahead. Afterwards mark it Completed or Canceled. |
| 2 | 📋 Completed Visit — Needs Next Course of Action | `Current Stage` = `Visit Completed — Needs Review` | Decide: make an offer, pass, or move to nurture — and set the next action. |
| 3 | ⏱ Pending Offer — ASAP | `Current Stage` = `Offer Preparation` | Finish the offer and get it sent today. |
| 4 | 📤 Offer Sent | `Current Stage` = `Offer Sent` | Follow up with the seller for a decision. |
| 5 | 🤝 Still Negotiating | `Current Stage` = `Active Negotiation` | Decide the counter response and keep it moving. |
| 6 | 🎁 Gift Follow-Up | `Gift Status` = `Recommended` or `Approved` and not yet sent | Approve the gift, or send it and record the sent date. |

The five stages are **mutually exclusive** — a lead sits at exactly one point in the pipeline — so
"one lead, one section" is true by construction rather than by a tie-break rule somebody maintains.
A test asserts every stage above is a real value of the workbook's own `Current Stage` dropdown, so a
section cannot silently stop firing because a stage was renamed.

**Gift Follow-Up is additive** — the one place a lead can appear twice. Gifts are recommended at every
stage, so making the gift compete with the stage sections would hide every gift behind the deal it
belongs to. Sending a gift is a different errand, often for a different person, than deciding a
counter-offer. Leads and gifts are therefore counted separately in the header; adding them together
would make the headline number stop meaning "leads that need something".

## 2. What each line says

```
Seller Name · Property Address
Owner: <name>  or  Owner: UNASSIGNED     ·   the exact reason it is listed
```

Reasons state the actual condition, never a field name:

| Section | Example reason |
|---|---|
| Upcoming Visit | `visit TODAY at 2:00 PM` · `visit Aug 12, 2026` |
| Upcoming Visit (past) | `OVERDUE — visit was Aug 4, 2026 and is still marked Scheduled` |
| Needs Next Course of Action | `visited Aug 1, 2026, no offer decision recorded yet` |
| Pending Offer | `offer of $392,000 prepared but not sent` · `offer not priced yet` |
| Offer Sent | `$450,000 · sent Aug 1, 2026 · no contact for 4 day(s)` |
| Still Negotiating | `seller countered at $495,000 · Wants 495k, thinking it over with her brother` |
| Gift Follow-Up | `gift approved by Cherry on Aug 2, 2026 — not sent yet` |

Eight leads per section, then `…and N more`, so it stays readable on a phone. **Overdue visits sort to
the top of section 1** — that is the one line meaning something may already have gone wrong with a
seller, rather than merely being unfinished.

## 3. Leads that never appear

- `Current Stage` = **Lost / Closed Out**
- `Current Stage` = **Contract Signed**
- `Source` = **TEST**
- No `Property Address`
- Any stage outside the five above — see §5
- A healthy lead. When nothing needs attention, **nothing is posted**.

The notification **writes nothing**. No next action, no due date, no stage, no owner is ever created
in order to raise an alert. Asserted by a test.

## 4. Sample

Format is real, produced by the shipped rules. Records are representative.

```
WORK QUEUE — 12 lead(s) · 2 gift(s) to action
Aug 5, 2026  ·  start with Upcoming Visit (3)

📅 1. UPCOMING VISIT (3)
   Confirm the visit is going ahead. Afterwards mark it Completed or Canceled.
   David Jackowitz · 1390 Estudillo Ave, San Leandro, CA 94577
   Owner: Juan · OVERDUE — visit was Aug 4, 2026 and is still marked Scheduled
   Sara Davenport · 340 Vallejo Dr, Apt 83, Millbrae, CA 94030
   Owner: Juan · visit TODAY at 2:00 PM
   Marcus Webb · 918 Sonoma Blvd, Vallejo, CA 94590
   Owner: Kyle · visit Aug 7, 2026 at 10:00 AM

📋 2. COMPLETED VISIT — NEEDS NEXT COURSE OF ACTION (3)
   Decide: make an offer, pass, or move to nurture — and set the next action.
   Carol Parkinson · 2409 Summer St, San Jose, CA 95116
   Owner: Cherry · visited Aug 1, 2026, no offer decision recorded yet
   …

⏱ 3. PENDING OFFER — ASAP (2)
   Finish the offer and get it sent today.
   Priya Raman · 1502 Fruitvale Ave, Oakland, CA 94601
   Owner: Matt · offer of $392,000 prepared but not sent
   Devin Pate · 826 Maine St, Vallejo, CA 94590
   Owner: Kyle · offer not priced yet

📤 4. OFFER SENT (2)
   Follow up with the seller for a decision.
   Thea Ramos · 468 5th Ave, Redwood City, CA 94063
   Owner: Cherry · $450,000 · sent Aug 1, 2026 · no contact for 4 day(s)

🤝 5. STILL NEGOTIATING (2)
   Decide the counter response and keep it moving.
   Jacquelyn Mcleod · 1049 18th St, Richmond, CA 94801
   Owner: UNASSIGNED · seller countered at $495,000 · Wants 495k, thinking it over with her brother

🎁 6. GIFT FOLLOW-UP (2)
   Approve the gift, or send it and record the sent date.
   Thea Ramos · 468 5th Ave, Redwood City, CA 94063
   Owner: Cherry · gift approved by Cherry on Aug 2, 2026 — not sent yet
   Amiko Tanaka · 2118 Bancroft Ave, San Leandro, CA 94577
   Owner: Cherry · gift recommended (Visit went well) — awaiting approval from Cherry

[ Open dashboard to update ]
```

## 5. Open decisions

Nothing below is decided. Cherry's five stages are built exactly as she named them.

| # | Decision | Recommendation |
|---|---|---|
| 1 | **Verbal Agreement, Contract Sent and Long-Term Nurture appear nowhere.** Her five do not include them. | Add a section for Verbal Agreement + Contract Sent. A verbal agreement with no contract out is a deal being lost to silence. |
| 2 | **Overdue visits have no section of their own** — they are flagged `OVERDUE` inside Upcoming Visit and sorted to the top. | Keep as is. It is visible without adding a section she did not ask for. |
| 3 | **Gift Follow-Up lists a lead that also appears under its stage.** Breaks the earlier "one lead, one section" rule, deliberately. | Keep. The alternative hides every gift. |
| 4 | **Legacy imported records.** ~209 rows with no owner and old dates. Most sit at `Visit Completed — Needs Review`, so they will fill section 2. | Exclude pre-cutover records from the notification, keep them in the sheet, clean up separately. Cherry supplies the cutover date. |

Decision 4 is the one that determines whether the 10-second goal is met in practice. Everything else
can be right and it still fails on volume.

## 6. Cancelling a visit — Cherry's second change

*"If the status of the calendar is cancelled it should not be removed in the calendar and this will
notify as well."*

This previously **deleted** the calendar event. That was wrong, and she is right about why: a visit
vanishing off Juan's day is indistinguishable from it never having been booked, so nobody learns the
seller cancelled and no record survives that the slot was held.

Now, when a dashboard change sets `Visit Status` to `Canceled` / `Reschedule Needed`, or the stage to
`Lost / Closed Out`:

- the event **stays** on the date it was booked
- its title gains a tag: `[CANCELED]`, `[RESCHEDULE NEEDED]` or `[CLOSED OUT]`
- **all reminders are removed**, so a cancelled visit cannot ping anyone to leave the office
- the reason and date are appended to the description — `CANCELED on Aug 5, 2026 by Cherry — kept for the record.`
- a **Chat alert fires once**, at the moment it happens

The alert is immediate rather than waiting for 3pm, because by 3pm Juan may already have driven there.
It fires only on the transition — `syncVisitCalendar_` runs after *every* dashboard write, so an
unconditional alert would re-announce the same cancellation on every later edit.

Deletion now happens in one case only: a row with **no visit date left** to sit on.

Both the tag and delete paths share one `findVisitEvents_` matcher, which strips any existing tag
before matching. Without that, re-booking a cancelled visit would leave the tagged copy on the
calendar permanently.

## 7. Rollout

**Status: `READY FOR CHERRY APPROVAL`.** Not ready for rollout — decisions 1 and 4 are open, and no
live output exists yet.

1. Cherry reviews the sample in §4 and answers the four decisions
2. Apply only what she approves; update the tests to match
3. Paste `apps-script/Code.combined.gs` into the workbook's script
4. Menu → **post the attention digest now** — one card, immediately, outside the 3:00 PM schedule
5. Screenshot for her sign-off, with confirmation that no lead data changed (the notification has no
   write path at all — evidenced by a test, not by inspection)
6. Only then install the 3:00 PM trigger

**Note:** check **Extensions → Apps Script → Triggers** for `sendAttentionDigestToChat` first. If it
is not listed, the 3:00 PM message has never run at all — in which case this is a new notification
rather than a revision, and Cherry should be told so.
