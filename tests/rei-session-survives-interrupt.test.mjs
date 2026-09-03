/**
 * An interrupted run closes Chromium instead of being killed with it — which is why REI kept signing out.
 *
 *   node tests/rei-session-survives-interrupt.test.mjs
 *
 * THE BUG, and it was mine. src/utils/lock.mjs installed its own signal handlers:
 *
 *     for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
 *       process.once(signal, () => { releaseSync(); process.exit(signal === 'SIGINT' ? 130 : 143); });
 *     }
 *
 * The lock is taken BEFORE the browser opens, so that handler was always first in line, and process.exit()
 * ends the process on the spot: no `finally`, no `await context.close()`, no Playwright cleanup. Chromium was
 * killed rather than shut down.
 *
 * Chromium keeps cookies in memory and writes them to the profile's `Cookies` database on a lazy timer and,
 * in full, on a GRACEFUL shutdown. Kill it and whatever the session cookie had become since the last commit
 * is gone — so the profile on disk reverts to a value REI has already rotated past, and the next run is
 * redirected to the login page. Nothing errors. The sweep just reads 0 of 20 leads with 20 login redirects.
 *
 * Every observation fits, where the earlier theories fit none of them:
 *
 *   - Chromium itself said "Restore pages? Chromium didn't shut down correctly" — that message IS the
 *     non-graceful-exit marker, and it was the only hard clue in the whole hunt.
 *   - Not a shared account. The client checked: "no one using it."
 *   - A brand-new profile lost it just as fast, because the next interrupt loses it again.
 *   - "i laready log in earlier why i kept logging in" — a good login, destroyed by the next interrupt.
 *   - It got worse on the day I had them Ctrl+C sweeps repeatedly. lock.mjs's own comment says so.
 *
 * Pinned here: that nothing exits before the browser is closed, that the order puts the browser ahead of the
 * lock, that the budget cannot make Ctrl+C hang, and that the diagnostic reads Chromium's own verdict from
 * BEFORE the launch rather than after — where it would report a crash every single time.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SANDBOX = path.resolve('twin-visit-logger-sandbox');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

/*
 * The coordinator and the lock are ONE FILE now, and that was forced by delivery rather than taste.
 *
 * It was src/utils/shutdown.mjs, and shipping it took the client's automation down: every fix reaches that
 * PC as a hand-copied file, the copy tool there had no entry for a file that never existed before, and
 * browser.mjs arrived importing a module that was not on disk —
 *
 *     Cannot find module '...\\src\\utils\\shutdown.mjs' imported from '...\\src\\rei\\browser.mjs'
 *
 * — so nothing REI-related could start at all. A NEW file is the one change delivery cannot absorb here.
 * Both names still point at lock.mjs so the assertions below read as what they check.
 */
const LOCK = read('twin-visit-logger-sandbox/src/utils/lock.mjs');
const SHUT = LOCK;
const BROWSER = read('twin-visit-logger-sandbox/src/rei/browser.mjs');
const SESSLOG = read('twin-visit-logger-sandbox/src/rei/session-log.mjs');
const RECHECK = read('twin-visit-logger-sandbox/scripts/recheck-rei.mjs');
const CHAT = read('apps-script/ChatNotify.gs');
const COMBINED = read('apps-script/Code.combined.gs');

console.log('=== The lock no longer kills the process out from under the browser ===');
/*
 * THE REGRESSION GUARD. This exact loop is what cost the REI session. If it ever comes back, the logouts
 * come back with it, and they present as "REI signs us out daily" rather than as anything to do with Ctrl+C
 * — which is why it went undiagnosed for a week.
 */
/*
 * Stated as "the LOCK PATH does not exit", not "this file does not exit", because the coordinator now
 * lives in this same file and its exit is the correct one — after the closers have run. The first version
 * of these two assertions predated the merge and failed on correct code once the files came together.
 *
 * What must never come back is a handler that releases the lock and exits in the same breath, and any exit
 * at all inside acquireLock, which is the function that runs before the browser is even open.
 */
