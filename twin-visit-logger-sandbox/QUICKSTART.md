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
| Find the ProfitDial from-number picker | `node scripts\inspect-profitdial.mjs "https://my.reiblackbook.com/contacts/20528181"` |
| Edit settings | `notepad .env` |

## Checking the ProfitDial "from number"

The outbound caller-ID picker is a custom widget, so its selectors had to be guessed. Instead of
recording them with `playwright codegen`, run the inspector — it opens the page in your logged-in
sandbox browser, finds the widget itself, and prints paste-ready selectors:

```powershell
node scripts\inspect-profitdial.mjs "https://my.reiblackbook.com/contacts/20528181"
```

In the browser window that opens, click the contact's **Chat/Text** panel so the picker is on screen,
then let the script finish. It prints `CONFIRMED` next to every selector that resolved, the number
currently selected, and every number offered. Copy anything it found into the `chat` block of
`config/rei-selectors.json`, replacing the guesses.

This is read-only: it opens the dropdown to read it and closes it again. It never clicks Call, Text,
or Send. To actually change the selected number, add `--set` — that is the only mode that changes
anything, it is never used by the polling automation, and it still refuses to click any control whose
text is not purely a phone number.

The target number lives in `config/rei-selectors.json` as `chat.expectedFromNumber`
(currently `(510) 916-3995`), or pass `--number "(510) 916-3995"`.

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
