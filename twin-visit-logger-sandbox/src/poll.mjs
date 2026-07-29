import { config } from './config.mjs';
import { runOnce } from './run-once.mjs';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const intervalMs = config.pollIntervalMinutes * 60 * 1000;

let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});

while (!stopping) {
  await runOnce().catch((error) => {
    console.error(JSON.stringify({
      time: new Date().toISOString(),
      level: 'error',
      message: 'Polling cycle failed.',
      details: { name: error.name, message: error.message }
    }));
  });
  if (!stopping) await delay(intervalMs);
}
