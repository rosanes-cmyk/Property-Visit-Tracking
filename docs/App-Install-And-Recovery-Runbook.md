# Twin Visit Logger — the app: install, move, update, recover

This is the document to open when a PC dies, when a new machine needs setting up, or when something needs
updating. It exists because the answer to *"what if my pc got damage"* should be on paper before it happens,
not in a chat somebody has to go and find.

---

## The one-minute version

| You want to… | Do this |
| --- | --- |
| Set up a PC | Run `TwinVisitLogger-Setup.exe`, or double-click **SET-UP-THIS-PC.cmd** in the folder |
| See whether it's working | **Dashboard — is it working?** in the Start menu |
| Sign in to REI again | **Sign in to REI again** in the Start menu |
| Move the automation to another PC | **Make this PC the active one**, on the PC taking over |
| The active PC is broken | In the sheet: 🏠 Twin Visit Logger → **💻 Release the PC** |
| Install an update | **Check for an update** in the Start menu, then Install |
| An update broke something | `scripts\update-app.cmd --rollback` |
| Stop everything | **Pause everything** in the Start menu |

---

## What lives where

Almost nothing important is on the PC. That is the point.

| | Where it lives | Lost if the PC dies? |
| --- | --- | --- |
| Every lead, every visit, every note | Google Sheets | **No** |
| The calendar | Google Calendar | **No** |
| Settings (tracker tab, calendar, Chat webhook) | The workbook's hidden **Automation Settings** tab | **No** |
| Which PC is the active one | Same tab | **No** |
| Google sign-in token | The PC | Yes — one click to redo |
| REI session | The PC | Yes — one sign-in to redo |
| Logs | The PC | Yes, and they don't matter |

So a dead PC costs **two sign-ins**, not data.

---

## Setting up a PC

1. Run the installer, or copy the folder and double-click **SET-UP-THIS-PC.cmd**.
2. Sign in to Google — one click on the consent screen.
3. Sign in to REI — type the password, wait for the dashboard, close the window.
4. Everything else happens by itself: settings read from the workbook, this PC claimed, all eight scheduled
   jobs created, and a verification pass that checks the sheet and REI are actually readable.

It ends either **READY** or with `--->` lines, each naming what to do. It is safe to run again — every step
skips what's already done.

### The two sign-ins cannot be removed

Google requires a human to click Allow in a browser; that consent is what makes the token yours.

The REI password is a **deliberate refusal**. Storing it would put it in a file that gets copied to every PC
and onto whatever stick carries the installer. A leaked REI password is a different order of problem from a
spreadsheet nobody swept for an afternoon.

### Before the first install, once

In the sheet: 🏠 Twin Visit Logger → **💻 Publish settings for the PC app**.

That writes the tracker tab, calendar and Chat webhook into a hidden, protected tab the app reads after
signing in to Google. It's why nothing has to be typed during setup. Re-run it whenever the webhook or
calendar changes.

> ⚠️ That tab contains the Chat webhook, which is a credential. Anyone who can open the workbook can read it —
> the same people who can already post in the space, so nothing new is exposed. But don't screenshot it or
> paste it into email.

---

## Only one PC may RUN it

Install on as many machines as you like. Only one may actually run: **two PCs driving REI on the same account
is what logs REI out.** It's the reason the browser lock exists at all.

The workbook records which machine is active. Every job checks it, and a spare PC prints:

```
This PC (LAPTOP-2) is not the active one — "DESKTOP-JR" is, since 2026-08-11.
Standing down. Nothing was read, written or posted, and nothing is wrong.
```

Its dashboard says **Standby**.

### Moving it

On the PC that should take over: **Make this PC the active one**.

If the old PC is still running, this **refuses** — deliberately. Taking a live claim quietly causes the exact
REI logout the registry prevents. Add `--force` when you're sure the other machine is off or finished; the old
one notices and stands down within a couple of minutes.

If the old PC is broken and can't release its own claim, do it from the sheet:
🏠 Twin Visit Logger → **💻 Release the PC**.

### Two deliberate exceptions

- **Settings tab not published yet → everything runs normally.** Otherwise shipping this would have silently
  switched off the machine that was already working.
- **Can't reach the sheet → everything runs normally.** One bad network minute must not turn the automation
  off silently.

---

## Updates

Updates arrive through a folder in **your own Google Drive** called exactly:

```
Twin Visit Logger Updates
```

