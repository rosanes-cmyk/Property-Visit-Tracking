import { pathToFileURL } from 'node:url';
import { google } from 'googleapis';
import { authorizeGoogle } from './google/auth.mjs';
import { config } from './config.mjs';
import { processInbox } from './services/process.mjs';
import { acquireLock } from './utils/lock.mjs';
import { createLogger } from './utils/logger.mjs';
import { haltIfNotActiveMachine } from './google/agent-settings.mjs';
import { beginJob, endJob, recordActivity } from './utils/heartbeat.mjs';

export async function runOnce() {
  const logger = createLogger(config.logLevel);
  const release = await acquireLock();
  if (!release) {
    logger.warn('Another run is active. This run was skipped to prevent duplicate browser and calendar work.');
    return { skipped: true };
  }

  try {
    const auth = await authorizeGoogle();
    /*
     * Only the ACTIVE PC runs — and this is the one job the PAUSE deliberately does not cover, so the two
     * checks sitting side by side here is not an inconsistency.
     *
     * The pause is about which JOBS are wanted, and the client was explicit that the intake is always
     * wanted: "i said you only pause the check in REI auto update, not the auto add in calendar and check
     * in email and auto update the dashboard, right?" This is about which MACHINE, and a spare PC reading
     * the same booking email would open its own REI browser on the same account — the collision that kept
     * logging REI out — and race the active one to create the row and the calendar event.
     *
     * Inside the lock rather than before it, because it needs the Google client that is created here. The
     * cost is one held lock for the second or two the check takes, on a machine that then does nothing.
     */
    if (await haltIfNotActiveMachine(google.sheets({ version: 'v4', auth }), config.spreadsheetId,
      { log: (m) => logger.info(m) })) {
      return { skipped: true, reason: 'not the active machine' };
    }
    /*
     * The intake reports itself too, but WITHOUT a per-item beat.
     *
     * It fires every two minutes and almost always has nothing to do, so a heartbeat per run would rewrite
     * the file 720 times a day to say "idle" — and worse, it would overwrite a genuinely interesting beat
     * from a sweep that is still going. So it only announces itself when it actually processed something.
     */
    beginJob('intake', { phase: 'reading booking emails' });
    const result = await processInbox(auth, logger);
    logger.info('Run completed.', result);
    const handled = Number(result?.processed ?? result?.logged ?? 0);
    endJob({ summary: handled ? `${handled} booking(s) logged` : 'no new booking emails', ok: true });
    if (handled) recordActivity(`Booking intake — ${handled} logged.`, { kind: 'ok', job: 'intake' });
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
