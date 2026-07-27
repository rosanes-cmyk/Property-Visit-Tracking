# REI BlackBook → Twin Visit Logger — Webhook Setup (logger auto-update)

Goal: when a lead is booked / a task or note updates in REI BlackBook, REI POSTs it to our
Apps Script endpoint, which **auto-creates or updates the row in the logger** (note, visit
status, stage, next action), **puts a "Property Visit" event on the calendar**, and **writes a
line to the Automation Log**. **No seller messages, no notifications** — internal update only.
(Sandbox is on: `CFG.SANDBOX = true`, so rows are tagged `Intake-Sandbox`. Calendar goes to
`CFG.VISIT_CALENDAR_ID = rosanes@twinhomebuyer.com` — your calendar for now.)

## 1. Endpoint
Your deployed Web App `/exec` URL (from Deploy → Manage deployments). Same URL as the dashboard.

## 2. What REI sends (POST body, JSON)
```json
{
  "token": "<your CFG.API_TOKEN>",
  "action": "intake",
  "lead": {
    "Property Address": "1710 Napa St, Vallejo, CA 94590",
    "Seller Name": "Gene Peterson",
    "Phone": "(415) 823-1413",
    "Lead Source": "PPL - Property Leads",
    "REI BlackBook Link": "https://my.reiblackbook.com/contacts/20523518",
    "Visit Date": "2026-07-24",
    "Assigned Visitor": "Juan",
    "Notes": "HOT — ready to sell; present as appraisal inspection"
  }
}
```
- `token` **must** match `CFG.API_TOKEN` in the Apps Script (set it before going live).
- Field names can be the sheet labels above **or** short keys (address, seller, phone, lead,
  rei, visitDate, visitor, note). Missing fields are just skipped.

## 3. Behavior (upsert)
- **New** (address/phone not in the sheet) → creates a row, stage = **Visit Scheduled**,
  Source = `Intake` (or `Intake-Sandbox` while sandbox is on).
- **Existing** (matches by address or phone) → **updates** Last Contact Result (note),
  Visit Status, Current Stage, Next Action, Visit Date, Assigned Visitor; stamps Last Updated.
- Either path also: **creates/updates the calendar event** and **writes an `INTAKE` line to the
  Automation Log** (Timestamp · Level · Property ID · Message). Delete the row in the dashboard →
  the calendar event is removed too; restore it → the event comes back.
- **Never** creates duplicates; **never** sends anything to a seller.

## 4. Wire it in REI BlackBook
Use REI's **Automation / Workflow → Webhook** (or Zapier "Webhooks by Zapier → POST"):
1. Trigger: contact tagged **"Appointment Booked"** (and/or task/appointment updated).
2. Action: **POST** to the `/exec` URL, `Content-Type: application/json`, body as above,
   mapping REI merge fields into the `lead` object.
3. Use REI's **"Send test"** to fire one → a row appears in the DEV COPY.

## 5. Test first (no REI needed)
In the Apps Script editor run **`testIntake`** → log should show a create, then an update
("upsert: OK"), and it cleans up its own test row.

## 6. Go-live toggles (later, when you resume calendar/notify)
- `CFG.SANDBOX = false` + `CFG.VISIT_CALENDAR_ID = 'pecuniary2@gmail.com'` → turns on Juan's
  calendar events (paused for now).
- Notifications stay off unless you set `OWNER_EMAILS` (internal only; never a seller).
