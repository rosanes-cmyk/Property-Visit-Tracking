# Twin Visit Logger — User Guide

A friendly, task-based guide for Cherry and the acquisitions team (Jonathan, Kyle, Cherry, Juan, JM).

The Twin Visit Logger tracks every property from a confirmed visit through offer, negotiation,
contract, and closeout. You work almost entirely on two sheets:

- **`Data`** — one row per property. This is where you type things in.
- **`Cherry Opportunity Board`** — a read-only, always-up-to-date view of what needs attention today.

**Two things to remember:**

1. **The four-guarantee rule.** Every *active* property must always have **one Current Stage**,
   **one Next Action**, **one Assigned Owner**, and **one exact Next Action Due Date**. If any of
   those (plus Property Address and REI BlackBook Link) is blank, the property is flagged and shows
   up in the **Exception Queue** and in **Board section 10**. `Lost / Closed Out` records are exempt.
2. **The system never contacts sellers.** Every automatic action only updates your `Data` sheet and
   writes an internal note to the hidden **Automation Log** (and, if turned on, an internal email).
   Nothing is ever sent to a seller's phone or email.

Throughout this guide, "an automation fires" means the script fills in fields for you the moment you
type a value — you never have to run anything.

---

## How to add a property visit

1. Go to the **`Data`** sheet and start a new row at the bottom.
2. Enter **Property Address** (required), and as much as you have: **Seller Name**, **Phone**,
   **Email**, **Lead Source**, **REI BlackBook Link** (required for active records).
3. Enter **Visit Date**, **Visit Time**, and set **Visit Status = Scheduled** (dropdown).

**What fires automatically:** setting Visit Status to **Scheduled** sets **Current Stage =
Visit Scheduled**, fills a **Next Action** and **Next Action Due Date** (the visit date) if blank,
runs a duplicate-active check on the address, and logs a reminder.

> Tip: leave **REI BlackBook Link** blank on purpose and the row will show as **Incomplete** until
> you add it — that's the system reminding you it is the source of truth.

---

## How to complete a visit

1. Find the property's row. Set **Visit Status = Completed**.
2. Fill in **Visit Notes** (required) and **Seller Motivation**. Also good to capture:
   **Property Condition**, **Occupancy Status**, **Photos Link**, **Video Link**.

**What fires automatically:** sets **Current Stage = Visit Completed — Needs Review**, sets
**Assigned Owner = Jonathan** (if blank), sets **Next Action Due Date = today** (same-day review),
and logs a review task. If **Visit Notes** is blank the row becomes an **Exception**.

> If nobody makes an offer decision within 1 business day, the hourly check forces the due date to
> today and escalates once to **Cherry** (Jonathan stays the reviewer).

---

## How to assign the next action

For any active property, make sure these four fields are filled:

1. **Current Stage** (dropdown, one of the 10 stages)
2. **Next Action** (what happens next, in plain words)
3. **Assigned Owner** (dropdown: Jonathan · Kyle · Cherry · Juan · JM)
4. **Next Action Due Date** (an exact date)

If any is blank, **Missing Required Fields** lists it and the row appears in the Exception Queue and
Board section 10. Filling all four clears it.

---

## How to record an offer

1. Enter the **Approved Offer Amount** on the property's row.
2. When the offer actually goes out, enter the **Offer Sent Date**.

**What fires automatically:**

- Entering **Approved Offer Amount** → **Current Stage = Offer Preparation**, **Assigned Owner =
  Kyle**, **Offer Status = In Preparation**, **Next Action = "Prepare offer"**, **Due = +1 business
  day**, and an offer-prep task is logged (with address, amount, due date, REI link).
- Entering **Offer Sent Date** → **Current Stage = Offer Sent**, **Offer Status = Sent**,
  **Next Action = confirm receipt then follow up**, **Due = +2 business days**, **Assigned Owner =
  Cherry** (if blank), and a follow-up is logged.

> An Offer Sent row with no **Approved Offer Amount** and **Offer Sent Date** is correctly flagged
> as an **Exception** — that's the guardrail working.

---

## How to record follow-up

