/**
 * One switch that stops the automation running on its own.
 *
 * The client, mid-debugging: "can we stop the auto update, we need to pause this for now, we have bug in
 * the system and auto update not need for now."
 *
 * Why this is not just "disable the scheduled task": on this client's machine `schtasks /Change /DISABLE`
 * answered "Access is denied" for one of the two tasks, so the documented way of stopping it did not work
 * and left the other task switched off while it failed. The project already learned this once with
 * WhatsApp and wrote the conclusion down — a disabled scheduled task is not an off switch, because anyone
 * can run the command by hand. The switch has to live in the code.
 *
 * Two ways to set it, because they suit different people:
 *   - `AUTOMATION_PAUSED=true` in .env — survives a re-install, obvious to anyone reading the config.
 *   - a file at ./data/PAUSED — no editing, no syntax to get wrong, and `scripts\pause.cmd` makes it.
 *
 * Either one pauses. BOTH must be cleared to resume, which is deliberate: a half-cleared pause that
 * silently keeps running is the failure this is meant to prevent.
 *
 * A run somebody TYPES is not paused — that is what `--force` is for. Pausing is about the automation
 * acting unattended; it must not stop the person debugging it from working.
 */
import fsSync from 'node:fs';
import path from 'node:path';

export const PAUSE_FILE = './data/PAUSED';

const TRUE = ['1', 'true', 'yes', 'on'];

/**
 * Why the automation is paused, or '' when it is not.
 *
 * `exists` is injectable so the decision is tested without touching the filesystem.
 */
export function pauseReason({ env = process.env, exists } = {}) {
  const flag = String(env.AUTOMATION_PAUSED == null ? '' : env.AUTOMATION_PAUSED).trim().toLowerCase();
  const fileThere = exists === undefined ? fsSync.existsSync(path.resolve(PAUSE_FILE)) : !!exists;

  /* Both reported when both are set, or clearing one and seeing it still paused reads as a broken switch. */
  const reasons = [];
  if (TRUE.includes(flag)) reasons.push('AUTOMATION_PAUSED is set in .env');
  if (fileThere) reasons.push(`the file ${PAUSE_FILE} exists`);
  return reasons.join(' and ');
}

/**
 * Print the pause and return true when the caller should stop.
 *
 * Returns false — carry on — when nothing is paused, or when `force` says a person asked for this run.
 */
export function haltForPause({ force = false, env = process.env, exists, log = console.log } = {}) {
  const why = pauseReason({ env, exists });
  if (!why) return false;
  if (force) {
    log(`Automation is PAUSED (${why}) — running anyway because --force was passed.`);
    return false;
  }
  log(`Automation is PAUSED — ${why}.`);
  log('Nothing was read, written or posted.');
  log('');
  log('To run this one anyway:   add --force');
  log('To resume the automation: scripts\\resume.cmd   (or remove AUTOMATION_PAUSED from .env)');
  return true;
}
