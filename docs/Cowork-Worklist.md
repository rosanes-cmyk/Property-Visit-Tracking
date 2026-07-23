# Cowork Worklist — Twin Visit Logger (DEV COPY)

All tasks run in the **DEV COPY**: *"Property Visit Tracking — DEV COPY (Twin Visit
Logger Upgrade)"*. Never touch the original file. Files are in the GitHub repo
`rosanes-cmyk/Property-Visit-Tracking`, branch `claude/twin-visit-logger-audit-klfeyo`.

---

## TASK 1 — Prove saving works (do this now) ✅ ready

> Open the DEV COPY → **Extensions → Apps Script**. Click **＋ → Script**, name it
> `TestSaveRoundTrip`, and paste the entire contents of `apps-script/TestSaveRoundTrip.gs`.
> **Save**. In the function dropdown pick **testSaveRoundTrip** → **Run** → approve the
> permission prompt. Open **View → Logs** (Execution log). Report the first line back —
> we want **"SAVE ROUND-TRIP: 8/8 checks passed."**

What it proves: adding/updating from the dashboard actually writes to the Google Sheet.
It cleans up its own test row, so nothing is left behind.

---

## TASK 2 — Load the 371 real leads ⏸️ HOLD until Jonathan says go

> (Do NOT run yet.) When approved: **＋ → Script**, name it `LoadRealLeads`, paste
> `apps-script/LoadRealLeads.gs`, **Save**, run **loadRealLeads**, approve. Expect the
> toast **"371 real leads loaded into the DEV COPY."** Then open the **Cherry Opportunity
> Board** to confirm it filled.

⚠️ Note: a **stage-mapping fix** (Acquired/Won → Contract Signed, 25 records incl. Denise
Marks) is still pending Jonathan's approval. Wait for the updated `LoadRealLeads.gs`
before loading, so we don't have to reload. Re-running is safe (it clears + reloads).

---

## TASK 3 — Deploy the Web App (short path) ⏸️ HOLD until Task 1 passes + Jonathan says go

> When approved: in the DEV COPY's Apps Script → **Deploy → New deployment** → type
> **Web app** → Execute as **Me** → Who has access **Anyone within twinhomebuyer.com** →
> **Deploy**. Copy the `/exec` URL and send it to Jonathan. (No token / OAuth / Netlify
> needed on this path — Google handles the company sign-in.)

---

## Reporting
After each task, reply with: task number, the exact toast/log line you saw, and a
screenshot of the Board if relevant. Flag anything that errors — don't guess.
