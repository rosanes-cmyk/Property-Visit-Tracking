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

## TASK 3 — Deploy the polished Web App (short path) ⏸️ after Task 1 passes + Jonathan says go

This puts the full polished dashboard online, saving live to the DEV COPY. No token,
no OAuth client, no Netlify — Google handles the company sign-in.

**3a. Update the code file**
> In the DEV COPY → **Extensions → Apps Script**. Open the main code file (the one holding
> the project code) and **replace its entire contents** with `apps-script/Code.combined.gs`
> from the repo (branch `claude/twin-visit-logger-audit-klfeyo`). **Save**.

**3b. Add the dashboard HTML file**
> Click **＋ → HTML**. Name it exactly **`Dashboard`** (Apps Script adds `.html` itself).
> Delete the placeholder content and paste the entire contents of `apps-script/Dashboard.html`.
> **Save**.

**3c. Deploy**
> **Deploy → New deployment** → gear ⚙ → **Web app**.
> • Description: `Twin Visit Logger dashboard`
> • Execute as: **Me**
> • Who has access: **Anyone within twinhomebuyer.com**
> → **Deploy** → approve the permission prompt → **copy the `/exec` URL** and send it to Jonathan.

**3d. Smoke test (report results)**
> Open the `/exec` URL. Confirm: (1) it loads the board with real leads, (2) your email
> shows top-right, (3) click **＋ Add property**, add a test address → a "Saved ✔" toast
> appears → open the DEV COPY Data sheet and confirm the new row is there. Then delete that
> test row. Report: does add-from-dashboard show up in the sheet? (yes/no + screenshot)

> Later revisions: edit code/HTML → **Deploy → Manage deployments → Edit ✏️ → Version: New
> version → Deploy**. Same URL stays.

---

## Reporting
After each task, reply with: task number, the exact toast/log line you saw, and a
screenshot of the Board if relevant. Flag anything that errors — don't guess.
