# Runbook: Deploy the Twin Visit Logger website to Netlify (free)

**For:** Claude Cowork or a teammate. **Goal:** put the Next.js app (`web/`) online on Netlify's free
tier, with Google sign-in (equitytrack.org only), reading/writing the DEV COPY sheet via the Apps
Script API. **Do not touch the original workbook.** Report the final URL + any build errors.

Netlify's free "Starter" tier allows small commercial use, so this stays $0 for the pilot.
Some steps in Part B may need a Google Workspace **admin**; if you hit a permission wall, stop and
say which step needs admin rights.

---

## Part A — Turn the Apps Script into an API (in the DEV COPY)
1. DEV COPY sheet → **Extensions → Apps Script**.
2. In `Code.gs` → `CFG` → set **`API_TOKEN`** to a long random string (40+ chars). **Save.** Keep it.
3. **Deploy → Manage deployments → ✏️ edit → Who has access: Anyone → Version: New version → Deploy.**
   *(Anyone is required so Netlify's server can call it; every call still needs the token.)*
4. Copy the **/exec URL**.
5. Optional check: open `<EXEC_URL>?api=data&token=<TOKEN>` → returns JSON `{"ok":true,...}`.

## Part B — Google OAuth (sign-in)
1. https://console.cloud.google.com → project owned by the Workspace org.
2. **OAuth consent screen → Internal** → app name "Twin Visit Logger", support email.
3. **Credentials → Create credentials → OAuth client ID → Web application.**
4. **Authorized redirect URIs** — add:
   - `http://localhost:3000/api/auth/callback/google`
   - (add the Netlify one after Part C step 5)
5. Copy **Client ID** + **Client secret**.

## Part C — Netlify
1. https://app.netlify.com → **Add new site → Import an existing project → GitHub** →
   pick repo `rosanes-cmyk/property-visit-tracking`, branch `claude/twin-visit-logger-audit-klfeyo`.
2. Build settings are read from `netlify.toml` (base = `web`, command = `npm run build`, Next.js
   runtime plugin). Leave them as detected.
3. **Environment variables** (Site settings → Environment variables) — add all:
   | Name | Value |
   |---|---|
   | `GOOGLE_CLIENT_ID` | from Part B |
   | `GOOGLE_CLIENT_SECRET` | from Part B |
   | `NEXTAUTH_SECRET` | any long random string |
   | `NEXTAUTH_URL` | your Netlify URL (set after first deploy) |
   | `ALLOWED_DOMAINS` | `equitytrack.org,twinhomebuyer.com` |
   | `APPS_SCRIPT_URL` | the `/exec` URL from Part A |
   | `APPS_SCRIPT_TOKEN` | SAME token as `CFG.API_TOKEN` |
4. **Deploy site.** When it builds, copy the site URL (e.g. `https://twin-visit-logger.netlify.app`).
   *(Optional: Site configuration → Change site name for a nicer subdomain.)*
5. Set **`NEXTAUTH_URL`** = that URL → **Trigger redeploy**. Then in Part B step 4 add
   `https://<that-url>/api/auth/callback/google` to the Google redirect URIs → Save.

## Verify
1. Open the Netlify URL → Google sign-in.
2. Sign in with an **@equitytrack.org / @twinhomebuyer.com** account → dashboard loads with the 10
   live records, no TEST rows. (A non-org Google account should be rejected.)
3. **＋ Add property** with a test address → confirm a new row appears in the sheet's **Data** tab.
4. A card action (e.g. **Log follow-up**) → confirm the sheet updates + a **Task Queue** row appears.

## Report back
- Netlify site URL.
- Confirmation non-org accounts are rejected.
- Confirmation add + one action wrote to the sheet.
- If the build fails: the **Netlify deploy/build log** (so the code can be fixed).

## Guardrails
- DEV COPY only; original workbook untouched.
- Secrets live only in Netlify env vars + Apps Script `CFG.API_TOKEN` — never commit them to Git.
- No seller contact; pilot scope (real records only) unchanged.
