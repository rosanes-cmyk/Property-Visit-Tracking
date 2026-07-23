# Web Dashboard — Twin Visit Logger

A mobile-friendly web dashboard built as a **Google Apps Script Web App**. The Google Sheet remains
the **database / source of truth**; the dashboard reads it live and its quick-actions write back
through the **same automation + validation** as a manual edit. It never contacts sellers and never
shows Source = TEST records.

## What it shows
The same 10 sections as the Cherry Opportunity Board — Contracts Possible This Week, Visited — No
Offer Decision, Offer Sent — Follow-Up Due, Stalled Deals, Overdue Tasks, Negotiation Decisions,
Contract Handoffs, Gift Review, Revival Opportunities, Exceptions — each card with seller, address,
stage, owner, due date (red if overdue), blocker, next action, last result, a link to REI BlackBook,
and quick-action buttons. Filters: **All / Due Today / Overdue / Stalled** and an **owner** picker
(My Tasks).

## Quick-actions (guarded)
Each writes the value **you enter** and then runs the matching automation handler (so Task Queue,
stage cascade, and validation all apply). It never sets prices or decisions on its own:
- Mark visit completed → Needs Review + Jonathan task
- Record offer sent (you enter amount + date) → Offer Sent + follow-up
- Seller countered (you enter counter + note) → Active Negotiation + Cherry/Juan alert
- Contract sent / Contract signed (you enter date) → stage + JM handoff on signed
- Log follow-up · Move to nurture (future date) · Set next action/owner/due

## Deploy (one-time)
1. Paste the latest `apps-script/Code.combined.gs` into the DEV COPY's Apps Script → **Save**.
   *(The manifest scope changed to full Sheets access for the web app, so you'll re-authorize once.)*
2. **Deploy → New deployment** → click the **gear ⚙ → Web app**.
3. Settings:
   - **Description:** Twin Visit Logger Dashboard
   - **Execute as:** **Me**
   - **Who has access:** **Anyone within Twin Home Buyer** (Workspace domain) — or **Only myself**
     to test first. *(If the account isn't Google Workspace, "Anyone within…" won't appear; use
     "Only myself", or "Anyone with the link" only if you accept that anyone with the URL can open it.)*
4. **Deploy** → **Authorize access** → allow.
5. Copy the **Web app URL** (ends in `/exec`). Open it — the dashboard loads live from the sheet.
6. On a phone: open the URL → browser menu → **Add to Home screen** for an app-like icon.

## Updating it later
After any code change: **Deploy → Manage deployments → ✏️ edit → Version: New version → Deploy.**
The same URL then serves the updated app.

## Notes
- Scope: the web app uses `https://www.googleapis.com/auth/spreadsheets` so it can read and write the
  bound sheet reliably when deployed.
- The dashboard is a **view + action** layer only; the sheet, its formulas, validation, automation,
  Task Queue, and Daily Report are unchanged and remain authoritative.
- Pilot scope unchanged: real records only, no full REI load, no automatic pricing/negotiation/gift,
  no seller contact.
