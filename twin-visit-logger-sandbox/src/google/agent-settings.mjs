/**
 * The settings, and the machine claim, both read out of the workbook.
 *
 * WHY THE SETTINGS ARE NOT IN .env ANY MORE (for a new install)
 *
 * The client asked for an installable app: "once i installed the application in one pc all must go on like
 * automatic once intall the app." Everything in that sentence was achievable except configuration — the PC
 * side needed a hand-typed `.env` naming the workbook, the tab, the calendar and the Chat webhook, and any
 * "just install it" story that ends in Notepad is not what was asked for.
 *
 * Baking those values into the installer was the obvious fix and the wrong one: the Chat webhook is a
 * credential, so the installer file would itself become one — leaked by any copy on a stick, a Drive folder
 * or an email. So the values live in the workbook, published there by a menu click, and read from here with
 * the Google login the app already holds.
 *
 * The installer carries exactly one value, the spreadsheet ID, and that is not a secret: it is in the URL
 * of the sheet, and knowing it grants nothing without permission to open it.
 *
 * WHY THE MACHINE CLAIM IS HERE TOO
 *
 * The client wants it on every PC: "so it can just tranfer on evry pc". Two machines driving REI on one
 * account is what logs REI out — the whole reason the run lock exists — so "installed everywhere" has to
 * mean "ready everywhere, running on one". The local lock cannot do this: it is a file on one disk and
 * knows nothing about the other machine. The workbook is the only thing both PCs can see, so the claim
 * lives there.
 *
 * It is a claim, not a lock. It is not defended against two machines started in the same second; it is
 * defended against the realistic case, which is a spare PC someone installed months ago quietly waking up
 * and starting to sweep REI alongside the one that is meant to.
 */
import os from 'node:os';

export const AGENT_SETTINGS_SHEET = 'Automation Settings';

export const SETTING = {
  trackerSheet: 'Tracker Sheet',
  calendarName: 'Calendar Name',
  calendarId: 'Calendar ID',
  chatWebhook: 'Chat Webhook URL',
  dashboardUrl: 'Dashboard URL',
  publishedAt: 'Published At',
  activeMachine: 'Active Machine',
  activeMachineAt: 'Active Machine Since'
};

/** This PC's name, as the workbook and the Chat alerts will show it. */
export function machineName() {
  return String(os.hostname() || 'unknown-pc').trim();
}

/**
 * Read the whole settings tab as a Map of key -> value.
 *
 * Returns null — NOT an empty map — when the tab does not exist. The difference is the whole diagnosis:
 * "no tab" means somebody has not clicked *Publish settings for the PC app* yet, and the fix is one menu
 * item. "Tab present but a value missing" means something else, and the setup wizard says so differently.
 */
