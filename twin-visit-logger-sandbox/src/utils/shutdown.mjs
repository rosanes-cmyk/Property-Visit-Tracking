/**
 * One place that decides what happens when a run is interrupted — and, above all, that CLOSES CHROMIUM
 * before the process dies.
 *
 * THIS IS WHY REI KEPT LOGGING ITSELF OUT.
 *
 * The lock installed its own signal handlers and ended them with `process.exit()`:
 *
 *     for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
 *       process.once(signal, () => { releaseSync(); process.exit(...); });
 *     }
 *
 * The lock is acquired BEFORE the browser opens, so that handler was always first in line. `process.exit()`
 * ends the process on the spot: no `finally`, no `await context.close()`, and Playwright's own cleanup never
 * runs. Chromium is left to be killed rather than shut down.
 *
 * Chromium does not write its cookie database on every change. It keeps cookies in memory and commits them
 * to `Cookies` on a lazy timer and — completely — on a GRACEFUL shutdown. Kill it and whatever the session
 * cookie had become since the last commit is simply gone. REI rotates that cookie, so the profile on disk
 * falls back to a value REI no longer accepts, and the next run is redirected to the login page.
 *
 * Every observation fits, and none of the theories that came before did:
 *
 *   - Chromium itself reported "Restore pages? Chromium didn't shut down correctly." That message IS the
 *     non-graceful-exit marker, written into the profile's own Preferences. It was the one hard clue and it
 *     was pointing straight at this.
 *   - The account is not shared — the client checked: "no one using it."
 *   - A brand-new profile lost the session just as fast, because the next interrupt loses it again.
 *   - "i laready log in earlier why i kept logging in" — a manual login, saved correctly, then destroyed by
 *     the next interrupted run.
 *   - It got WORSE on the day I had the client Ctrl+C sweeps repeatedly to unstick two bookings. The
 *     comment in lock.mjs even says so: "I told him to Ctrl+C a sweep three times today."
 *
 * So: Ctrl+C, a Task Scheduler stop (StopIfGoingOnBatteries is on unless the installer managed to clear it,
 * and on this machine that call answered "Access is denied"), or closing the console window all cost the
 * REI session. Signing back in fixed it until the next interrupt, which is exactly the shape the client
 * described.
 *
 * HOW THIS FIXES IT. Handlers are registered here, in a defined order, and the exit happens only after they
 * have all had their turn:
 *
 *   order 10  the browser  — `await context.close()`, which shuts Chromium down properly and flushes cookies
 *   order 90  the lock     — released last, so nothing else can open the profile while Chromium is closing
 *
 * A second Ctrl+C still kills it outright, and there is a hard cap so a wedged browser cannot make Ctrl+C
 * feel broken. Both matter: a shutdown that hangs is one people learn to kill with Task Manager, which is
 * the very thing this exists to stop.
 */
const handlers = new Set();
let installed = false;
let shuttingDown = false;

/*
 * Long enough for Chromium to close (it takes a second or two, more with several tabs open), short enough
 * that Ctrl+C never feels ignored. Past this we exit anyway — losing the cookie flush is bad, but leaving
 * somebody unable to stop a run is worse, and they will reach for Task Manager and lose it regardless.
 */
const SHUTDOWN_BUDGET_MS = 10_000;

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
