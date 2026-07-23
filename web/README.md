# Twin Visit Logger — Web App (Next.js)

> **Chosen free host: Netlify** (free tier allows small commercial use). Deploy steps for a coworker/
> Cowork: [`../docs/Coworker-Netlify-Deploy-Runbook.md`](../docs/Coworker-Netlify-Deploy-Runbook.md).
> `netlify.toml` (repo root) already points the build at this `web/` folder. Vercel also works — the
> steps below list Vercel, but the env vars and Google-OAuth setup are identical for Netlify.


A standalone website for the pilot: Google sign-in (equitytrack.org / twinhomebuyer.com only), shows
every section (Contracts Possible, Needs Offer Decision, Offer Follow-Up, Stalled, Overdue,
Negotiation, Handoffs, Gift Review, Revival, Exceptions), and lets the team **add / update records
that save back to the Google Sheet**.

## Architecture (the sheet stays the database)
```
Browser (Google SSO, equitytrack.org)
   → Vercel serverless routes /api/data, /api/action  (session-checked; hold the secret token)
      → Apps Script Web App JSON API (?api=data / POST {token,action,id,params})
         → Google Sheet  ── runs the SAME automation (Task Queue, stage cascades, validation)
```
Writes go through `webAction` / `webAddRecord_`, so anything added on the website behaves exactly
like a manual sheet edit. No seller is ever contacted. Source = TEST rows are excluded.

## Local dev
```bash
cd web
cp .env.example .env.local      # fill in the values (see below)
npm install
npm run dev                     # http://localhost:3000
```

## Deploy — do these three parts in order

### A. Apps Script (make it an API)
1. In the DEV COPY → Extensions → Apps Script, ensure `Code.gs` is the latest `apps-script/Code.combined.gs`.
2. Set a strong secret: edit `CFG.API_TOKEN` (in the Config section) to a long random string → **Save**.
3. **Deploy → Manage deployments → ✏️ edit → Who has access: Anyone → Version: New version → Deploy.**
   (Access must be **Anyone** so Vercel's server can call it; every API call still requires the token.)
4. Copy the Web app **/exec URL**.

### B. Google OAuth (for sign-in)
1. Google Cloud Console → create/select a project owned by the Workspace.
2. **OAuth consent screen** → User type **Internal** (limits to your org) → fill app name/support email.
3. **Credentials → Create credentials → OAuth client ID → Web application.**
4. **Authorized redirect URIs:**
   - `http://localhost:3000/api/auth/callback/google` (dev)
   - `https://YOUR-VERCEL-DOMAIN/api/auth/callback/google` (add after first Vercel deploy)
5. Copy the **Client ID** and **Client secret**.

### C. Vercel
1. Push this repo to GitHub (already done: branch `claude/twin-visit-logger-audit-klfeyo`).
2. Vercel → **New Project → Import** the repo → set **Root Directory = `web`** (framework auto-detects Next.js).
3. Add **Environment Variables** (Production + Preview):
   | Name | Value |
   |---|---|
   | `GOOGLE_CLIENT_ID` | from step B |
   | `GOOGLE_CLIENT_SECRET` | from step B |
   | `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
   | `NEXTAUTH_URL` | your Vercel URL, e.g. `https://twin-visit-logger.vercel.app` |
   | `ALLOWED_DOMAINS` | `equitytrack.org,twinhomebuyer.com` |
   | `APPS_SCRIPT_URL` | the /exec URL from step A |
   | `APPS_SCRIPT_TOKEN` | the same secret you set in `CFG.API_TOKEN` |
4. **Deploy.** After it builds, copy the production URL → set `NEXTAUTH_URL` to it and add its
   `/api/auth/callback/google` to the Google redirect URIs (step B4) → **Redeploy**.
5. Open the URL → sign in with a Twin Home Buyer / Equity Track Google account → dashboard loads live.

## Notes
- The token is only ever on the server (Vercel env + Apps Script). It is never sent to the browser.
- To change the UI later, edit `components/Dashboard.jsx` and push — Vercel auto-redeploys.
- Pilot scope unchanged: real records only, no automatic pricing/negotiation/gift, no seller contact.
- If the built-in `/exec` HTML page being reachable by URL is a concern, keep a separate
  domain-restricted deployment for the HTML and use an "Anyone" deployment only for the API.
