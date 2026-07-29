# How to book a property visit (so it logs itself)

Pin this. It takes about 15 extra seconds and replaces all manual tracker entry.

---

## Do these 2 things when you book

### 1. Title the task with the seller's phone number

```
Booked appointment | (209) 833-1958
```

The phone number is how the system finds the right REI contact. Keep the title short — REI cuts off
long titles.

### 2. On that contact in REI, fill in these two fields

| Field | What to put |
|---|---|
| **Appointment Date** | the visit date |
| **Appointment Time** | the visit time |

Both are required. A date with no time cannot become a calendar event.

---

## That's it

Within a few minutes, the system automatically:

- Adds the property to the **Data** sheet
- Shows it on the dashboard under **Upcoming Visits**
- Creates the **Google Calendar** event at the right Pacific time
- Fills in the seller name, full property address, assigned owner, lead source, and REI link

Nobody types anything into the spreadsheet.

---

## Two things a human still confirms on the row

- **Assigned Owner** — who is responsible for the visit
- **REI BlackBook Link** — verify it points at the right contact

---

## If a visit does not show up

Check, in this order:

1. Does the task title contain the phone number?
2. Does that phone number match the phone on the REI contact?
3. Are **Appointment Date** and **Appointment Time** both filled on the contact?

Nine times out of ten it is a missing **Appointment Time**.

**Backup option:** you can also put the date and time straight in the title — the system will use it
if the REI fields are blank:

```
Booked appointment | Jul 30, 2026 2:00 PM | (209) 833-1958
```

---

## Rescheduling and cancelling

- **Reschedule:** change **Appointment Date / Appointment Time** on the REI contact. The tracker row
  and the existing calendar event both update — no duplicate is created.
- **Cancel:** the row is marked Cancelled and the calendar event is removed.

---

## What the system never does

It never texts, emails, or calls a seller. It only reads REI and writes to our own tracker and
calendar.