Put a package in it named `TwinVisitLogger-1.4.0.zip`. The app reads that folder with the Google login it
already has, so there's no password stored anywhere and nothing hosted publicly.

Then either click **Install now** on the dashboard, or use **Check for an update** in the Start menu.

> 🔒 **Keep that folder private to you.** Anything in it gets **run** on the PC, as that Windows user, with the
> Google token and REI session right there. Not shared with the team, not "anyone with the link". No amount of
> code can compensate for getting this wrong.

### What the updater refuses to do

- Install while a job is running — swapping files under a live sweep corrupts the browser profile, and that
  means REI logs you out. (A lock left by a *dead* run doesn't block it.)
- Install anything it couldn't verify. Truncated or corrupt downloads are discarded, not installed.
- Install a version that isn't newer.
- Install silently. It's a button because a bad version installing itself overnight is how an automation stops
  for a day before anyone notices.

Your `.env`, Google token, REI session, logs and local state are carried across. The previous version is kept
alongside, and `scripts\update-app.cmd --rollback` puts it back.

**One quirk worth knowing:** if you start the update from the dashboard, the swap waits for the dashboard
window to be closed — the server is running from the folder being replaced. The page says so.

---

## When something looks wrong

Open the dashboard first. It's built to answer exactly this, and it distinguishes four states rather than two.

| Dashboard says | Means | Do |
| --- | --- | --- |
| **Idle** + last run summary | Working, nothing to do right now | Nothing |
| **REI sweep · reading <name> (4 of 12)** | Working | Nothing |
| **Possibly stuck** | Alive but silent 3+ minutes | Wait one cycle; if it persists, `pause.cmd` then `resume.cmd` |
| **Run stopped** | A run died mid-way | Nothing — the next one picks up where it left off |
| **Logged out** (red) | REI ended the session | **Sign in to REI again** |
| **Standby** | Another PC is the active one | Nothing, unless you meant this one to run |
| **Paused** | Somebody ran `pause.cmd` | `resume.cmd` |
| Card: *"the card will wait for a fresh sweep"* | The sweep hasn't succeeded recently | Check the PC is awake and REI is signed in |

You'll also get Chat messages for the one condition that stops everything:

> ❌ REI is LOGGED OUT on DESKTOP-JR — the sweep read 0 of 12 lead(s). …

That one ignores `CHAT_ALERTS=off`, because it doesn't mean "a lead changed", it means *nothing is working*.
Expect it every few weeks. It's throttled to once every two hours.

---

## The honest limits

**A sleeping PC still stops everything.** No amount of packaging changes that. If the machine is asleep at
08:45 there's no sweep, and the 9am card holds for 30 minutes and then posts saying the data may be out of
date. The only permanent fix is moving the automation to an always-on machine in the cloud — roughly
$10–25/month, and REI sign-in would then be done by remote desktop.

**REI logs you out on its own, periodically.** It always has. It can't be fixed from our side and the password
is deliberately not stored. What's fixed is that you're now *told*.

**The work-queue card can still be late.** By design: it waits up to 30 minutes for a fresh REI sweep before
posting, because a card that looks current and isn't is worse than one that's late. After 30 minutes it posts
anyway, saying so — silence would read as "nothing needs doing".

---

## Building the installer (for whoever maintains this)

```powershell
cd twin-visit-logger-sandbox
powershell -ExecutionPolicy Bypass -File .\scripts\build-installer.ps1
```

Two steps: package the portable folder, then compile it. Needs [Inno Setup](https://jrsoftware.org/isdl.php)
once. Without it you still get the portable folder, which works on its own — copy it and run
`SET-UP-THIS-PC.cmd` inside.

Output: `installer\Output\TwinVisitLogger-Setup.exe` — one file, per-user install, no administrator prompt.

**It installs to `%LOCALAPPDATA%`, not Program Files, and that is not laziness.** The app writes into its own
folder constantly — logs, the run lock, the heartbeat, the REI browser profile, and the whole folder during an
update. Under Program Files each of those needs elevation, and **scheduled tasks don't run elevated**, so they
would fail silently. That's a failure mode this project has already been bitten by twice.

The packager refuses to include `.env`, `credentials\`, `browser-data\`, logs or seller data — and if it finds
any of them in the built folder it **deletes the folder** rather than printing a warning into a console that
then closes. A package containing those would itself be a way into the accounts.
