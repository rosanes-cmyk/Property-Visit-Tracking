# Runbook: Deploy the Twin Visit Logger website to Vercel

**For:** Claude Cowork or a teammate. **Goal:** put the Next.js web app (in `web/`) online on Vercel,
signed in with Google (equitytrack.org only), reading/writing the DEV COPY sheet through the Apps
Script API. **Do not touch the original workbook.** Report the final URL + any errors.

Some steps need a Google Workspace **admin** (Google Cloud project / OAuth). If you hit a permission
wall, stop and report which step needs admin rights.

---

## Part A — Turn the Apps Script into an API (in the DEV COPY)
1. Open the DEV COPY sheet → **Extensions → Apps Script**.
2. In `Code.gs`, find `CFG` → set **`API_TOKEN`** to a long random string (e.g. 40+ chars).
   **Save.** Keep this token — it's needed again in Part C.
3. **Deploy → Manage deployments → ✏️ (edit the existing Web app)**:
   - **Who has access:** change to **Anyone**
   - **Version:** **New version** → **Deploy**
   *(Access must be "Anyone" so Vercel's server can call it; every API call still needs the token.)*
4. Copy the **Web app `/exec` URL**.
5. Sanity check (optional): open `<EXEC_URL>?api=data&token=<YOUR_TOKEN>` in the browser → should
   return JSON starting with `{"ok":true,"data":...`. Without the token it returns `unauthorized`.

## Part B — Google OAuth (sign-in)
1. https://console.cloud.google.com → create/select a project owned by the Workspace org.
2. **APIs & Services → OAuth consent screen** → User type **Internal** → app name
   "Twin Visit Logger", support email = an org address → Save.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
4. **Authorized redirect URIs** — add both:
   - `http://localhost:3000/api/auth/callback/google`
   - (add the real one after Part C step 4)
5. Copy the **Client ID** and **Client secret**.

## Part C — Vercel
1. https://vercel.com → sign in with GitHub → **Add New → Project → Import** the repo
   `rosanes-cmyk/property-visit-tracking` (branch `claude/twin-visit-logger-audit-klfeyo`).
2. **Root Directory → `web`** (click Edit, choose the `web` folder). Framework = Next.js (auto).
3. **Environment Variables** (add all, Production + Preview):
   | Name | Value |
   |---|---|
   | `GOOGLE_CLIENT_ID` | from Part B |
   | `GOOGLE_CLIENT_SECRET` | from Part B |
   | `NEXTAUTH_SECRET` | any long random string |
   | `NEXTAUTH_URL` | leave blank for now, or set after first deploy |
   | `ALLOWED_DOMAINS` | `equitytrack.org,twinhomebuyer.com` |
   | `APPS_SCRIPT_URL` | the `/exec` URL from Part A |
   | `APPS_SCRIPT_TOKEN` | the SAME token you set in `CFG.API_TOKEN` |
4. **Deploy.** When it finishes, copy the production URL (e.g. `https://xxxx.vercel.app`).
5. Set **`NEXTAUTH_URL`** = that URL (Vercel → Settings → Environment Variables) → **Redeploy**.
6. In Part B step 4, add `https://<that-url>/api/auth/callback/google` to the redirect URIs → Save.

## Verify
1. Open the Vercel URL → you should be sent to a Google sign-in.
2. Sign in with an **@equitytrack.org / @twinhomebuyer.com** account → the dashboard loads with the
   10 live records (no TEST rows).
3. Try **＋ Add property** with a test address → confirm a new row appears in the sheet's **Data**
   tab and in the dashboard. (Use an obviously-fake address you can delete, or a real one.)
4. Try a card action (e.g. **Log follow-up**) → confirm the sheet updates and a **Task Queue** row appears.

## Report back
- The Vercel URL.
- Confirmation sign-in is restricted (a non-org Google account is rejected).
- Confirmation add + one action wrote to the sheet.
- The Vercel **build log** if the build fails (so the code can be fixed).

## Guardrails
- DEV COPY only; original *Property Visit Tracking* untouched.
- Don't commit secrets to Git — they live only in Vercel env vars + Apps Script `CFG.API_TOKEN`.
- No seller contact; pilot scope (real records only) unchanged.
