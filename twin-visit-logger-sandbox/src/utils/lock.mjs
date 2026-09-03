import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

/*
 * ======================================================================================================
 *  THE SHUTDOWN COORDINATOR LIVES HERE, IN THE LOCK, AND IT IS WHY REI KEPT SIGNING ITSELF OUT.
 * ======================================================================================================
 *
 * What stood below was the lock's own signal handling, ending in process.exit():
 *
 *     for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
 *       process.once(signal, () => { releaseSync(); process.exit(signal === 'SIGINT' ? 130 : 143); });
 *     }
 *
 * The lock is acquired BEFORE the browser opens, so that handler was always first in line, and
 * process.exit() ends the process on the spot: no `finally`, no `await context.close()`, no Playwright
 * cleanup. Chromium was killed rather than shut down.
 *
 * Chromium keeps cookies in memory and writes them to the profile's `Cookies` database on a lazy timer
 * and, in full, on a GRACEFUL shutdown. Kill it and whatever the REI session cookie had become since the
 * last commit is gone — the profile reverts to a value REI has already rotated past, and the next run is
 * redirected to the login page. Nothing errors; the sweep just reads 0 of 20 leads with 20 login
 * redirects. Every Ctrl+C, every Task Scheduler stop, every closed console window cost the REI login.
 *
 * The fix is that the exit now happens only after registered closers have run, in order:
 *
 *     order 10   the browser   `await context.close()`, which flushes the cookie database
 *     order 90   the lock      released last, so nothing can open the profile while Chromium is closing
 *
 * WHY IT IS IN THIS FILE RATHER THAN ITS OWN.
 *
 * It WAS its own file, src/utils/shutdown.mjs, and that shipped a broken app to the client's PC. Every fix
 * in this project reaches that machine as a hand-copied file, and the copy tool there did not know about a
 * file that had never existed before — so browser.mjs arrived importing a module that was not there:
 *
 *     Cannot find module '...\src\utils\shutdown.mjs' imported from '...\src\rei\browser.mjs'
 *
 * and nothing REI-related could start at all. A NEW file is the one kind of change that delivery cannot
 * absorb, and this is not a hypothetical: it happened, and it took the whole automation down.
 *
 * So it sits in the module that already owned the signal handling, is already imported by every script,
 * and is already in the copy tool's list. That is a delivery constraint driving a design decision, which
 * is worth being honest about — and on the merits it is no worse: the lock and the browser close are two
 * halves of one ordered shutdown, and they are now described in one place.
 */

const handlers = new Set();
let installed = false;
let shuttingDown = false;

/*
 * Long enough for Chromium to close (it takes a second or two, more with several tabs open), short enough
 * that Ctrl+C never feels ignored. Past this we exit anyway — losing the cookie flush is bad, but leaving
 * somebody unable to stop a run is worse, and they will reach for Task Manager and lose it regardless.
 *
 * EIGHT SECONDS, NOT TEN, AND THE DIFFERENCE IS WINDOWS. Closing a console window with the X sends
 * CTRL_CLOSE_EVENT, which Node surfaces as SIGHUP — and Windows then kills the process after about ten
 * seconds whatever it is doing. A ten-second budget sits exactly on that deadline, so a Chromium that took
 * its time would be killed mid-flush by the OS and cost the REI session anyway, on the one path this is
 * most needed for: closing the window is what people actually do.
 */
const SHUTDOWN_BUDGET_MS = 8_000;

/**
 * Register something to run before the process exits on a signal.
 *
 * Returns a deregister function — call it on the normal path, so a context that has already been closed by
 * its own `finally` is not closed a second time.
 *
 * `sync` marks a handler that can also run on plain process exit, where nothing can be awaited. The lock
 * release is one; closing a browser is not, which is the whole reason this file exists.
 */
export function onShutdown(fn, { order = 50, sync = false, label = '' } = {}) {
  const entry = { fn, order, sync, label };
  handlers.add(entry);
  install();
  return () => handlers.delete(entry);
}

function ordered() {
  return [...handlers].sort((a, b) => a.order - b.order);
}

async function runShutdown(signal) {
  /*
   * A second signal exits immediately. Somebody pressing Ctrl+C twice is telling us to stop asking, and
   * honouring that is what keeps them from killing the process a way that skips this entirely.
   */
  if (shuttingDown) process.exit(signal === 'SIGINT' ? 130 : 143);
  shuttingDown = true;

  const label = signal === 'SIGINT' ? 'Ctrl+C' : signal;
  console.log(`\n${label} — closing the browser properly before exiting. This matters: killing Chromium`);
  console.log('loses the REI login, which is what kept signing this machine out. One moment...');

  const work = (async () => {
    for (const h of ordered()) {
      /*
       * Removed BEFORE it runs, not after, and each handler runs at most once across both paths.
       *
       * A signal handler is followed by the 'exit' handler below, so a closer registered as `sync` was
       * called twice — the lock release was, in a live check. It is idempotent so nothing broke, but a
       * closer that is not would have run twice with no sign of it, and "cleanup ran twice" is a nasty
       * class of bug to go looking for later. Removing it first also means a closer that hangs until the
       * budget expires is not then re-run on the way out.
       */
      handlers.delete(h);
      try { await h.fn(); } catch (error) {
        console.warn(`  could not ${h.label || 'clean up'}: ${error.message}`);
      }
    }
  })();

  let timedOut = false;
  await Promise.race([
    work,
    new Promise((resolve) => { setTimeout(() => { timedOut = true; resolve(); }, SHUTDOWN_BUDGET_MS); })
  ]);
  if (timedOut) {
    console.warn(`  Chromium did not close within ${SHUTDOWN_BUDGET_MS / 1000}s — exiting anyway.`);
    console.warn('  If REI asks you to sign in on the next run, that is why.');
  } else {
    console.log('  Closed cleanly. The REI session is saved.');
  }
  process.exit(signal === 'SIGINT' ? 130 : 143);
}

