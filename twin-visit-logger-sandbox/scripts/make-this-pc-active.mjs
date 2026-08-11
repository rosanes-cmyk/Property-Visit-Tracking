/**
 * Make THIS PC the one that runs the automation.
 *
 *   node scripts/make-this-pc-active.mjs
 *   node scripts/make-this-pc-active.mjs --force     take it off a PC that still holds it
 *   node scripts/make-this-pc-active.mjs --release   hand it back, so another PC can take over
 *   node scripts/make-this-pc-active.mjs --who       just say who has it
 *
 * WHY THIS EXISTS
 *
 * The client asked for the automation as an installable app they could put on every PC — "so it can just
 * tranfer on evry pc" — after asking what happens if their machine is damaged. Installing it everywhere is
 * the right answer to that, and it is also dangerous: two machines driving REI on one account is exactly
 * what kept logging them out, and it is why this project has a browser lock at all.
 *
 * The local lock cannot solve it. It is a file on one disk, so two PCs each take their own and both open a
 * browser. The workbook is the only thing both machines can see, so the claim lives there, and every
 * scheduled job checks it and stands down when it is not the named one.
 *
 * That makes this the whole recovery procedure. PC dies, walk to another one, run this, done.
 */
import { google } from 'googleapis';
import { authorizeGoogle } from '../src/google/auth.mjs';
import { config } from '../src/config.mjs';
import {
  claimMachine, releaseMachine, checkMachineClaim, readAgentSettings,
  machineName, SETTING, AGENT_SETTINGS_SHEET
} from '../src/google/agent-settings.mjs';

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const RELEASE = args.includes('--release');
const WHO = args.includes('--who');

const auth = await authorizeGoogle();
const sheets = google.sheets({ version: 'v4', auth });

const me = machineName();
console.log(`This PC is "${me}".\n`);

const settings = await readAgentSettings(sheets, config.spreadsheetId);
if (!settings) {
  console.log(`The workbook has no "${AGENT_SETTINGS_SHEET}" tab yet, so there is nothing to claim.`);
  console.log('Open the sheet, then:  🏠 Twin Visit Logger  →  💻 Publish settings for the PC app');
  console.log('Then run this again.');
  process.exit(1);
}

if (WHO) {
  const claim = await checkMachineClaim(sheets, config.spreadsheetId, { settings });
  if (claim.unclaimed || claim.unknown) console.log('No PC has claimed it. The next scheduled run anywhere will work.');
  else console.log(`Claimed by "${claim.claimedBy}"${claim.since ? ` since ${claim.since}` : ''}`
    + `${claim.mine ? '  ← that is this PC' : ''}`);
  process.exit(0);
}

if (RELEASE) {
  const r = await releaseMachine(sheets, config.spreadsheetId);
  if (r.ok) {
    console.log('Released. No PC is active now, so nothing is running anywhere.');
    console.log('Run this on whichever PC should take over.');
    process.exit(0);
  }
  console.log(`Not released — "${r.claimedBy}" holds it, not this PC.`);
  console.log('Run --release on that PC, or use the sheet menu: 💻 Release the PC.');
  process.exit(1);
}

const result = await claimMachine(sheets, config.spreadsheetId, { force: FORCE });

if (result.ok) {
  if (result.alreadyMine) {
    console.log('This PC was already the active one. Nothing changed.');
  } else if (result.tookFrom) {
    console.log(`Taken from "${result.tookFrom}". This PC now runs the automation.`);
    /*
     * Said out loud because --force is the one path here that can cause the very problem the claim exists
     * to prevent. If that other machine is still awake, its next timer will stand down — but only when it
     * next reads the sheet, which is up to a couple of minutes away.
     */
    console.log(`\nIf "${result.tookFrom}" is still switched on, make sure it is not also running:`);
    console.log('  its next scheduled run will notice and stand down on its own, within a few minutes.');
  } else {
    console.log('This PC now runs the automation.');
  }
  console.log('\nThe scheduled tasks take it from here. Nothing to restart.');
  process.exit(0);
}

/*
 * Refusing is the default, and the message has to be enough to decide on without opening the sheet: WHO
 * holds it, SINCE when, and the two ways out. A bare "already claimed" would send somebody hunting.
 */
console.log(`"${result.claimedBy}" is the active PC${result.since ? `, since ${result.since}` : ''}.`);
console.log('\nNothing was changed. Two PCs running this at once is what logs REI out, so it will not');
console.log('take over quietly.\n');
console.log('If that PC is finished with, off, or broken:');
console.log('  node scripts/make-this-pc-active.mjs --force');
console.log('\nOr release it from the workbook: 🏠 Twin Visit Logger → 💻 Release the PC.');
process.exit(1);
