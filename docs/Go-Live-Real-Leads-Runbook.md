# Go-Live Runbook — Real Leads + Edit-and-Auto-Save (DEV COPY)

Goal: the DEV COPY holds your **371 real leads** (from the original file), and the
web dashboard lets the team **edit / add** — with every change **auto-saved back to
the DEV COPY**. The original Property Visit Tracking file is never touched.

- **Target sheet:** `Property Visit Tracking — DEV COPY (Twin Visit Logger Upgrade)`
- **Who can edit:** anyone signed in with an `@twinhomebuyer.com` Google account
- **Secrets to reuse below:**
  - API token: `tvl_9f3Kx7Qm2SdP8vNb4Lr6Wc1Zy0Ha5Tg`
  - NEXTAUTH_SECRET: `PJ/HSds23AgOaZiKlP1iogXOqAUM0ZjzKlzeJPsq6xA=`

---

## STEP 1 — Load the 371 real leads into the DEV COPY

### Option A — Cowork (hands-off). Paste this to your coworker/Cowork:

> Open the Google Sheet **"Property Visit Tracking — DEV COPY (Twin Visit Logger Upgrade)"**.
> Go to **Extensions → Apps Script**. In the editor, click the **＋** next to "Files"
> → **Script**, name it **LoadRealLeads**. Delete the placeholder, then paste the ENTIRE
> contents of `apps-script/LoadRealLeads.gs` from the GitHub repo
> `rosanes-cmyk/Property-Visit-Tracking`, branch `claude/twin-visit-logger-audit-klfeyo`.
> Click **Save** (💾). In the function dropdown at the top, choose **loadRealLeads**, then
> click **Run**. Approve the permission prompt if asked (it's the account owner's script).
> Wait for the toast **"371 real leads loaded into the DEV COPY."** Then open the
> **Cherry Opportunity Board** tab and confirm it's populated. Report back the toast text.

### Option B — Do it yourself (5 minutes)
1. Open the DEV COPY → **Extensions → Apps Script**.
2. **＋ → Script** → name it `LoadRealLeads`.
3. Paste the whole `apps-script/LoadRealLeads.gs` file → **Save**.
4. Function dropdown → **loadRealLeads** → **Run** → approve prompt.
5. See "371 real leads loaded" → check the **Cherry Opportunity Board**.

> Safe to re-run anytime — it clears the input columns first, so no duplicates, and the
> formula columns (Days Overdue, Stalled, Data Quality…) always recompute.

---

## STEP 2 — Turn on edit-in-dashboard → auto-save

### 2A. Publish the save-back API (in the DEV COPY's Apps Script)
1. In `Config.gs`, set the token:  `API_TOKEN: 'tvl_9f3Kx7Qm2SdP8vNb4Lr6Wc1Zy0Ha5Tg'` → Save.
2. **Deploy → New deployment** → gear ⚙ → **Web app**.
   - Description: `Twin Visit Logger API`
   - Execute as: **Me**
   - Who has access: **Anyone**
   - **Deploy** → approve → **copy the `/exec` URL** (this is `APPS_SCRIPT_URL`).

### 2B. Create a Google sign-in credential (Google Cloud Console)
1. console.cloud.google.com → same Workspace → **APIs & Services → Credentials**.
2. **Create Credentials → OAuth client ID → Web application**.
3. Authorized redirect URI (add after Netlify gives you the site URL in 2C):
   `https://<your-netlify-site>.netlify.app/api/auth/callback/google`
4. Copy the **Client ID** (`GOOGLE_CLIENT_ID`) and **Client secret** (`GOOGLE_CLIENT_SECRET`).

### 2C. Deploy the website on Netlify
1. app.netlify.com → **Add new site → Import an existing project** → pick the repo,
   branch `claude/twin-visit-logger-audit-klfeyo`.
2. Netlify auto-detects Next.js (config is in `netlify.toml`, base = `web`). **Deploy**.
3. **Site settings → Environment variables** → add:
   | Key | Value |
   |---|---|
   | `APPS_SCRIPT_URL` | the `/exec` URL from 2A |
   | `APPS_SCRIPT_TOKEN` | `tvl_9f3Kx7Qm2SdP8vNb4Lr6Wc1Zy0Ha5Tg` |
   | `ALLOWED_DOMAINS` | `twinhomebuyer.com` |
   | `GOOGLE_CLIENT_ID` | from 2B |
   | `GOOGLE_CLIENT_SECRET` | from 2B |
   | `NEXTAUTH_SECRET` | `PJ/HSds23AgOaZiKlP1iogXOqAUM0ZjzKlzeJPsq6xA=` |
   | `NEXTAUTH_URL` | your Netlify site URL, e.g. `https://twin-visit-logger.netlify.app` |
4. Go back to 2B step 3 and paste the real site URL into the redirect URI. Save.
5. **Deploys → Trigger deploy → Deploy site** (so the env vars take effect).

### 2D. Verify
1. Open the Netlify site → sign in with an `@twinhomebuyer.com` account.
2. The board shows the 371 real leads (read live from the DEV COPY).
3. Click **Mark visit completed** / **Log follow-up** / **Add property** →
   open the DEV COPY sheet → the row updated within a couple seconds. ✅

---

## Rollback / safety
- To switch the live site from DEV COPY to the real sheet later: install the same
  Apps Script in the real sheet, redeploy its Web App, and swap `APPS_SCRIPT_URL`.
- To wipe and reload leads: re-run `loadRealLeads()`.
- The original Property Visit Tracking file is only ever *read* for leads — never written.
