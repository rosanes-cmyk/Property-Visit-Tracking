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
 *   OPEN    how many REI cookies the profile had when the browser opened, and what the first few are
 *           called. "Opened with none" means the session was already gone before this run — the loss
 *           happened earlier. "Opened with some, and REI still showed a login page" means REI ended it
 *           server-side, which is a completely different problem. It does NOT try to say which cookie is
 *           the login: guessing that produced `sessionCookies=1 [__stripe_sid]` on the first live run.
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
 * Reports the COUNT of cookies on the REI domain and NAMES the first few, rather than claiming to know
 * which one is the login.
 *
 * It used to guess, matching names against /sess|auth|token|login|sid/ — and on the first real run it
 * proudly reported `sessionCookies=1 [__stripe_sid]`, which is Stripe's analytics cookie caught by the
 * "sid". A number that says "1 session cookie" when there is none would read as reassuring on exactly the
 * log line being examined after a logout. That is the WhatsApp doctor failure again: a diagnostic
 * reporting the wrong state is worse than one reporting nothing.
 *
 * So it does not guess. The count answers the question that matters — were there credentials in the jar
 * at all — and the names let a person see what is actually there without the tool pretending to know
 * which of them REI cares about.
 *
 * Third-party names are listed last, so the REI-looking ones are the ones that fit in the line.
 */
export async function describeReiCookies(context) {
  try {
    const all = await context.cookies();
    const mine = all.filter((c) => String(c.domain || '').includes('reiblackbook'));
    const thirdParty = (n) => /^_|^__/.test(String(n || ''));
    const names = mine
      .map((c) => String(c.name || ''))
      .sort((a, b) => (thirdParty(a) ? 1 : 0) - (thirdParty(b) ? 1 : 0));
    const expiring = mine
      .filter((c) => typeof c.expires === 'number' && c.expires > 0)
      .sort((a, b) => a.expires - b.expires)[0];
    return {
      total: mine.length,
      names: names.slice(0, 6),
      soonestExpiry: expiring ? new Date(expiring.expires * 1000).toISOString() : ''
    };
  } catch (error) {
    return { total: -1, names: [], soonestExpiry: '', error: String(error.message || error) };
  }
}

/**
 * How the PREVIOUS run's Chromium ended, according to Chromium itself.
 *
 * This is the fact the whole logout hunt needed and nobody had. Chromium writes `profile.exit_type` into
 * the profile's own Preferences file: it sets it to "Crashed" while running and back to "Normal" on a
 * graceful shutdown. So anything other than "Normal" means the last run was KILLED — and a killed Chromium
 * never flushes its cookie database, which is what was costing the REI session.
 *
 * It is also the source of the "Restore pages? Chromium didn't shut down correctly" bubble the client
 * screenshotted. That was Chromium reporting this exact field, and it was the one hard clue in the whole
 * investigation.
 *
 * MUST BE READ BEFORE THE BROWSER LAUNCHES. Chromium stamps "Crashed" as it starts up, so once the context
 * is open the file describes THIS run, not the last one, and would report a crash on every single launch.
 * That is a diagnostic that always says yes, which is the same as one that says nothing.
 *
 * Never throws, and a missing file is not a problem — it means a fresh profile.
 */
export function readLastChromiumExit(profileDir) {
  for (const rel of ['Default/Preferences', 'Preferences']) {
    try {
      const raw = fs.readFileSync(path.join(profileDir, rel), 'utf8');
      const prefs = JSON.parse(raw);
      const p = prefs.profile || {};
      if (p.exit_type == null && p.exited_cleanly == null) continue;
      return {
        found: true,
        exitType: String(p.exit_type == null ? '' : p.exit_type),
        exitedCleanly: p.exited_cleanly !== false,
        clean: p.exit_type == null ? p.exited_cleanly !== false : String(p.exit_type) === 'Normal'
      };
    } catch { /* try the next location */ }
  }
  return { found: false, exitType: '', exitedCleanly: true, clean: true };
}

/** Record the state the browser opened in, and arm the close/exit records. */
export async function noteReiSessionOpen(context, profileDir, lastExit) {
  const c = await describeReiCookies(context);
  line(`OPEN   profile=${profileDir}  reiCookies=${c.total}` +
    (c.names.length ? `  [${c.names.join(', ')}]` : '') +
    (c.soonestExpiry ? `  soonestExpiry=${c.soonestExpiry}` : '') +
    (c.error ? `  cookieReadError=${c.error}` : ''));

  /*
   * Written on its own line, and on screen too when it is bad. A line in a log nobody opens is how this
   * took a week: the client was told to check the PC three times while Chromium had already recorded the
   * answer in its own profile.
   */
  if (lastExit && lastExit.found) {
    line(lastExit.clean
      ? 'PREV   the previous run closed Chromium cleanly (exit_type=Normal)'
      : `PREV   ** the previous run did NOT close Chromium cleanly (exit_type=${lastExit.exitType || 'not Normal'}) ` +
        '— cookies from that run were probably lost, which signs REI out **');
    if (!lastExit.clean) {
      console.warn('  NOTE: the previous REI run did not shut the browser down cleanly, so its cookies were');
      console.warn('  probably never written to disk. That is what signs REI out. If this repeats, something');
      console.warn('  is killing the run — Ctrl+C, the console window being closed, or Task Scheduler.');
    }
  }

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
