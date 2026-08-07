import { pathToFileURL } from 'node:url';
import { authorizeGoogle } from './google/auth.mjs';
import { config } from './config.mjs';
import { processInbox } from './services/process.mjs';
import { acquireLock } from './utils/lock.mjs';
import { haltForPause } from './utils/paused.mjs';
import { createLogger } from './utils/logger.mjs';

export async function runOnce() {
  const logger = createLogger(config.logLevel);
  // Paused before the lock and before Gmail is touched — see src/utils/paused.mjs.
  if (haltForPause({ force: process.argv.includes('--force') })) return;

  const release = await acquireLock();
  if (!release) {
    logger.warn('Another run is active. This run was skipped to prevent duplicate browser and calendar work.');
    return { skipped: true };
  }

  try {
    const auth = await authorizeGoogle();
    const result = await processInbox(auth, logger);
    logger.info('Run completed.', result);
    return result;
  } finally {
    await release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runOnce().catch((error) => {
    console.error(JSON.stringify({
      time: new Date().toISOString(),
      level: 'error',
      message: 'Run failed.',
      details: { name: error.name, message: error.message, stack: error.stack }
    }));
    process.exitCode = 1;
  });
}
