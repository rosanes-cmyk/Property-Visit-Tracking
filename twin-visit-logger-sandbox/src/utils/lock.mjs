import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

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
     * signal:false so a second Ctrl+C still kills it outright, and the exit code is the conventional
     * 128 + signal so a wrapper script can still tell it was interrupted.
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
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      process.once(signal, () => {
        releaseSync();
        // 128 + signal, the conventional code, so a wrapper can still tell this was interrupted.
        process.exit(signal === 'SIGINT' ? 130 : 143);
      });
    }
    /* A clean exit — including an uncaught throw — leaves nothing behind either. */
    process.once('exit', releaseSync);

    return release;
  } catch (error) {
    if (error.code === 'EEXIST') return null;
    throw error;
  }
}