1. After any contact with the seller, enter the **Last Contact Date** and **Last Contact Result**.
2. Update the **Next Action** and **Next Action Due Date** for the next step.
3. If something is blocking progress, set the **Blocker** (Price, Title, Tenant, Family, Access,
   Timing, Documents, Property Condition, Seller Unresponsive, Other).

**What fires automatically:** every edit stamps **Last Updated Date** and **Updated By**.
**Days Since Last Activity**, **Days Overdue**, and **Stalled Status** recalculate. If a deal sits
3+ business days with no activity, **Stalled Status = Yes**, it appears in **Board section 4**, and
the daily stalled check logs a notice to the owner (only once per stalled spell).

---

## How to record a seller counter

1. Enter the **Counteroffer Amount** (or set **Offer Status = Countered**).
2. Fill in **Last Contact Result**, and confirm **Next Action**, **Assigned Owner**, and
   **Next Action Due Date**.

**What fires automatically:** **Current Stage = Active Negotiation**, **Assigned Owner = Cherry**
(if blank), and a notify-Cherry/Juan task is logged. If Last Contact Result / Next Action / Owner /
Due Date are missing, the row becomes an **Exception** (validation rule 4).

> When a deal is agreed, set **Offer Status = Accepted** or **Current Stage = Verbal Agreement** →
> the system sets **Current Stage = Verbal Agreement**, **Assigned Owner = Kyle**, **Next Action =
> Prepare purchase contract**, **Due = +1 business day**, and logs the highest-priority task.

---

## How to move a seller to nurture

1. Set **Current Stage = Long-Term Nurture**.
2. Enter an exact **future** follow-up date in **Next Action Due Date** and a clear **Next Action**.

**What fires automatically:** **Assigned Owner = Cherry** (if blank). If the follow-up date isn't a
real future date, the row becomes an **Exception** (validation rule 7). Nurtured deals are excluded
from Stalled alerts. If a nurtured/lost deal goes 45+ days dormant, it resurfaces in **Board section
9 (Revival Opportunities)**.

---

## How to close out a property

1. Set **Current Stage = Lost / Closed Out**.
2. Enter the **Final Disposition** (Contracted · Lost · Long-Term Nurture · Closed Out) and a
   **Closeout Reason**.

**What fires automatically:** active follow-up stops. Both **Final Disposition** and **Closeout
Reason** are required — if either is blank the row becomes an **Exception** (validation rule 8).

> Closed-out records are **exempt** from the four-guarantee rule, so they do not get flagged
> Incomplete for a missing Next Action / Owner / Due Date.

---

## How to hand off a signed contract

1. Enter the **Contract Sent Date** when the contract goes out.
2. Enter the **Contract Signed Date** once it is signed.

**What fires automatically:**

- **Contract Sent Date** → **Current Stage = Contract Sent**, **Next Action = confirm signature**,
  **Due = +1 business day**, and a daily internal follow-up is logged until signed or declined.
- **Contract Signed Date** → **Current Stage = Contract Signed**, **Final Disposition = Contracted**,
  **Transaction Handoff Status = Ready for Handoff**, **Assigned Owner = JM**, **Next Action = Hand
  off to JM**, **REI Update Required = Yes**, sales follow-up stops, and a JM handoff is logged.

Signed deals show green on the board. They stay in **Board section 7 (Contract Handoffs)** until
**Transaction Handoff Status = JM Confirmed**.

---

## How to use the Cherry Opportunity Board

The **`Cherry Opportunity Board`** is read-only and always live. It shows only actionable
opportunities, in ten sections:

1. **Contracts Possible This Week** — Verbal Agreement, Contract Sent, Active Negotiation
2. **Visited — No Offer Decision** — Visit Completed — Needs Review
3. **Offer Sent — Follow-Up Due**
4. **Stalled Deals** — Stalled Status = Yes
5. **Overdue Tasks** — Days Overdue > 0
6. **Negotiation Decisions** — Active Negotiation
7. **Contract Handoffs** — Contract Signed, not yet JM Confirmed
8. **Gift Review** — Gift Status = Recommended
9. **Revival Opportunities** — Lost and 45+ days dormant
10. **Exceptions Requiring Review** — Data Quality = Exception or Incomplete

