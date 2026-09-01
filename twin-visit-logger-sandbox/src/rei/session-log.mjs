import fs from 'node:fs';
import path from 'node:path';

/**
 * A record of what happens to the REI browser session, so the logouts stop being a matter of theory.
 *
 * WHY. REI signs this machine out roughly daily, and a whole evening went into guessing at it. Two
 * explanations were tested and ruled out — a brand-new profile lost the session just as fast as the old
 * one, and the client confirms nobody else uses the account. Chromium reported "didn't shut down
 * correctly". A third theory would have been worth no more than the first two.
 *
 * So this writes down the three facts that would actually distinguish the remaining possibilities, once
 * per run, into a file a person can read:
 *
 *   OPEN    how many REI cookies the profile had when the browser opened, and whether any of them is the
 *           session cookie. "Opened with none" means the session was already gone before this run — the
 *           loss happened earlier. "Opened with some, and REI still showed a login page" means REI ended
 *           it server-side, which is a completely different problem.
 *   CLOSE   whether the context actually closed. A missing CLOSE line after an OPEN is a run that was
 *           killed, and a killed Chromium never writes its cookies to disk.
 *   EXIT    how the process ended, so a crash and a clean finish are distinguishable.
 *
 * Reading it is the point: an OPEN with cookies followed by no CLOSE, then the next OPEN with none, is
 * the browser being killed. OPENs that always have cookies while REI still redirects to the login page is
 * REI expiring the session itself. Those want opposite fixes, and until now there was nothing to tell
 * them apart.
 *
 * Deliberately its own small file rather than the main log: the main one is rotated, noisy and read by
 * nobody, and this needs to survive long enough to show a pattern across days.
 *
 * Never throws. A diagnostic that can fail the run it is describing is worse than no diagnostic.
 */
const LOG_PATH = path.resolve('./logs/rei-session.log');
const MAX_BYTES = 256 * 1024;   // small enough to open in Notepad, large enough for weeks of runs

function line(text) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    // Trimmed from the FRONT when it grows, so the newest entries — the ones being investigated — survive.
    try {
      if (fs.statSync(LOG_PATH).size > MAX_BYTES) {
        const kept = fs.readFileSync(LOG_PATH, 'utf8').slice(-Math.floor(MAX_BYTES / 2));
        fs.writeFileSync(LOG_PATH, kept.slice(kept.indexOf('\n') + 1));
      }
    } catch { /* no file yet */ }
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()}  pid ${process.pid}  ${text}\n`);
  } catch { /* a note about a run must never be able to fail it */ }
}

/**
 * What the profile holds for REI right now.
 *
 * Counts cookies on the REI domain and looks for a session-ish one by name. The name is not asserted
 * against a fixed list on purpose — REI can rename its cookie and the useful signal is "were there
 * credentials in the jar at all", which a count answers on its own.
 */
export async function describeReiCookies(context) {
  try {
    const all = await context.cookies();
    const mine = all.filter((c) => String(c.domain || '').includes('reiblackbook'));
    const session = mine.filter((c) => /sess|auth|token|login|sid/i.test(String(c.name || '')));
    const expiring = mine
      .filter((c) => typeof c.expires === 'number' && c.expires > 0)
      .sort((a, b) => a.expires - b.expires)[0];
    return {
      total: mine.length,
      session: session.length,
      names: session.map((c) => c.name).slice(0, 5),
      soonestExpiry: expiring ? new Date(expiring.expires * 1000).toISOString() : ''
    };
  } catch (error) {
    return { total: -1, session: -1, names: [], soonestExpiry: '', error: String(error.message || error) };
  }
}

/** Record the state the browser opened in, and arm the close/exit records. */
export async function noteReiSessionOpen(context, profileDir) {
  const c = await describeReiCookies(context);
  line(`OPEN   profile=${profileDir}  reiCookies=${c.total}  sessionCookies=${c.session}` +
    (c.names.length ? `  [${c.names.join(', ')}]` : '') +
    (c.soonestExpiry ? `  soonestExpiry=${c.soonestExpiry}` : '') +
    (c.error ? `  cookieReadError=${c.error}` : ''));

  let closed = false;
  try { context.on('close', () => { closed = true; line('CLOSE  context closed'); }); } catch { /* older API */ }

  /*
   * Synchronous, because the process is on its way out and an await here may never resolve. This is the
   * line that matters most: an OPEN with no CLOSE before it is a browser that was killed, and a killed
   * Chromium does not write its cookies to disk.
   */
  process.once('exit', (code) => {
    line(closed
      ? `EXIT   code=${code}  (context had closed cleanly)`
      : `EXIT   code=${code}  ** CONTEXT NEVER CLOSED — cookies were probably not saved **`);
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(signal, () => { line(`SIGNAL ${signal} — the run was terminated from outside`); });
  }
}

/** Record what REI answered, so a live cookie that still lands on a login page is visible as such. */
export function noteReiAuthResult(ok, detail = '') {
  line(ok ? 'AUTH   REI accepted the session' : `AUTH   REI showed a login page  ${detail}`.trim());
}
