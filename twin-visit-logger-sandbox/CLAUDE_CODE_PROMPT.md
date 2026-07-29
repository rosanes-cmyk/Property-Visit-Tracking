# Copy this into Claude Code

Open and finish the **Twin Visit Logger Sandbox** project in this folder.

Read `CLAUDE.md` and `README.md` completely before changing anything. Follow every safety and acceptance-test requirement in `CLAUDE.md`.

The required result is a local Node.js automation that runs without Claude credits after setup:

```text
REI automatic Gmail notification
-> extract direct REI BlackBook link
-> open it in a persistent Playwright sandbox browser
-> read the complete visible seller/contact/task/property/appointment/owner/notes/activity information
-> upsert one row in the configured DEV Google Sheet tracker
-> allow the existing dashboard to update from the tracker
-> create or update one Google Calendar event in America/Los_Angeles
```

Important rules:

- REI is read-only. Never modify REI, send communication, complete tasks, or change contact stages.
- Use the separate `browser-data/rei-sandbox` profile, not the normal Chrome profile.
- Never put passwords, cookies, OAuth tokens, seller information, screenshots, or HTML snapshots in Git.
- Do not guess missing information.
- Do not create duplicate rows or events.
- A reschedule must update the same Calendar Event ID.
- A cancellation must update the tracker and remove the Calendar event.
- Do not change dashboard layout/formulas.
- Do not add WhatsApp, direct REI API, reports, or unrelated features.

Start by running:

```powershell
npm install
npm run install-browser
npm run check
```

Then use a real REI link with:

```powershell
npm run inspect:rei -- "REAL_REI_LINK"
```

Inspect the generated local JSON/HTML and map stable REI selectors. Prefer `data-testid`, `data-test`, ARIA, and exact container-scoped selectors. Update `config/rei-selectors.json` first and change `src/rei/scraper.mjs` only when necessary.

Run one real sandbox test with `npm run once`, verify every acceptance test in `CLAUDE.md`, and fix only issues that block accurate Gmail -> REI -> tracker -> dashboard -> Calendar synchronization.