Each row shows: **Property Address · Seller Name · Current Stage · Next Action · Assigned Owner ·
Next Action Due Date · Days Overdue · Blocker · Last Contact Result · REI BlackBook Link**. Sections
sort by contract-likelihood (Opportunity Priority) first, then Days Overdue, then nearest due date.

**Quick filters** (saved Filter Views): My Tasks · Due Today · Overdue · Stalled · Needs Offer
Decision · Offer Follow-Up · Negotiation Decision · Contracts Possible This Week · Gift Review ·
Exceptions.

**Color key:**

- 🔴 **Red** = error / overdue — fix now.
- 🟠 **Orange** = warning / incomplete / stalled — needs attention.
- 🟢 **Green** = signed / complete — no action needed.
- Neutral = standard.

You don't edit the board. When you fix something on the `Data` sheet, the board updates itself.

---

## How to resolve exception records

A property lands in the **Exception Queue** (and Board section 10) when **Data Quality Status** is
**Incomplete** (a required field is blank) or **Exception** (a cross-field rule failed).

1. Read the **Missing Required Fields** column (what's blank) and the **Exception Reason** column
   (which rule failed).
2. Fix the underlying `Data` row:
   - **Incomplete** → fill the missing Current Stage / Next Action / Assigned Owner / Next Action
     Due Date / Property Address / REI BlackBook Link.
   - **Exception** → satisfy the rule named, e.g. add Visit Notes for a completed visit, add the
     offer amount + sent date for Offer Sent, add Closeout Reason for a Lost deal, or resolve a
     **Duplicate Address Flag** (only one active record per address).
3. Once fixed, **Data Quality Status** flips to **OK** and the row drops off the board automatically.

> These are computed columns — never type into Missing Required Fields, Data Quality Status, or
> Exception Reason. Fix the source fields and they clear themselves.

---

## How bookings log themselves automatically (Gmail auto-reader)

You do **not** have to type visits into the sheet. When you book an appointment in REI BlackBook,
the visit logs itself — as long as you **name the task correctly**. Here is why and how.

### Why the task title matters
REI BlackBook does not let any outside tool read a task's *description*. The only part of a task
that leaves REI automatically is the **task title**, which rides along in the
"You have 1 new task assignment" email from `noreply@reiblackbook.com`. Our script reads that email
from Gmail every 10 minutes and logs the visit. So **whatever you put in the title is all the system
can see.**

### The one rule when booking
Title the booked-appointment task in this exact order, separated by the pipe character `|`:

```
Booked appointment | Seller Name | Property Address | Date Time
```

**Example:**

```
Booked appointment | Cyn Ku | 2607 Gimelli Place #115, San Jose | Jul 24 11:00 AM
```

- The title **must contain the words "Booked appointment"** — that is how the script knows it is a
  visit (other tasks like "Run Comps" are ignored).
- Put the **address in the title** — without it, the booking is safely skipped (nothing wrong is
  logged), and it will not appear on the dashboard.
- Date formats like `Jul 24 11:00 AM`, `July 30, 2026 2:30 PM`, or even `on Jul 24` all work.

### What happens next (fully automatic)

```
You save the task  →  REI emails it  →  Gmail  →  script reads it (every 10 min)
   →  dashboard card + calendar event + Automation Log
```

- The visit shows up on the **Data** sheet and the **Cherry Opportunity Board** within ~10 minutes.
- Duplicate reminder emails can never create duplicate rows — the system matches on the address and
  updates the existing record instead.
- Processed emails get a **`PV-Logged`** label in Gmail so they are never counted twice.

### Turning it on (one time, in the Sheet)
From the **🏠 Twin Visit Logger** menu:

1. **📧 Set up Gmail auto-reader (REI tasks)** — approve Gmail access when asked (it only reads REI
   emails and adds the `PV-Logged` label; it never sends anything).
2. **📧 Turn ON Gmail auto-reader (every 10 min).**

Use **📧 Check REI emails now** any time to run it immediately instead of waiting.

> If a booking does not show up: open the task in REI and check the **title** follows the
> `Booked appointment | Seller | Address | Date Time` format. A missing address is the usual reason.