function install() {
  if (installed) return;
  installed = true;
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => { runShutdown(signal); });
  }
  /*
   * Plain exit — an uncaught throw, or a process.exit() somewhere. Nothing can be awaited here, so only the
   * sync handlers run. The browser CANNOT be closed from here, which is precisely why the signal path above
   * must not be short-circuited by an exit() call of its own.
   */
  process.on('exit', () => {
    for (const h of ordered()) {
      if (!h.sync) continue;
      handlers.delete(h);                 // at most once across both paths — see runShutdown
      try { h.fn(); } catch { /* on the way out; nothing useful left to do */ }
    }
  });
}

/** True once a shutdown has begun, so a long loop can stop starting new work. */
export function isShuttingDown() { return shuttingDown; }

const STALE_AFTER_MS = 30 * 60 * 1000;

/**
 * Named locks. The REI scrape and the WhatsApp watcher run on separate schedules and must not share
 * one lock file, or whichever starts second exits immediately and never does its work.
 */
function lockPath(name) {
  return path.resolve(`./data/${name}.lock`);
}

async function removeStaleLock(LOCK_PATH) {
  try {
    const stat = await fs.stat(LOCK_PATH);
    if (Date.now() - stat.mtimeMs > STALE_AFTER_MS) {
      await fs.unlink(LOCK_PATH);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

/**
 * Wait for the lock instead of walking away from it. Returns a release function, or null on timeout.
 *
 * The scheduled runs hold this lock for a minute or two at a time, so a command typed by hand loses the race
 * more often than it wins — three attempts in a row were turned away. The documented way round it was to
 * disable the scheduled tasks first, and on the client's machine `schtasks /Change /DISABLE` answered "Access
 * is denied" for one of them, so the advice did not even work. Waiting a couple of minutes needs no
 * privileges and cannot leave the automation switched off by accident, which disabling a task can.
 *
 * `onWait` is called before each sleep so the caller can show progress: a silent five-minute pause is
 * indistinguishable from a hang.
 */
export async function acquireLockWaiting(name = 'run', { timeoutMs = 12 * 60 * 1000, pollMs = 5000, onWait } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const release = await acquireLock(name);
    if (release) return release;
    const left = deadline - Date.now();
    if (left <= 0) return null;
    if (onWait) onWait(Math.ceil(left / 1000));
    await new Promise((resolve) => { setTimeout(resolve, Math.min(pollMs, left)); });
  }
}

export async function acquireLock(name = 'run') {
  const LOCK_PATH = lockPath(name);
  await fs.mkdir(path.dirname(LOCK_PATH), { recursive: true });
  await removeStaleLock(LOCK_PATH);
  try {
    const handle = await fs.open(LOCK_PATH, 'wx');
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      await handle.close().catch(() => {});
      await fs.unlink(LOCK_PATH).catch(() => {});
    };

    /*
     * Ctrl+C must release the lock. This cost the client twelve minutes of waiting for a run that was
     * already dead.
     *
     * A killed process never runs its finally block, so the lock file survives, and removeStaleLock does not
     * touch it for thirty minutes. Every command typed in that window queues behind a run that no longer
     * exists. I told him to Ctrl+C a sweep three times today, so this is my omission rather than an edge case.
     *
     * Synchronous unlink on purpose: the process is on its way out and an await here may never resolve.
     */
    /*
     * `released` guards both handlers, and it is not a nicety.
     *
     * Without it: this process releases the lock, another process takes it, this one later exits — and its
     * exit handler deletes the OTHER run's lock file. Two browsers on one REI profile is the exact failure
     * the lock exists to prevent, so a cleanup that can delete somebody else's lock is worse than no cleanup.
     */
    const releaseSync = () => {
      if (released) return;
      released = true;
      try { fsSync.unlinkSync(LOCK_PATH); } catch { /* already gone */ }
    };
    /*
     * THE LOCK NO LONGER CALLS process.exit(), AND THAT ONE LINE IS THE REI LOGOUT BUG.
     *
     * What stood here was its own SIGINT/SIGTERM/SIGHUP handler ending in `process.exit()`. The lock is
     * taken BEFORE the browser opens, so this handler was always first in line — and process.exit() ends
     * the process on the spot. No finally, no `await context.close()`, no Playwright cleanup. Chromium was
     * killed rather than shut down, so it never flushed its cookie database, so the REI session cookie on
     * disk fell back to a value REI no longer accepted, and the next run was redirected to the login page.
     *
     * Every Ctrl+C, every Task Scheduler stop, every closed console window cost the client their REI login.
     * Signing back in worked until the next interrupt, which is exactly what they kept describing: "i
     * laready log in earlier why i kept logging in".
     *
     * The exit now happens in runShutdown at the top of this file, AFTER the browser has been closed
     * properly — order 90 here against the browser's order 10, so the lock is the last thing released and
     * nothing can open the profile while Chromium is still writing to it.
     */
    onShutdown(releaseSync, { order: 90, sync: true, label: 'release the run lock' });

    return release;
  } catch (error) {
    if (error.code === 'EEXIST') return null;
    throw error;
  }
}