check('the release-then-exit handler is gone',
  /releaseSync\(\);\s*\n?\s*process\.exit\(/.test(strip(LOCK)), false);
const acquire = strip(LOCK).slice(strip(LOCK).indexOf('export async function acquireLock('));
check('...and it is a real slice, not an empty one', acquire.length > 800, true);
check('acquireLock itself never exits the process', /process\.exit/.test(acquire), false);
check('the signal handlers hand off to the coordinator instead',
  /process\.on\(signal, \(\) => \{ runShutdown\(signal\); \}\);/.test(LOCK), true);
check('it registers its release with the shutdown coordinator',
  /onShutdown\(releaseSync, \{ order: 90, sync: true/.test(LOCK), true);
check('...defined in the same file, so there is nothing extra to import',
  /function runShutdown\(signal\)/.test(LOCK), true);
// The lock still has to be released on a plain exit — that part was never wrong.
check('the release still runs on a plain process exit (sync: true)', /sync: true/.test(LOCK), true);
check('...and is still guarded so it cannot delete another run\'s lock',
  /if \(released\) return;/.test(strip(LOCK)), true);

console.log('\n=== The browser is closed on the way out ===');
check('launchReiContext registers a closer',
  /onShutdown\(\(\) => context\.close\(\)\.catch\(\(\) => \{\}\),/.test(BROWSER), true);
check('...at order 10, ahead of the lock\'s 90', /\{ order: 10, label: 'close the REI browser' \}/.test(BROWSER), true);
/*
 * Order is the whole point, not decoration: release the lock first and the next scheduled run can open the
 * same profile while this Chromium is still writing its cookie database to it. Two browsers on one profile
 * is the failure the lock exists to prevent, and it would present identically to this bug.
 */
const browserOrder = Number((BROWSER.match(/\{ order: (\d+), label: 'close the REI browser' \}/) || [])[1]);
const lockOrder = Number((LOCK.match(/order: (\d+), sync: true/) || [])[1]);
check('the browser really is ordered before the lock', browserOrder < lockOrder, true);
check('a closed context deregisters itself, so a clean run leaves no stale closer',
  /context\.on\('close', drop\)/.test(BROWSER), true);

console.log('\n=== The coordinator exits only after the closers have run ===');
check('onShutdown is exported', /export function onShutdown\(/.test(SHUT), true);
// The file it used to live in must STAY gone, or the copy tool's list drifts from the imports again.
check('there is no separate shutdown.mjs to forget to copy',
  fs.existsSync(path.resolve('twin-visit-logger-sandbox/src/utils/shutdown.mjs')), false);
check('the browser imports it from lock.mjs',
  /import \{ onShutdown \} from '\.\.\/utils\/lock\.mjs';/.test(BROWSER), true);
// Awaited in a loop, so an async close (the browser) genuinely completes before the exit below it.
check('each closer is awaited', /await h\.fn\(\);/.test(SHUT), true);
check('the exit happens after the wait, not before',
  SHUT.indexOf('await Promise.race([') < SHUT.lastIndexOf('process.exit('), true);
check('handlers run in order', /\.sort\(\(a, b\) => a\.order - b\.order\)/.test(SHUT), true);
check('a closer that throws does not stop the others', /try \{ await h\.fn\(\); \} catch/.test(SHUT), true);

console.log('\n=== ...and Ctrl+C can never feel broken ===');
/*
 * Both of these matter more than they look. A shutdown that hangs is one people learn to kill from Task
 * Manager, and a Task Manager kill skips all of this — so a "safer" shutdown with no escape hatch would
 * quietly reintroduce the very bug it was written to fix.
 */
check('there is a hard budget', /const SHUTDOWN_BUDGET_MS = /.test(SHUT), true);
/*
 * ...and it fits inside Windows' own deadline. Closing a console window with the X sends CTRL_CLOSE_EVENT,
 * which Node surfaces as SIGHUP, and Windows kills the process about ten seconds later whatever it is
 * doing. A budget at or above that is no budget at all on the very path this matters most for — closing
 * the window is what people actually do — because the OS would kill Chromium mid-flush regardless.
 */
check('...comfortably inside the ~10s Windows allows after a console close',
  Number((SHUT.match(/const SHUTDOWN_BUDGET_MS = ([\d_]+);/) || [])[1].replace(/_/g, '')) <= 8000, true);
check('SIGHUP is handled, which is what a closed console window sends',
  /\['SIGINT', 'SIGTERM', 'SIGHUP'\]/.test(SHUT), true);
check('...and it exits anyway when the budget runs out',
  /if \(timedOut\) \{[\s\S]{0,400}?process\.exit\(/.test(SHUT), true);
check('a second signal exits immediately',
  /if \(shuttingDown\) process\.exit\(/.test(SHUT), true);
check('the conventional 130 / 143 codes are kept, so a wrapper can still tell it was interrupted',
  (SHUT.match(/signal === 'SIGINT' \? 130 : 143/g) || []).length >= 2, true);
check('a plain exit runs only the sync closers — a browser cannot be closed from there',
  /if \(!h\.sync\) continue;/.test(SHUT), true);

console.log('\n=== Chromium\'s own verdict on the last run is read, and read at the right moment ===');
check('readLastChromiumExit is defined', /export function readLastChromiumExit\(profileDir\) \{/.test(SESSLOG), true);
check('it reads Chromium\'s exit_type', /p\.exit_type/.test(SESSLOG), true);
check('...treating only "Normal" as clean', /String\(p\.exit_type\) === 'Normal'/.test(SESSLOG), true);
check('both profile layouts are tried', /\['Default\/Preferences', 'Preferences'\]/.test(SESSLOG), true);
/*
 * BEFORE THE LAUNCH, and this is the whole correctness of the diagnostic. Chromium stamps
 * exit_type="Crashed" as it starts up and only rewrites it to "Normal" on a clean shutdown — so read after
 * launchPersistentContext and it describes THIS run, reporting a crash every single time. A diagnostic that
 * always says yes is the same as one that says nothing, which is the mistake whatsapp-doctor made.
 */
const b = strip(BROWSER);
check('it is read BEFORE launchPersistentContext',
  b.indexOf('readLastChromiumExit(config.reiUserDataDir)') < b.indexOf('chromium.launchPersistentContext'), true);
check('...and passed to the session log', /noteReiSessionOpen\(context, config\.reiUserDataDir, lastExit\)/.test(BROWSER), true);
check('an unclean previous exit is said on SCREEN, not only in the log file',
  /console\.warn\('  NOTE: the previous REI run did not shut the browser down cleanly/.test(SESSLOG), true);
check('a fresh profile with no Preferences file is not reported as a crash',
  /return \{ found: false, exitType: '', exitedCleanly: true, clean: true \};/.test(SESSLOG), true);

console.log('\n=== It is RUN, not just read: a real signal, a real ordered cleanup ===');
/*
 * Source matching cannot prove the thing that matters here, which is that an ASYNC closer genuinely
 * completes before the process exits. So this spawns a process, registers a slow closer and a fast one,
 * sends it a real SIGINT and a real SIGTERM, and reads back what actually happened.
 *
 * It caught a defect the source check could not: both closers ran, in the right order — and the sync one
 * ran TWICE, once from the signal path and once from the 'exit' handler that follows it. Harmless for the
 * lock, which is idempotent; not harmless for a closer that is not, and invisible either way.
 */
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shutdown-'));
  const probe = path.join(SANDBOX, 'shutdown-probe.mjs');
  const out = path.join(dir, 'order.txt');
  fs.writeFileSync(probe, `
import { onShutdown } from './src/utils/lock.mjs';
import fs from 'node:fs';
const OUT = process.argv[2];
onShutdown(async () => {
  await new Promise((r) => setTimeout(r, 250));      // stands in for Chromium taking a moment to close
  fs.appendFileSync(OUT, 'browser\\n');
}, { order: 10, label: 'close the browser' });
onShutdown(() => { fs.appendFileSync(OUT, 'lock\\n'); }, { order: 90, sync: true, label: 'lock' });
console.log('ready');
setInterval(() => {}, 1000);
`);
  try {
    for (const [signal, wantCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
      fs.rmSync(out, { force: true });
      const child = spawn(process.execPath, [probe, out], { cwd: SANDBOX, stdio: 'ignore' });
      await new Promise((r) => setTimeout(r, 700));    // let it register and reach the interval
      child.kill(signal);
      const code = await new Promise((r) => child.on('exit', (c) => r(c)));
      const order = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trim().split('\n') : [];
      check(`${signal}: the slow (browser) closer finished before the exit`, order.includes('browser'), true);
      check(`${signal}: ...and the lock was released`, order.includes('lock'), true);
      check(`${signal}: ...in that order — browser, then lock`, order, ['browser', 'lock']);
      check(`${signal}: ...each exactly once`, order.length, 2);
      check(`${signal}: ...and it exited ${wantCode}`, code, wantCode);
    }
  } finally {
    fs.rmSync(probe, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\n=== The two cards now agree about why the queue is held ===');
/*
 * The client's complaint, and it was fair. The held-queue card said "is it switched on and logged in to
 * Windows?" while the PC's own card, minutes earlier in the same Space, said the sweep had run and been
 * bounced to the login page twenty times. A sweep that RUNS is proof the machine is on. "this is shot ypu
 * know th pc is on."
 */
check('the PC writes a LOGOUT row into the Automation Log',
  /auditRows\.push\(\{ level: 'LOGOUT', id: '',/.test(RECHECK), true);
check('...saying the sweep RAN and was redirected, not that nothing happened',
  /the sweep ran and was redirected to the login page/.test(RECHECK), true);
// Not rate-limited like the Chat alert: the row is the card's view of the CURRENT state.
check('the row is written outside the 2-hour Chat throttle',
  RECHECK.indexOf("level: 'LOGOUT'") > RECHECK.indexOf('await alertLoggedOut(loggedOut, candidates.length);'), true);

for (const [label, raw] of [['ChatNotify.gs', CHAT], ['Code.combined.gs', COMBINED]]) {
  const src = strip(raw);
  check(`${label}: reiLoggedOutAt_ is defined`, /function reiLoggedOutAt_\(\) \{/.test(src), true);
  // A sweep NEWER than a logout means somebody signed in and it is working again.
  check(`${label}: a later sweep cancels the logout`,
    /if \(lvl === 'SWEEP'\) return null;/.test(src), true);
  check(`${label}: the held card asks it`, /loggedOutAt = reiLoggedOutAt_\(\);/.test(src), true);
  check(`${label}: ...and says REI is signed out in the title`,
    /Work queue held — REI is signed out/.test(src), true);
  check(`${label}: ...and says the PC is fine`, /is running fine: it opened REI at /.test(src), true);
  check(`${label}: ...and gives one fix, not a checklist`,
    /<b>The fix, on that PC:<\/b> double-click <b>scripts\\\\login-rei\.cmd<\/b>/.test(src), true);
  /*
   * The checklist is KEPT for the case it was written for — no sweep and no logout report either, which
   * really can mean the machine is off. Deleting it would trade one wrong card for another.
   */
  check(`${label}: the old checklist survives for a genuinely silent PC`,
    /is it switched on and logged in to Windows\?/.test(src), true);
  check(`${label}: the reassurance is on both branches`,
    (src.match(/No lead has been left out/g) || []).length, 2);
}

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
