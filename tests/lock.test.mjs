/**
 * The REI lock, and the difference between a scheduled run and one somebody typed.
 *
 *   node tests/lock.test.mjs
 *
 * The lock is not a nicety. Two Chromium processes on one persistent profile corrupt it, and that is what
 * was silently logging this account out of REI — every lead failing with a login redirect, twice.
 *
 * A scheduled run that finds it busy should stand down: it fires again in twenty minutes and the next one
 * picks up whatever accumulated. A run somebody typed has no next one, and on the client's machine it lost
 * the race three times in a row. The documented workaround was to disable the scheduled tasks first, and
 * `schtasks /Change /DISABLE` answered "Access is denied" for one of them — so the advice did not work, and
 * left the other task switched off while it failed.
 *
 * Real files in a temp directory, because the whole point of this lock is filesystem exclusion.
 */
import { acquireLock, acquireLockWaiting } from '../twin-visit-logger-sandbox/src/utils/lock.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

/* lockPath resolves against the cwd, so the suite runs in its own directory and cleans up after itself. */
const cwd = process.cwd();
const tmp = path.join(cwd, 'build', 'lock-test');
await fs.rm(tmp, { recursive: true, force: true });
await fs.mkdir(tmp, { recursive: true });
process.chdir(tmp);

try {
  console.log('=== one holder at a time ===');
  const first = await acquireLock('t1');
  check('the first caller gets it', typeof first, 'function');
  check('a second caller is refused', await acquireLock('t1'), null);
  await first();
  check('...and can take it once the first releases', typeof await acquireLock('t1'), 'function');

  console.log('\n--- separate names do not block each other ---');
  /*
   * The REI scrape and the WhatsApp watcher ran on separate schedules against one lock file, so whichever
   * started second exited immediately and never did its work.
   */
  const a = await acquireLock('scrape');
  const b = await acquireLock('watch');
  check('two different locks are both granted', [typeof a, typeof b], ['function', 'function']);
  await a(); await b();

  console.log('\n=== waiting, for a run somebody typed ===');
  const held = await acquireLock('t2');
  let waited = 0;
  /* Released shortly after the wait starts, so the wait must actually succeed rather than time out. */
  setTimeout(() => { held(); }, 120);
  const got = await acquireLockWaiting('t2', { timeoutMs: 4000, pollMs: 50, onWait: () => { waited += 1; } });
  check('it waits, then gets the lock', typeof got, 'function');
  check('...and reported progress while waiting', waited > 0, true);
  await got();

  console.log('\n--- a free lock is taken immediately, with no waiting at all ---');
  let announced = 0;
  const straight = await acquireLockWaiting('t3', { timeoutMs: 4000, pollMs: 50, onWait: () => { announced += 1; } });
  check('no wait was needed', typeof straight, 'function');
  check('...so nothing was announced', announced, 0);
  await straight();

  console.log('\n--- it gives up rather than hanging for ever ---');
  /*
   * A run that died holding the lock must not wedge a command line indefinitely. Timing out returns null so
   * the caller can print how to inspect and clear the file.
   */
  const stuck = await acquireLock('t4');
  const startedAt = Date.now();
  const timedOut = await acquireLockWaiting('t4', { timeoutMs: 300, pollMs: 50 });
  check('a timeout returns null, not a lock', timedOut, null);
  check('...and it really waited before giving up', Date.now() - startedAt >= 250, true);
  await stuck();

  console.log('\n=== a stale lock is cleared automatically ===');
  /*
   * A crashed run leaves the file behind. Anything older than 30 minutes is treated as abandoned, or one
   * crash would stop every scheduled run until somebody deleted a file by hand.
   */
  const crashed = await acquireLock('t5');
  const lockFile = path.resolve('./data/t5.lock');
  check('the lock file exists where the code says', !!(await fs.stat(lockFile).catch(() => null)), true);
  const old = new Date(Date.now() - 31 * 60 * 1000);
  await fs.utimes(lockFile, old, old);
  const reclaimed = await acquireLock('t5');
  check('a 31-minute-old lock is reclaimed', typeof reclaimed, 'function');
  await reclaimed(); await crashed().catch(() => {});

  console.log('\n--- a fresh lock is NOT reclaimed ---');
  const fresh = await acquireLock('t6');
  const freshFile = path.resolve('./data/t6.lock');
  const recent = new Date(Date.now() - 60 * 1000);
  await fs.utimes(freshFile, recent, recent);
  check('a one-minute-old lock still holds', await acquireLock('t6'), null);
  await fresh();

  console.log('\n=== what the lock file records ===');
  /*
   * The pid and start time are what let somebody decide whether a lock is genuinely held, which the failure
   * message tells them to check.
   */
  const noted = await acquireLock('t7');
  const body = JSON.parse(await fs.readFile(path.resolve('./data/t7.lock'), 'utf8'));
  check('it records the pid', body.pid, process.pid);
  check('...and when it started', typeof body.startedAt, 'string');
  check('...as a real timestamp', Number.isNaN(new Date(body.startedAt).getTime()), false);
  await noted();
  check('releasing deletes the file', await fs.stat(path.resolve('./data/t7.lock')).catch(() => null), null);

  console.log('\n=== Ctrl+C releases the lock ===');
  /*
   * This cost the client twelve minutes of waiting for a run that was already dead.
   *
   * A killed process never runs its finally block, so the lock file survived, and removeStaleLock does not
   * touch it for thirty minutes — every command typed in that window queued behind a run that no longer
   * existed. I had told him to Ctrl+C a sweep three times that day, so it was not an edge case.
   */
  const SRC = await fs.readFile(path.join(cwd, 'twin-visit-logger-sandbox/src/utils/lock.mjs'), 'utf8');
  /*
   * Still true, but the lock no longer does it ITSELF — and that change is a bug fix, not a refactor.
   *
   * The handlers used to live here and end in `process.exit()`. The lock is taken BEFORE the REI browser
   * opens, so that handler was always first in line, and process.exit() ends the process on the spot: no
   * finally, no `await context.close()`. Chromium was killed rather than shut down, so it never flushed its
   * cookie database — and REI signed this machine out several times a day for a week because of it.
   *
   * The exit now happens in src/utils/shutdown.mjs, after the browser has closed. The signal handling and
   * the 130/143 codes are asserted there, along with the guard against this loop ever coming back;
   * tests/rei-session-survives-interrupt.test.mjs owns that. What this file still owns is the lock's own
   * half of the bargain: it registers a release that runs on both paths, and it releases LAST.
   */
  check('the release is registered with the shutdown coordinator',
    /onShutdown\(releaseSync, \{ order: 90, sync: true/.test(SRC), true);
  check('...sync, so a plain exit releases it too', /sync: true/.test(SRC), true);
  check('...unlinking synchronously, because the process is on its way out',
    /fsSync\.unlinkSync\(LOCK_PATH\)/.test(SRC), true);
  /*
   * Order 90 against the browser's 10. Release the lock first and the next scheduled run can open the same
   * REI profile while this Chromium is still writing to it — two browsers on one profile, which is the exact
   * failure the lock exists to prevent and which presents identically to the logout bug.
   */
  check('...and released LAST, after the browser has closed',
    Number((SRC.match(/order: (\d+), sync: true/) || [])[1]) > 10, true);
  /*
   * Against comment-STRIPPED source, because the comment above the fix says the words "process.exit()" and
   * this assertion matched them and failed. That is the sixth time in this project a check has passed or
   * failed on prose rather than code — including, twice, an assertion that something had been REMOVED
   * tripping on the comment explaining the removal. A negative assertion has to read the code only.
   */
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  /*
   * Scoped to acquireLock, because the shutdown coordinator now lives in this same file and its exit is
   * the CORRECT one — it runs after the browser has closed. It was moved in from src/utils/shutdown.mjs
   * after that new file took the client's automation down: every fix reaches their PC as a hand-copied
   * file, and the copy tool there had no entry for a file that had never existed, so browser.mjs arrived
   * importing a module that was not on disk.
   *
   * So the rule is not "this file never exits". It is "the lock path never exits" — acquireLock runs
   * before the browser is even open, and an exit there is what killed Chromium mid-write.
   */
  const ACQUIRE = CODE.slice(CODE.indexOf('export async function acquireLock('));
  check('...and it is a real slice, not an empty one', ACQUIRE.length > 800, true);
  check('acquireLock never calls process.exit itself', /process\.exit/.test(ACQUIRE), false);
  check('...and installs no signal handler of its own', /'SIGINT'/.test(ACQUIRE), false);
  check('the release-then-exit handler that cost the REI session is gone',
    /releaseSync\(\);\s*\n?\s*process\.exit\(/.test(CODE), false);
  /*
   * The guard that makes the cleanup safe rather than dangerous: without it, this process releases the lock,
   * another takes it, this one later exits — and deletes the OTHER run's lock file. Two browsers on one REI
   * profile is the exact failure the lock exists to prevent.
   */
  check('a released lock is never deleted twice',
    /const releaseSync = \(\) => \{\s*\n\s*if \(released\) return;/.test(SRC), true);
  /* Behaviourally: release, let somebody else take it, and the first holder's cleanup must not remove theirs. */
  const mine = await acquireLock('handoff');
  await mine();
  const theirs = await acquireLock('handoff');
  check('after a handoff the second holder still has its file',
    !!(await fs.stat(path.resolve('./data/handoff.lock')).catch(() => null)), true);
  await mine();                       // calling the first release again must be a no-op
  check('...even when the first release is called again',
    !!(await fs.stat(path.resolve('./data/handoff.lock')).catch(() => null)), true);
  await theirs();

  console.log('\n=== the callers use the right one ===');
  /*
   * The distinction only matters if the scripts honour it. A scheduled re-check must NOT wait — waiting would
   * pile up twenty-minute runs behind each other — and a --only re-check must.
   */
  const RECHECK = await fs.readFile(path.join(cwd, 'twin-visit-logger-sandbox/scripts/recheck-rei.mjs'), 'utf8');
  check('the re-check waits only when --only was passed',
    /const release = \(ONLY \|\| WAIT\)\s*\n?\s*\?\s*await acquireLockWaiting/.test(RECHECK), true);
  check('...and stands down otherwise', /:\s*await acquireLock\(\);/.test(RECHECK), true);
  const DOCTOR = await fs.readFile(path.join(cwd, 'twin-visit-logger-sandbox/scripts/pagedoctor.mjs'), 'utf8');
  check('the doctor always waits — it is only ever run by hand',
    /await acquireLockWaiting\('run'/.test(DOCTOR), true);
  /* Every REI entry point must take the lock at all. This is the check that catches a new one that forgot. */
  for (const file of ['scripts/recheck-rei.mjs', 'scripts/pagedoctor.mjs', 'scripts/rei-login.mjs', 'src/run-once.mjs']) {
    const src = await fs.readFile(path.join(cwd, 'twin-visit-logger-sandbox', file), 'utf8');
    check(`${file} takes the lock`, /acquireLock(Waiting)?\(/.test(src), true);
  }
} finally {
  process.chdir(cwd);
  await fs.rm(tmp, { recursive: true, force: true });
}

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
