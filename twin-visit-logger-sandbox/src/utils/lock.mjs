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
