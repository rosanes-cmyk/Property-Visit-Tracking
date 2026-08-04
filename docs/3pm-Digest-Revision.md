# 3:00 PM Lead Notification — Revision

**Requested by:** Cherry · **Owner:** Jonathan Rosanes · **System:** Twin Visit Logger → Google Chat
**Status:** built and tested; two items below need approval before rollout.

Implemented in `apps-script/ChatNotify.gs` (`ATTENTION_BUCKETS`, `attentionBucket_`,
`sendAttentionDigestToChat`), mirrored into `apps-script/Code.combined.gs`, covered by
`tests/attention-digest.test.mjs` (63 checks).

---

## 1. Final category structure and priority order

| # | Bucket | Action expected | Fires when |
|---|---|---|---|
| 1 | 🚩 Visit Overdue | Confirm whether the visit happened — mark it Completed or Canceled. | `Visit Status` = `Scheduled` **and** `Visit Date` is before today |
| 2 | 💵 Offer Needs Completion | Enter the offer amount and sent date, or correct the status. | `Current Stage` = `Offer Sent` **and** `Approved Offer Amount` or `Offer Sent Date` is blank |
| 3 | 📋 Missing Next Action | Assign the next action and its due date. | `Next Action` or `Next Action Due Date` is blank — except in Long-Term Nurture (see §5) |
| 4 | 🗣 Missing Seller Motivation | Write up the post-visit seller motivation notes. | `Visit Status` = `Completed` or stage = `Visit Completed — Needs Review`, **and** `Seller Motivation` is blank |
| 5 | 👤 Missing Assigned Owner | Assign the person responsible for the lead. | `Assigned Owner` is blank |
| 6 | 🌱 Long-Term Nurture Missing Follow-Up | Add a future follow-up date. | stage = `Long-Term Nurture` **and** `Next Action Due Date` is blank or not in the future |
| 7 | 🐢 Stalled | Decide the next step, move to nurture, or close it out. | `Stalled Status` = `Yes` |
| 8 | ⚠️ Flagged — ambiguous, needs a person | Read the record and decide; it fits none of the buckets above. | `Data Quality Status` = `Exception` or `Incomplete` and none of 1–7 apply |

**One lead, one bucket.** The list is evaluated in this order and the first match wins, so
"appears once, in the most urgent applicable bucket" is true by construction rather than by a flag
somebody has to maintain.

**Bucket 8 is not the old catch-all.** It exists only because your rule *"if a record is ambiguous,
flag it for review instead of guessing"* needs somewhere to put those records. It catches what is
left after the seven actionable buckets have taken everything they can name. If it grows large, that
is itself a finding — it means a real category is missing.

## 2. Exclusions — records that never appear

- `Current Stage` = **Lost / Closed Out**
- `Current Stage` = **Contract Signed**
- `Source` = **TEST**
- No `Property Address` (there is nothing to act on)
- Anything matching none of the eight rules — a healthy lead is silent, and so is the whole digest
  when nothing needs attention

## 3. Sample 3:00 PM notification

Format only — the records shown are ones currently visible on the board, and the counts are
illustrative until it runs against the live sheet.

> **Work queue — 14 lead(s)**
> 2026-08-04 · start with Visit Overdue (1)
>
> 🚩 **1. Visit Overdue (1)**
> *Confirm whether the visit happened — mark it Completed or Canceled.*
> **David Jackowitz** · 1390 Estudillo Ave, San Leandro, CA 94577 · 👤 Juan · *visit was 2026-08-04, still marked Scheduled*
> ⎯
> 📋 **3. Missing Next Action (1)**
> *Assign the next action and its due date.*
> **Vaishali Mehta** · 608 Charter St, Redwood City, CA 94063 · 👤 Juan · *next action "Conduct scheduled visit & log outcome" has no due date*
> ⎯
> 🗣 **4. Missing Seller Motivation (5)**
> *Write up the post-visit seller motivation notes.*
> **Carol Parkinson** · 2409 Summer St, San Jose, CA 95116 · 👤 **UNASSIGNED** · *visit completed, seller motivation still blank*
> **Jeff Tipton** · 550 El Capitan Dr, Danville, CA 94526 · 👤 **UNASSIGNED** · *visit completed, seller motivation still blank*
> **Antoine Moore** · 3275 Dakota St, Oakland, CA 94602 · 👤 **UNASSIGNED** · *visit completed, seller motivation still blank*
> …and 2 more
> ⎯
> 🐢 **7. Stalled (7)**
> *Decide the next step, move to nurture, or close it out.*
> …
>
> [ Open dashboard to update ]

Each bucket is numbered so the priority order is visible on the card, the header names the bucket to
start with, and every line carries seller · address · owner · exact reason. Eight lines per bucket,
then `…and N more`, so the card stays readable on a phone.

## 4. What changed from the current version

| Before | After |
|---|---|
| 4 buckets | 8 buckets, one action each |
| One "Needs review / missing data" pile holding every incomplete field | Each missing field has its own bucket with its own instruction |
| "Overdue next actions" — a database condition | Removed as a bucket; see question D below |
| Header: *Needs attention — N lead(s)* | Header: *Work queue — N lead(s) · start with \<bucket\> (n)* |
| Buckets unnumbered | Numbered 1–8, priority visible |
| Reason sometimes just the flag name | Reason always states the specific gap, e.g. *"a due date with no action written against it"* |
| Contract Signed leads appeared | Excluded |
| Tests re-implemented the rules | Tests run the shipped function, so they cannot drift from it |