export async function readAgentSettings(sheets, spreadsheetId) {
  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${AGENT_SETTINGS_SHEET}!A:B`
    });
  } catch (error) {
    /*
     * A missing tab and a missing PERMISSION both land here, and telling them apart matters: one is a menu
     * click, the other is "this Google account cannot open that workbook at all". Sheets says "Unable to
     * parse range" for the first, which is the only reliable way to distinguish them from the outside.
     */
    if (/unable to parse range|not found/i.test(error.message || '')) return null;
    throw error;
  }
  const out = new Map();
  for (const [key, value] of (res.data.values || []).slice(1)) {
    if (key === undefined) continue;
    const name = String(key).trim();
    if (name) out.set(name, String(value === undefined || value === null ? '' : value).trim());
  }
  return out;
}

/** How old the published settings are, in whole days, or null when there is no stamp to measure. */
export function settingsAgeDays(settings) {
  const stamp = settings?.get(SETTING.publishedAt);
  if (!stamp) return null;
  const at = new Date(stamp);
  if (Number.isNaN(at.getTime())) return null;
  return Math.floor((Date.now() - at.getTime()) / 86400000);
}

async function writeSetting(sheets, spreadsheetId, key, value) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId, range: `${AGENT_SETTINGS_SHEET}!A:A`
  });
  const keys = (res.data.values || []).map((r) => String(r[0] ?? '').trim());
  const at = keys.indexOf(key);
  if (at < 0) throw new Error(`"${key}" is not a row on the ${AGENT_SETTINGS_SHEET} tab.`);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${AGENT_SETTINGS_SHEET}!B${at + 1}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[value]] }
  });
}

/**
 * Is this the PC that is supposed to be running?
 *
 * Three answers, because they need three different behaviours:
 *   { mine: true }                      → go ahead
 *   { mine: false, claimedBy: 'PC-2' }  → stand down silently, this is a spare
 *   { unknown: true }                   → the tab is not published; go ahead rather than stopping
 *
 * That last one is the important choice. An unpublished tab is a setup step nobody has done, and refusing
 * to run because of it would break every machine that is working today the moment this code ships — a
 * migration that silently switches the automation off is far worse than one that carries on as before.
 * So an absent registry means "no opinion", and only an explicit claim by a DIFFERENT machine stops a run.
 */
export async function checkMachineClaim(sheets, spreadsheetId, { settings = null } = {}) {
  const s = settings || await readAgentSettings(sheets, spreadsheetId);
  if (!s || !s.has(SETTING.activeMachine)) return { unknown: true, mine: true };
  const claimed = s.get(SETTING.activeMachine);
  if (!claimed) return { unclaimed: true, mine: true };
  return { mine: claimed === machineName(), claimedBy: claimed, since: s.get(SETTING.activeMachineAt) || '' };
}

/**
 * Take the claim for this machine.
 *
 * `force` is required to take it off another PC, and the caller is expected to have asked a person first.
 * Silently stealing it would produce exactly the failure this exists to prevent: two machines sweeping REI,
 * logging the account out, and nothing on screen saying why.
 */
export async function claimMachine(sheets, spreadsheetId, { force = false } = {}) {
  const s = await readAgentSettings(sheets, spreadsheetId);
  if (!s) {
    throw new Error(
      `The workbook has no "${AGENT_SETTINGS_SHEET}" tab yet.\n`
      + 'Open the sheet → 🏠 Twin Visit Logger → 💻 Publish settings for the PC app, then run this again.'
    );
  }
  const held = s.get(SETTING.activeMachine) || '';
  const me = machineName();
  if (held && held !== me && !force) {
    return { ok: false, claimedBy: held, since: s.get(SETTING.activeMachineAt) || '' };
  }
  if (held === me) return { ok: true, alreadyMine: true, name: me };
  await writeSetting(sheets, spreadsheetId, SETTING.activeMachine, me);
  await writeSetting(sheets, spreadsheetId, SETTING.activeMachineAt, new Date().toISOString());
  return { ok: true, name: me, tookFrom: held || null };
}

/** Give the claim up, so another PC can take over. Only ever releases OUR own claim. */
export async function releaseMachine(sheets, spreadsheetId) {
  const s = await readAgentSettings(sheets, spreadsheetId);
  if (!s) return { ok: false, reason: 'no settings tab' };
  const held = s.get(SETTING.activeMachine) || '';
  if (held && held !== machineName()) return { ok: false, claimedBy: held };
  await writeSetting(sheets, spreadsheetId, SETTING.activeMachine, '');
  await writeSetting(sheets, spreadsheetId, SETTING.activeMachineAt, '');
  return { ok: true };
}

/**
 * The line an unattended job prints when it is not the active machine.
 *
 * Wording chosen so a person reading a log on a spare PC does not think it is broken. "Standing down" and
 * a named other machine is the whole message; "lock held" or an exit code is what makes somebody start
 * debugging a machine that is behaving exactly as designed.
 */
export function standDownMessage(claim) {
  return `This PC (${machineName()}) is not the active one — "${claim.claimedBy}" is`
    + `${claim.since ? `, since ${claim.since}` : ''}.\n`
    + 'Standing down. Nothing was read, written or posted, and nothing is wrong.\n'
    + 'To move the automation here: run scripts\\make-this-pc-active.cmd on THIS PC\n'
    + '(or, if that PC is broken: open the sheet → 🏠 Twin Visit Logger → 💻 Release the PC).';
}

/**
 * The one call every unattended job makes. Returns true when the caller should stop.
 *
 * Deliberately different from the pause switch in two ways, and the difference is worth being clear about
 * because at a glance they look like the same idea.
 *
 * 1. The PAUSE covers only the jobs that go back and rewrite already-tracked leads. The intake is exempt,
 *    at the client's correction — "i said you only pause the check in REI auto update, not the auto add in
 *    calendar and check in email". THIS covers the intake too. A spare PC processing the same booking email
 *    would open its own REI browser on the same account, which is the exact collision that logs REI out;
 *    and "which machine" has nothing to do with "which jobs are wanted".
 *
 * 2. A pause is a decision somebody made. This is a fact about where the automation lives. So it never asks
 *    to be overridden with --force: forcing a spare PC to run alongside the active one is not a debugging
 *    convenience, it is the failure. Moving the automation is its own deliberate command.
 *
 * Failures are swallowed. If the settings tab cannot be read — offline, permissions, a rename — the job
 * carries on. Standing down on a read error would mean one bad network minute silently switches off the
 * whole automation, which is a far worse outcome than the collision this guards against.
 */
export async function haltIfNotActiveMachine(sheets, spreadsheetId, { log = console.log } = {}) {
  let claim;
  try {
    claim = await checkMachineClaim(sheets, spreadsheetId);
  } catch (error) {
    log(`(Could not read which PC is active: ${error.message} — carrying on.)`);
    return false;
  }
  if (claim.mine) return false;
  log(`\n${standDownMessage(claim)}`);
  return true;
}
