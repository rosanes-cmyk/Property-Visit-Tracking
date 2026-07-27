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

## 4. Wire it via Zapier (chosen path — instant, no REI API key)

> Note: REI's *email* notifications only contain the task **title + due date** (verified) — not the
> address/appointment — so email polling can't fill the logger. Zapier reads the task **fields**
> directly, so it gets the full data. This is why we use Zapier, not email.

Our endpoint accepts a **flat** payload (token + action + fields at the top level), so no nested
JSON is needed in Zapier.

**Zap steps:**
1. **Trigger** — App: **REI BlackBook**. Event: the one that fires when an appointment task is
   created — look for **"New Task" / "Task Created" / "Task Assigned"** (or, if REI only offers
   contact triggers, **"Tag Added"** and tag appointment contacts `Appointment Booked`).
   Connect your REI account and pick a recent task as the test record.
2. **Filter** (recommended) — add *Filter by Zapier*: only continue if **Task Title contains
   "Booked appointment"** (or Task Type = appointment). Keeps calls/texts/other tasks out.
3. **Action** — App: **Webhooks by Zapier**. Event: **POST**. Configure:
   - **URL:** your deployed `/exec` URL
   - **Payload Type:** `json`
   - **Data** (key → value; map REI fields with the picker):

     | Key | Value |
     |---|---|
     | `token` | `ORP9pfVWhZQKHuSYW9HMnoqYFwASBpy` |
     | `action` | `intake` |
     | `Seller Name` | REI contact name |
     | `Phone` | REI contact phone |
     | `Email` | REI contact email |
     | `Assigned Owner` | REI task assignee |
     | `Lead Source` | REI lead source (if available) |
     | `REI BlackBook Link` | REI contact URL (if available) |
     | `Property Address` | REI property address field (if available; else leave blank) |
     | `Task Body` | REI **task description / body** ← important: the parser pulls address + appt time from this |

   - **Wrap Request In Array:** No · **Unflatten:** No · **Headers:** (none needed)
4. **Test** the action → a row appears in the DEV COPY, an event on your calendar, and an
   `INTAKE` line in the Automation Log. **Turn the Zap ON.**

Why `Task Body` matters: REI tasks put the property address + real appointment time inside the
body text ("Property address: … / Booked appointment / visit scheduled: Friday, Jul 24, 11:00 AM").
`parseReiTaskBody_` extracts those automatically, so even if the clean fields above are blank, the
row still gets the address and visit date.

## 5. Test first (no REI/Zapier needed)
In the Apps Script editor:
- **`testReiTaskIntake`** → simulates a real REI task (parses address + appt from the body), keeps
  the row so you can see it in the dashboard. Delete it there when done.
- **`testIntake`** → create + upsert self-test that cleans up its own row.

## 6. Go-live toggles (later, when you resume calendar/notify)
- `CFG.SANDBOX = false` + `CFG.VISIT_CALENDAR_ID = 'pecuniary2@gmail.com'` → turns on Juan's
  calendar events (paused for now).
- Notifications stay off unless you set `OWNER_EMAILS` (internal only; never a seller).