Unchanged: the 3pm trigger, the Chat webhook, one-lead-one-line, and the exclusion of
Lost / Closed Out and TEST rows. **The digest still writes nothing** — no due date and no next
action is created in order to raise an alert. That is asserted by a test.

## 5. Two decisions needing approval (change-control rule, §9 of your brief)

**(a) Long-Term Nurture is exempt from bucket 3.**
A nurture lead's next action *is* its future follow-up date. Bucket 3 fires on a blank
`Next Action Due Date`, so without this exemption bucket 3 would claim every nurture lead and bucket
6 would read zero permanently. Exempting nurture from 3 is the only way both buckets can exist.
Approve, or tell me to drop bucket 6 and let nurture leads report under Missing Next Action.

**(b) Bucket 8 exists at all.**
Your brief says not to leave data-quality issues in one generic bucket, and also to flag ambiguous
records rather than guess. Bucket 8 is the smallest thing that satisfies both. Approve, or tell me to
drop it — in which case a flagged record matching none of the seven simply won't appear, and only the
dashboard's *Exceptions Requiring Review* section will show it.

## 6. Answers to the questions in §6

**A. Can Cherry identify what needs attention within 10 seconds? — YES.**
The header names the top bucket and its count, so the first line read is *"start with Visit Overdue
(1)"*. Buckets are numbered and ordered, each with its instruction directly beneath the heading. No
line requires opening the dashboard to understand what to do.

**B. Does every bucket represent exactly one operational problem? — YES for 1–7. Bucket 8 is the
exception and is deliberate**, covering "ambiguous, a person must look". It is the only bucket whose
action is a judgement rather than a data entry, and it is last for that reason.

**C. Can a manager tell immediately which employee needs to act? — YES, with one caveat.**
Every line ends with `👤 <owner>` or `👤 UNASSIGNED` in bold. The caveat: because your priority order
puts Missing Next Action (3) above Missing Assigned Owner (5), a lead missing *both* reports under
bucket 3, so bucket 5's count will look small while ownerless leads sit higher up. Every line still
shows UNASSIGNED, so nothing is hidden — but if you want all ownerless leads gathered in one place,
bucket 5 has to move above bucket 3. See D.

**D. Is the priority order correct? — Two recommendations, neither implemented without your say-so.**

1. **Move Missing Assigned Owner to position 2.** You cannot action "assign the next action" on a
   lead nobody owns — the instruction has no recipient. Assigning owners first makes every bucket
   below it actionable by a named person. As specified, ownerless leads are scattered across buckets
   3, 4, 6 and 7.
2. **Consider an "Overdue Next Action" bucket.** Your seven cover *missing* commitments but not
   *broken* ones: a lead with a real next action whose due date has passed currently appears nowhere
   unless it also trips Stalled. The old digest reported 49 of these. That is the largest behaviour
   change in this revision and I have not tried to hide it — if a written commitment going past its
   date should be on the queue, it wants a bucket, and I would put it at 2.

**E. Edge cases and combinations that do not fit cleanly:**

| Case | Current behaviour | Needs your decision? |
|---|---|---|
| Real next action, due date passed | Appears nowhere (unless Stalled) | **Yes** — see D2 |
| Missing owner *and* missing next action | Bucket 3 | **Yes** — see D1 |
| Nurture lead with no follow-up date | Bucket 6 | Approve §5(a) |
| `Visit Status` blank, `Visit Date` in the past | Not Visit Overdue — status was never set to Scheduled | Probably wants flagging; say if so |
| Visit Completed, motivation blank, no owner | Bucket 4 | No — motivation is the more specific action |
| `Offer Preparation` with no amount | Appears nowhere | Confirm: is a prepared-but-unpriced offer chase-worthy? |
| Legacy imports (≈209 with no REI link, no owner) | Will flood buckets 4, 5 and 7 | **Yes** — see below |

**The legacy rows are the biggest practical risk to the 10-second goal.** Around 209 imported records
have no REI link and no `Assigned Owner`, and the board already opens on 84 SLA breaches from them.
They are real rows, so every rule here catches them, and the first digest will be dominated by
pre-cutover history rather than live work. Three options: exclude records created before the cutover
date, backfill owners, or set them to `Lost / Closed Out` so they archive out. This is a business
decision and I have not assumed one.

## 7. Definition of done — status

| Criterion | Status |
|---|---|
| One lead, one bucket | ✅ first-match-wins; asserted by test |
| One bucket, one action | ✅ each bucket carries its instruction |
| 10-second clarity | ✅ header names the top bucket; needs your sign-off on the sample |
| Operational, not only technical | ✅ every reason states the action, not the flag |
| Reasoning documented | ✅ §5 and §6 above; nothing redesigned silently |
| Tested | ✅ 63 checks against the shipped function |
| Screenshot / test output before rollout | ⏳ needs one live run — menu → *post the attention digest now* |

**To see it live:** paste `apps-script/Code.combined.gs` into the workbook's script, then use the
Twin Visit Logger menu → **post the attention digest now**. That posts one card to the Chat space
without waiting for 3pm and without changing the trigger.
