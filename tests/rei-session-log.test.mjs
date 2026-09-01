/**
 * The REI session log — the thing that turns the daily logout into evidence.
 *
 *   node tests/rei-session-log.test.mjs
 *
 * REI signs the office PC out roughly daily. An evening went into it and produced no answer: a brand-new
 * browser profile lost the session as fast as the old one, and the client confirms the account is not
 * shared. The only hard clue was Chromium reporting it "didn't shut down correctly".
 *
 * At that point a fourth theory is worth nothing. What is worth something is recording the three facts
 * that separate the remaining possibilities — how many REI cookies the profile HAD when the browser
 * opened, whether the context CLOSED, and what REI then ANSWERED — because those point at opposite fixes:
 *
 *   opened with cookies, no CLOSE line     the browser is being killed; cookies never reach disk
 *   opened with none                       the session was lost before this run even started
 *   opened with cookies, REI says login    REI is ending the session at its end
 *
 * This is the same lesson as the WhatsApp doctor, which confidently reported "looks logged in" on a
 * logout page and sent somebody off to fix selectors. A diagnostic that reports the wrong state is worse
 * than none; one that reports nothing at all is what we had here.
 */
import fs from 'node:fs';
import path from 'node:path';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const LOG = read('twin-visit-logger-sandbox/src/rei/session-log.mjs');
const log = strip(LOG);
const BROWSER = strip(read('twin-visit-logger-sandbox/src/rei/browser.mjs'));

console.log('=== It records the three things that distinguish the causes ===');
check('cookie count at open', /OPEN\s+profile=/.test(LOG) && /reiCookies=/.test(LOG), true);
/*
 * It reports the NAMES rather than claiming which is the login. The first live run of the guessing
 * version announced `sessionCookies=1 [__stripe_sid]` — Stripe's analytics cookie, caught by the "sid" —
 * which would read as reassuring on exactly the line being examined after a logout.
 */
// Negative checked against the COMMENT-STRIPPED source: the comment above explains the old
// `sessionCookies=1 [__stripe_sid]` line, so testing the raw file would fail on the explanation of the
// very thing being asserted gone. Fourth time this project has been caught by a comment matching a test.
check('it names the cookies instead of guessing which is the login',
  /names: names\.slice\(0, 6\)/.test(log) && !/sessionCookies=/.test(log), true);
check('...and does not claim a session-cookie count', /const session = mine\.filter/.test(log), false);
check('whether the context closed', /CLOSE\s+context closed/.test(LOG), true);
check('what REI answered', /AUTH\s+REI accepted the session/.test(LOG) && /AUTH\s+REI showed a login page/.test(LOG), true);

console.log('\n=== A killed run is visible as such ===');
/*
 * The line that matters most. An OPEN with no CLOSE before it is a browser that was killed, and a killed
 * Chromium does not write its cookies to disk — which would explain every logout seen so far.
 */
check('the exit line says when the context never closed',
  /CONTEXT NEVER CLOSED/.test(LOG), true);
check('...and it is decided by a flag the close event sets',
  /closed = true;/.test(log) && /closed\s*\n?\s*\?/.test(log), true);
check('a termination signal is recorded too', /SIGNAL \$\{signal\} — the run was terminated from outside/.test(LOG), true);
// Synchronous on purpose: the process is on its way out and an await may never resolve.
check('the exit handler does not await', /process\.once\('exit', \(code\) => \{/.test(log), true);

console.log('\n=== It cannot break the run it is describing ===');
// A diagnostic that can fail a run is worse than no diagnostic.
check('every write is wrapped', /catch \{ \/\* a note about a run must never be able to fail it \*\/ \}/.test(LOG), true);
check('cookie reading cannot throw out', /catch \(error\) \{\s*\n\s*return \{ total: -1/.test(log), true);
check('the close listener is guarded for older Playwright', /try \{ context\.on\('close'/.test(log), true);

console.log('\n=== The file stays readable ===');
/*
 * Trimmed from the FRONT, so the newest entries survive. Trimming the other way would delete exactly the
 * run being investigated.
 */
check('it is capped', /MAX_BYTES/.test(log), true);
check('...and keeps the NEWEST entries', /\.slice\(-Math\.floor\(MAX_BYTES \/ 2\)\)/.test(log), true);
check('it is its own file, not the noisy main log', /logs\/rei-session\.log/.test(LOG), true);

console.log('\n=== It is actually wired into the browser ===');
check('every REI context records its open state',
  /await noteReiSessionOpen\(context, config\.reiUserDataDir\);/.test(BROWSER), true);
check('...before the context is handed to the caller',
  BROWSER.indexOf('noteReiSessionOpen') < BROWSER.indexOf('return context;'), true);
check('a login-page redirect is recorded before it throws',
  /noteReiAuthResult\(false, page\.url\(\)\);\s*\n\s*throw new ReiSessionExpiredError/.test(BROWSER), true);
check('a visible login form is recorded too',
  /noteReiAuthResult\(false, 'login form visible'\);/.test(BROWSER), true);
check('and a good session is recorded, so a working run is distinguishable from no run at all',
  /noteReiAuthResult\(true\);/.test(BROWSER), true);

console.log('\n=== A person can read it without a terminal ===');
const CMD = read('twin-visit-logger-sandbox/scripts/SessionLog.cmd');
check('there is a double-clickable reader', CMD.length > 0, true);
check('it explains what an OPEN with no CLOSE means', /the browser was killed/.test(CMD), true);
check('it explains reiCookies=0', /already signed out before/.test(CMD), true);
check('it explains cookies-present-but-rejected', /REI ended the session at its end/.test(CMD), true);
check('it says what an empty log means', /Nothing recorded yet/.test(CMD), true);
// Hyphen-free filename: this client's browser strips hyphens out of downloaded filenames.
check('the filename has no hyphen', /-/.test('SessionLog.cmd'), false);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
