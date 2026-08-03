# Quick reference — Twin Visit Logger Sandbox

## Open PowerShell in the project

```powershell
cd "$HOME\Downloads\twin-visit-logger-sandbox\twin-visit-logger-sandbox"
```

## Everyday commands

| What you want | Command |
|---|---|
| Process new bookings now | `node src\run-once.mjs` |
| Same, but save the log to a file | `node src\run-once.mjs > run-log.txt 2>&1` |
| Keep it running continuously | `node src\poll.mjs` |
| Re-login to REI (session expired) | `node scripts\rei-login.mjs` |
| Delete automation events + email labels | `node scripts\cleanup.mjs --yes` |
| Preview what cleanup would delete | `node scripts\cleanup.mjs` |
| Test scraping one contact | `node scripts\test-scrape.mjs "https://my.reiblackbook.com/contacts/20528181"` |
| Edit settings | `notepad .env` |

## The task title template

```
Booked appointment | PHONE | DATE TIME
```

Real example:

```
Booked appointment | (209) 833-1958 | August 01, 2026 2:00 PM
```

Rules:

- Must start with `Booked appointment` (or `Cancelled appointment` to cancel).
- The **phone** must match the phone on the REI contact — that is how the contact is found.
- The **time is required**. A date with no time cannot become a calendar event.
- Keep it short. REI truncates long titles, which is why the seller name, address, and REI link are
  deliberately NOT in the title — those are read from the REI page automatically.

Accepted date formats: `August 01, 2026 2:00 PM` · `Aug 1, 2026 2:00 PM` · `8/1/2026 2:00 PM` ·
`Aug 1 2:00 PM` (assumes the current year).

## Only ONE automation may run

This local scraper and the workbook's Apps Script automations both write to the same sheet and
calendar. Running both produces conflicting rows and duplicate or wrongly-timed calendar events.

Before using this tool, turn the Apps Script ones off in the workbook menu
**Twin Visit Logger**:

- 📥 Turn OFF auto-check
- 📧 Turn OFF Gmail auto-reader

and leave the **Intake Inbox** tab empty.

## Calendar times are Pacific

Events are created in `America/Los_Angeles`, because that is where the properties are. If your Google
Calendar displays in another zone (for example GMT+08), a 2:00 PM Pacific visit shows as 5:00 AM the
next day. That is correct, not a bug.

To read both at once: **Google Calendar → Settings → Time zone → Display secondary time zone →
(GMT-07:00) Los Angeles**.

## Settings worth knowing (`.env`)

| Setting | Use |
|---|---|
| `GMAIL_QUERY` | Which emails to process. Use `newer_than:2d` for production; a shorter window like `newer_than:1h` is for testing only. |
| `SPREADSHEET_ID` | Which workbook to write to. Keep the DEV copy until go-live. |
| `CALENDAR_ID` | `primary`, or a dedicated calendar. |
| `ADD_MISSING_COLUMNS` | Keep `false` — the tracker already has its columns. |
| `REI_HEADLESS` | `false` shows the browser, `true` hides it. |
| `DRY_RUN` | `true` reads and logs but writes nothing. |

## When something does not appear

1. Does the task title contain the phone **and** a date **with a time**?
2. Does that phone match the REI contact's phone?
3. Did you run `node src\run-once.mjs` after creating the task?
4. Read the log — it names exactly which piece was missing.
5. If REI asks for a login, run `node scripts\rei-login.mjs` and try again.

## WhatsApp group per visit

When a property visit lands on Juan's calendar, this creates the WhatsApp group for it.

| What you want | Command |
|---|---|
| Log WhatsApp in (once) | `node scripts\whatsapp-login.mjs` |
| Check the selectors work on your build | `node scripts\whatsapp-doctor.mjs` |
| See what groups it WOULD create | `node src\whatsapp\watch.mjs` |
| Actually create them | `node src\whatsapp\watch.mjs --yes` |

Set these in `.env` first:

```
WHATSAPP_TEAM_NUMBERS=+14155550100,+14155550101
WHATSAPP_OWN_NUMBER=+14155550100
WHATSAPP_INCLUDE_SELLER=true
```

Read this before running it with `--yes`:

- **`WHATSAPP_INCLUDE_SELLER=true` puts the seller in the group.** Anything the team posts there —
  offer numbers, "seller seems motivated", condition notes — is visible to them. Set it to `false`
  if the group is meant to be a team/photo space.
- **It never sends a message.** It creates the group and stops. There is no send function in the
  code, and a selector that could match a send/delete/leave control is refused at runtime.
- **Without `--yes` nothing is created.** The dry run walks the flow, reports which numbers WhatsApp
  can actually find, and backs out.
- **Automating WhatsApp Web is against WhatsApp's terms** and accounts do get banned for it. Log in
  with a number the business can afford to lose, not Juan's main line.
- Past visits are ignored, cancelled events are ignored, and a group that already exists is recorded
  rather than created twice — so re-running is safe.

## Clearing the REI task automatically

Once the visit is on Juan's calendar **and** the WhatsApp group exists, the booked-appointment task
in REI is marked **complete** so the task list stays clean.

Turn it on in `.env`:

```
REI_COMPLETE_TASKS=true
```

Check the selectors first — read-only, clicks nothing:

```powershell
node scripts\rei-task-doctor.mjs "https://my.reiblackbook.com/contacts/20528181"
```

What it will and will not do:

- **Complete, never delete.** The task and its history stay on the contact. Nothing in REI is
  removed, and a selector matching delete/remove/trash/archive/cancel is refused at runtime.
- **Both checks must pass first.** It re-reads Juan's calendar to confirm the event is really there
  and requires the group to have been recorded. If either fails the task is left OPEN on purpose —
  an open task is the only thing that will make anyone notice a booking went missing.
- **The right task only.** Phone *and* date must both match. A seller with two properties has two
  tasks, and completing the wrong one would hide a visit that is still coming.
- **Nothing happens without `--yes`.** The dry run reports what it would complete and why.
