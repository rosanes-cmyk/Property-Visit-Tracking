import fs from 'node:fs/promises';
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
    return async () => {
      await handle.close().catch(() => {});
      await fs.unlink(LOCK_PATH).catch(() => {});
    };
  } catch (error) {
    if (error.code === 'EEXIST') return null;
    throw error;
  }
}
