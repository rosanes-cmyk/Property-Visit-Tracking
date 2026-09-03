import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { onShutdown } from './shutdown.mjs';

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
     * The exit now happens in src/utils/shutdown.mjs, AFTER the browser has been closed properly — order 90
     * here against the browser's order 10, so the lock is the last thing released and nothing can open the
     * profile while Chromium is still writing to it. See shutdown.mjs for the full account.
     */
    onShutdown(releaseSync, { order: 90, sync: true, label: 'release the run lock' });

    return release;
  } catch (error) {
    if (error.code === 'EEXIST') return null;
    throw error;
  }
}
