# What triggers each notification

For Cherry. Every alert the system sends, the exact rule behind it, and what to do about it.

Nothing here is a judgement about anybody's work. Each alert is a **field being empty or a date
having passed** in the tracker — nothing more. If a lead appears that you know is already handled,
the alert is right about the sheet and the sheet is out of date. Fixing the sheet clears the alert.

---

## The three notifications

| When | What it sends |
|---|---|
| Every 5 minutes | **New booking** — one message per new appointment, as soon as it is booked |
| 9:00 am | **Today's visits** — what is scheduled, with the address and who is going |
| 3:00 pm | **Needs attention** — the four buckets below |

---

## The 3pm digest — the exact rules

A lead appears **once**, in the most urgent bucket that applies. It is checked in this order and
stops at the first match.

### 1. 🚩 Visit date passed, never completed

**Rule:** `Visit Status` is still **Scheduled** and `Visit Date` is before today.

Either the visit happened and nobody logged it, or it was missed. The system cannot tell which —
only that the sheet still says "Scheduled" for a date that has gone by.

**To clear it:** open the lead on the dashboard and press **Mark visit completed** (or set
`Visit Status` to `Canceled` if it never happened).

### 2. ⏰ Overdue next actions

**Rule:** `Next Action Due Date` is before today **and** somebody has written a `Next Action`.

The second half matters. A due date on its own is not a commitment — the automation stamps one when
a stage changes. Until this was fixed, 48 leads were reported as "overdue · no next action", which
was the system nagging about a date it had set itself. Those now go to bucket 4 instead, where the
empty field is the actual point.

**To clear it:** do the action and update the date, or change the next action to what is really next.

### 3. ⚠️ Needs review / missing data

**Rule:** the `Data Quality Status` column reads `Exception` or `Incomplete`. The reason is printed
next to the lead — it is never a vague "needs review".

Common ones:

| Message | Means |
|---|---|
| `Next Action, Next Action Due Date, Assigned Owner` | An active lead with nobody on it and no plan |
| `Completed visit missing Seller Motivation` | A visit in the last 30 days not yet written up |
| `Offer Sent needs Approved Offer Amount + Offer Sent Date` | An offer marked sent with no number recorded |
| `Long-Term Nurture needs an exact FUTURE follow-up date` | A nurture lead with no date — the one that gets forgotten |

Records already **Lost / Closed Out** or **Contract Signed** are never flagged. Neither is anything
with no activity for over 90 days — see below.

### 4. 🐢 Stalled

**Rule:** no activity for **3+ business days**, but **not more than 90 days**, and the lead is not in
Nurture, Contract Signed, or Lost.

The 90-day ceiling is new and it matters. Without it, every one of the 379 imported historical
records counted as "stalled" forever — a lead last touched in 2024 is not stalled, it is dormant, and
121 of them were burying the handful of deals that really are slipping this week.

"Activity" means the latest of `Last Contact Date`, `Last Updated Date`, and `Visit Date`.

---

## Why the count was 282

Two reasons, both now fixed:

1. **The same lead was counted up to four times.** Jose Anguiano appeared under overdue, under
   passed-visit, *and* under needs-review — one lead, three lines, three counts. Each lead now
   appears once.
2. **Two buckets were firing on data nobody could act on** — the 48 auto-stamped due dates and the
   121 dormant records described above.

The number you see now is a count of **leads**, not of findings, and the card says so.

---

## Why leads you have already visited still show up

Because the tracker was never updated for them. Two specific causes:

- **Imported history.** 379 leads were imported from the old workbook. Where the old sheet said
  *Pending Inspection*, the tracker says `Visit Status = Scheduled`. If that visit has since
  happened, the sheet does not know.
- **Visits completed in REI but not here.** Marking a task done in REI BlackBook does not update this
  tracker. Only the dashboard button or the sheet does.

**The fix is quick:** open the dashboard, find the lead, press **Mark visit completed**. It drops out
of the digest the same day. For a batch, the `Visit Status` column in the sheet can be edited directly.

---

## If an alert looks wrong

Send the lead's name and what you expected. Every alert traces back to one named column, so it is
always answerable — either the rule is wrong and gets fixed, or the sheet is stale and gets updated.
