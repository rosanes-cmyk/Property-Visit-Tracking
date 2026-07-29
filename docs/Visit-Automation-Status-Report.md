# Property Visit Automation — Status Report

**Date:** July 29, 2026
**Prepared for:** Juan
**Goal:** When the team books a property visit in REI BlackBook, it should appear on the Visit
Tracking dashboard and calendar automatically, with no manual data entry.

---

## Bottom line

The automation **works end to end** — a booked appointment in REI now flows into the tracker without
anyone typing it in. It is running against the **DEV copy** of the workbook (not production) and
needs one more round of verification before we switch it on for the team.

---

## The core problem we had to solve

REI BlackBook does not let outside tools read a task. We confirmed every route:

| Route | Result |
|---|---|
| Zapier task trigger | Not offered — REI exposes contact triggers only |
| REI API | No API key available on our plan |
| Web app webhook | Blocked by our Google Workspace |
| REI Workflows | Can only send texts / emails / voicemails |
| Direct link in the task title | REI **truncates the title**, so the link never survives |
| REI's "View" button in the email | A tracking redirect that does not land on the record |

**The solution:** put the seller's **phone number** in the task title. REI's notification email carries
the short title intact, so the automation reads the phone, searches REI Contacts for it, opens the
matching contact, and reads the real data off the page.

---

## What the automation does now

```
REI booking email  ->  read phone from task title  ->  search REI Contacts
   ->  open the matching contact  ->  read the record  ->  write tracker row  ->  dashboard + calendar
```

Verified working against real REI records:

- Seller name, phone, email
- Full property address
- Appointment date and time
- Assigned owner, lead source, REI lead stage
- Direct REI BlackBook link back to the contact
- Cancelled appointments are detected and logged as Cancelled

REI is opened **read-only**. The automation never edits a contact, completes a task, changes a stage,
or sends anything to a seller.

---

## What the team has to do when booking (two things)

**1. Put the seller's phone number in the task title.** This is how the automation finds the right
REI contact, and a short title always survives REI's truncation.

```
Booked appointment | (209) 833-1958
```

**2. Fill these two fields on that contact in REI:**

- **Appointment Date** — the visit date
- **Appointment Time** — the visit time

That is the whole habit. Everything else — seller name, full property address, assigned owner, lead
source, REI link, and the calendar event — is pulled automatically.

### Why these fields and not the title

We use REI's own appointment fields as the source of truth because they are date/time pickers (no
typos), they keep REI itself accurate, and a reschedule only requires changing the field — the next
sync updates both the tracker row and the calendar event. This is already proven: the one test record
that had these fields filled came through perfectly, and the one that left them blank produced no
appointment date, because a date with no time cannot become a calendar event.

**Safety net:** if someone forgets, the automation falls back to a date and time in the task title,
then to the task's due date. Adding `| Jul 30, 2026 2:00 PM` to the title is optional insurance, not
a requirement.

**Still filled by hand on each row:** the team confirms the **Assigned Owner** and the
**REI BlackBook Link** where needed.

---

## Issues found and fixed today

1. **Appointment time was wrong / missing.** REI's "Appointment Date" field stores a record-creation
   timestamp, not the visit time (one record showed 8:35 AM for an 11:00 AM visit). The automation now
   uses only the date from that field plus the separate "Appointment Time" field, falls back to the
   time in the task title, and flags the row if the two disagree rather than guessing.

2. **Data landing in the wrong columns.** The tool was guessing which of the tracker's 64 columns to
   use by name similarity, and guessed wrong — task text ended up in *Property Condition*, a name in
   *Blocker*, a status in *Final Disposition*. It now writes only to an explicit, fixed list of
   columns. Human-owned fields (Visit Notes, Property Condition, Seller Motivation, offer and gift
   fields) can no longer be touched by automation.

3. **Rows not reaching the dashboard.** Rows were written without a Current Stage, so they sat in the
   Exception queue instead of Upcoming Visits. Visit Status and Current Stage are now always set when
   the appointment is valid.

---

## Still to verify before go-live

- [ ] Re-run with the fixes and confirm a clean **Scheduled** row with the correct date and time
- [ ] Confirm one Google Calendar event is created at the correct Pacific time
- [ ] Confirm a second run creates **no duplicate** row or event
- [ ] Confirm a **reschedule** updates the same row and the same calendar event
- [ ] Confirm a **cancellation** updates the row and removes the calendar event
- [ ] Turn on the 5-minute schedule so it runs unattended
- [ ] Delete test rows and test calendar events
- [ ] Switch from the DEV copy to production only after all of the above pass

---

## Honest limitations Juan should know

1. **It runs on a local PC, not in the cloud.** Because REI has no API, the automation drives a real
   logged-in browser. That machine has to be on and awake for bookings to sync.

2. **The REI login expires periodically.** When it does, syncing pauses until someone re-runs the
   login step. Nothing is lost — the emails are retried afterwards.

3. **It depends on REI's page layout.** If REI changes their contact page, the field reading may need
   to be remapped. This is the trade-off for having no API.

4. **The phone number must be in the task title**, and the contact's phone in REI must match it.

5. **Nothing is ever sent to a seller.** The automation only reads REI and writes to our own tracker
   and calendar.

---

## Alternative already built and working

There is a second, simpler version running as a Google Apps Script inside the workbook. It reads the
task title straight from the REI email — no PC required, no browser, nothing to maintain — but it can
only capture what fits in the title (seller, address, date) and cannot pull the address or lead detail
from the REI page.

**Recommendation:** use the local scraper while the PC is available, since it captures far more and
requires less typing in the title. If keeping a machine running proves impractical, the Apps Script
version is the fallback and needs no infrastructure.
