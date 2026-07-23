# Twin Visit Logger — Full Automation Build Plan (code-only, no Cowork)

Decision (Jul 2026): automate the **Property Visit Lead Tracker** workflow entirely in
**code** (Apps Script triggers + webhooks), targeting the **new Twin Visit Logger**
(DEV COPY) as the single source of truth. **No Cowork / browser agent** in the runtime.

Human approval gates are preserved: **WhatsApp group creation and any seller-facing
message are never automated** — staged/flagged only.

## Pipeline → how each step is automated

| # | Workflow step (from the doc) | Automation mechanism | Status |
|---|---|---|---|
| 1 | Detect new "Appointment Booked" leads in REI BlackBook | REI automation/webhook → Apps Script `doPost` **intake endpoint** | endpoint TODO; REI webhook = client to enable |
| 2 | Stage WhatsApp group (never auto-create) | Flag + staged plan in dashboard; **human approves** | preserved as human gate |
| 3 | Log to tracker + dedupe (phone/address) | Apps Script (pure code) | TODO (part of intake) |
| 4 | Juan calendar event + drive-time "leave by" reminder | Apps Script **CalendarApp + Maps service** | TODO; needs Juan-calendar shared to sheet owner |
| 5 | Day-of WhatsApp monitoring | ❗ no code API — human/WhatsApp Business API | out of code scope |
| 6 | Feed updates back to tracker | Apps Script (from dashboard edits / intake) | partial (dashboard edits live) |
| 7 | Log notes in REI | REI API/webhook (if available) | client to confirm REI API |
| 8 | After confirmed visit: draft seller thank-you (staged) + Cherry "Send offer" task | Apps Script Task Queue (task auto); **text stays human-approved** | TODO |
| — | **Scheduling-conflict detection** (same inspector, same day) | Apps Script/dashboard (pure code) | ✅ DONE |
| — | SLA / service-failure flag, stalled, daily report | Apps Script (built earlier) | ✅ DONE |

## The two honest external dependencies (not Cowork, but not free code either)
1. **REI BlackBook intake** — REI has no free in-session API. To get leads in automatically
   without a browser, REI must **push** (its Workflow/Automation/webhook, or Zapier) to our
   Apps Script `doPost` endpoint. I build the endpoint; the client wires REI to it.
2. **WhatsApp** — group creation + day-of monitoring have no free code API. Options:
   (a) keep this one step human (staged plan, person creates the group), or
   (b) integrate the paid **WhatsApp Business API**. Client decides. Seller messaging stays
   human-approved regardless.

## Calendar access
Juan's calendar (`pecuniary2@gmail.com`) must be **shared with edit rights to the account
that owns the Apps Script** (the DEV COPY owner) so `CalendarApp` can create events.

## Preserved business rules (from the workflow doc)
Trigger conditions (Appointment Booked / Kyle task); dedupe vs. tracker; viability
exclusions; never auto-create WhatsApp groups or send seller texts; never shift event
times for travel (reminder only); Step 8 only on confirmed-complete visits; no duplicate
"Send offer" tasks; leave cells blank rather than guess; stop-and-report on auth failure.

## Build order
1. ✅ Scheduling-conflict detection (done — dashboard section/KPI/ribbon/badge).
2. Calendar sync engine (event + drive-time reminder) — ready-to-enable once calendar shared.
3. `doPost` lead-intake endpoint (dedupe → tracker row → calendar → conflict check).
4. Cherry "Send offer" task on confirmed-complete visit.
5. (Client-side) REI webhook wiring + WhatsApp decision.
