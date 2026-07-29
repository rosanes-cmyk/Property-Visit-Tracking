import fs from 'node:fs/promises';
import path from 'node:path';

const LOCK_PATH = path.resolve('./data/run.lock');
const STALE_AFTER_MS = 30 * 60 * 1000;

async function removeStaleLock() {
  try {
    const stat = await fs.stat(LOCK_PATH);
    if (Date.now() - stat.mtimeMs > STALE_AFTER_MS) {
      await fs.unlink(LOCK_PATH);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export async function acquireLock() {
  await fs.mkdir(path.dirname(LOCK_PATH), { recursive: true });
  await removeStaleLock();
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
