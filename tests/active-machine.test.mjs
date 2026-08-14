/**
 * Which PC is allowed to run — the registry that makes "install it on every PC" safe.
 *
 *   node tests/active-machine.test.mjs
 *
 * The client asked what happens if their machine is damaged, then asked for the automation as an app they
 * could put on every PC: "can we make it into app? so it can just tranfer on evry pc" and "once i installed
 * the application in one pc all must go on like automatic once intall the app."
 *
 * Installing it everywhere is the right answer to a broken PC and it is also the most dangerous change in
 * this project. Two machines driving REI on one account is what kept logging the client out — it is the
 * documented reason the browser lock exists — and the local lock CANNOT prevent it: the lock is a file on
 * one disk, so two PCs each take their own and both open a browser. So the claim lives in the workbook, the
 * only thing both machines can see.
 *
 * These tests run the shipped functions against a stubbed Sheets client rather than reading the source,
 * because every question here is behavioural: does a spare PC actually stand down, and does the active one
 * actually keep working.
 */
import os from 'node:os';
import fs from 'node:fs';
import {
  readAgentSettings, checkMachineClaim, claimMachine, releaseMachine, haltIfNotActiveMachine,
  standDownMessage, machineName, SETTING, AGENT_SETTINGS_SHEET
} from '../twin-visit-logger-sandbox/src/google/agent-settings.mjs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

const ME = os.hostname();

/**
 * A Sheets client with just enough behaviour to be wrong in the ways the real one is.
 *
 * `missing: true` throws the message Sheets actually returns for a tab that is not there — "Unable to parse
 * range" — because that string is the only way to tell a missing TAB from a missing PERMISSION from the
 * outside, and the code branches on it.
 */
function stubSheets(rows, { missing = false, throws = null } = {}) {
  const state = { rows: rows.map((r) => [...r]), updates: [] };
  const api = {
    spreadsheets: {
      values: {
        get: async ({ range }) => {
          if (throws) throw new Error(throws);
          if (missing) throw new Error('Unable to parse range: Automation Settings!A:B');
          if (/!A:A$/.test(range)) return { data: { values: state.rows.map((r) => [r[0]]) } };
          return { data: { values: state.rows } };
        },
        update: async ({ range, requestBody }) => {
          const row = Number(/B(\d+)/.exec(range)[1]);
          state.rows[row - 1][1] = requestBody.values[0][0];
          state.updates.push({ row, value: requestBody.values[0][0] });
          return {};
        }
      }
    }
  };
  return { api, state };
}

const HEADER = ['Key', 'Value', 'What it is for'];
const tab = (machine, since = '') => [
  HEADER,
  [SETTING.trackerSheet, 'Data', ''],
  [SETTING.calendarName, "Juan's Official Calendar", ''],
  [SETTING.chatWebhook, 'https://chat.googleapis.com/hook', ''],
  [SETTING.publishedAt, new Date().toISOString(), ''],
  [SETTING.activeMachine, machine, ''],
  [SETTING.activeMachineAt, since, '']
];

console.log('=== reading the published settings ===');
{
  const { api } = stubSheets(tab('PC-ALPHA'));
  const s = await readAgentSettings(api, 'sheet1');
  check('the tracker tab comes from the workbook', s.get(SETTING.trackerSheet), 'Data');
  check('...and the calendar', s.get(SETTING.calendarName), "Juan's Official Calendar");
  /*
   * The webhook is the whole reason the settings live in the sheet rather than in the installer. Baking a
   * credential into a file that gets copied to every PC and onto a USB stick makes the installer itself a
   * credential; reading it after Google sign-in means the installer carries nothing secret at all.
   */
  check('...and the Chat webhook, which is why this exists at all',
    s.get(SETTING.chatWebhook), 'https://chat.googleapis.com/hook');
  check('the header row is not read as a setting', s.has('Key'), false);
}
{
  /*
   * A missing tab must read as null, NOT as an empty map. "No tab" means nobody has clicked Publish yet and
   * the fix is one menu item; "tab present, value blank" is a different problem with a different message.
   * Collapsing them is how a setup wizard ends up telling somebody the wrong thing to do.
   */
  const { api } = stubSheets([], { missing: true });
  check('a missing tab is null, not an empty map', await readAgentSettings(api, 'sheet1'), null);
}
{
  /* A permission error is NOT a missing tab, and must not be swallowed as one. */
  const { api } = stubSheets([], { throws: 'The caller does not have permission' });
  let threw = '';
  try { await readAgentSettings(api, 'sheet1'); } catch (e) { threw = e.message; }
  check('a permissions failure is thrown, not read as "not published"',
    /does not have permission/.test(threw), true);
}

console.log('\n=== is this the machine that should be running? ===');
{
  const { api } = stubSheets(tab(ME, '2026-08-11T09:00:00Z'));
  const claim = await checkMachineClaim(api, 'sheet1');
  check('the claimed PC recognises itself', claim.mine, true);
}
{
  const { api } = stubSheets(tab('PC-ALPHA', '2026-08-11T09:00:00Z'));
  const claim = await checkMachineClaim(api, 'sheet1');
  check('a spare PC knows it is not the one', claim.mine, false);
  check('...and can say who is', claim.claimedBy, 'PC-ALPHA');
  check('...and since when', claim.since, '2026-08-11T09:00:00Z');
}
{
  const { api } = stubSheets(tab(''));
  check('nobody claimed means anyone may run', (await checkMachineClaim(api, 'sheet1')).mine, true);
}
{
  /*
   * THE MIGRATION RULE, and the most important test here.
   *
   * An unpublished tab must mean "no opinion", not "stop". If it meant stop, shipping this code would
   * silently switch off the automation on the one machine that is working today — the settings tab does not
   * exist there yet — and the symptom would be every job standing down with nobody having changed anything.
   * A migration that turns the system off is far worse than the collision this guards against.
   */
  const { api } = stubSheets([], { missing: true });
  const claim = await checkMachineClaim(api, 'sheet1');
  check('an unpublished registry does NOT stop a working install', claim.mine, true);
  check('...and says it had no opinion', claim.unknown, true);
}

console.log('\n=== claiming, and refusing to steal ===');
{
  const { api, state } = stubSheets(tab(''));
  const r = await claimMachine(api, 'sheet1');
  check('an unclaimed automation can be taken', r.ok, true);
  check('...and the workbook records this PC', state.rows[5][1], ME);
  check('...with a timestamp', /^\d{4}-\d{2}-\d{2}T/.test(state.rows[6][1]), true);
}
{
  const { api, state } = stubSheets(tab(ME));
  const r = await claimMachine(api, 'sheet1');
  check('claiming twice is a no-op', [r.ok, r.alreadyMine], [true, true]);
  check('...and writes nothing', state.updates, []);
}
{
  /*
   * The default is REFUSAL. Silently taking the claim off a live machine would cause the exact failure the
   * registry exists to prevent, and it would do it at the moment somebody is least expecting it — during a
   * routine install on a second PC.
   */
  const { api, state } = stubSheets(tab('PC-ALPHA', '2026-08-01T08:00:00Z'));
  const r = await claimMachine(api, 'sheet1');
  check('a live claim is not taken quietly', r.ok, false);
  check('...and nothing is written', state.updates, []);
  check('...and it names who holds it', [r.claimedBy, r.since], ['PC-ALPHA', '2026-08-01T08:00:00Z']);
}
{
  const { api, state } = stubSheets(tab('PC-ALPHA'));
  const r = await claimMachine(api, 'sheet1', { force: true });
  check('--force takes it', [r.ok, r.tookFrom], [true, 'PC-ALPHA']);
  check('...and the workbook now names this PC', state.rows[5][1], ME);
}
{
  const { api } = stubSheets([], { missing: true });
  let threw = '';
  try { await claimMachine(api, 'sheet1'); } catch (e) { threw = e.message; }
  check('claiming with no tab explains the menu item to click', /Publish settings for the PC app/.test(threw), true);
}

console.log('\n=== releasing ===');
{
  const { api, state } = stubSheets(tab(ME, '2026-08-11T09:00:00Z'));
  const r = await releaseMachine(api, 'sheet1');
  check('this PC can hand it back', r.ok, true);
  check('...clearing the name', state.rows[5][1], '');
  check('...and the timestamp', state.rows[6][1], '');
}
{
  /* Releasing SOMEBODY ELSE's claim from here would be a way to switch off a machine you cannot see. */
  const { api, state } = stubSheets(tab('PC-ALPHA'));
  const r = await releaseMachine(api, 'sheet1');
  check('it will not release another PC', [r.ok, r.claimedBy], [false, 'PC-ALPHA']);
  check('...and writes nothing', state.updates, []);
}

console.log('\n=== what an unattended job does about it ===');
{
  const said = [];
  const { api } = stubSheets(tab('PC-ALPHA', '2026-08-01T08:00:00Z'));
  const halt = await haltIfNotActiveMachine(api, 'sheet1', { log: (m) => said.push(String(m)) });
  check('a spare PC halts', halt, true);
  check('...and the log names the active machine', /PC-ALPHA/.test(said.join('\n')), true);
  /*
   * The wording matters more than it looks. Somebody reading a log on a spare PC has to understand it is
   * behaving correctly. "Lock held" or a non-zero exit is what makes a person start debugging a machine
   * that is doing exactly what it should.
   */
  check('...and says nothing is wrong', /nothing is wrong/.test(said.join('\n')), true);
  check('...and says how to move the automation here',
    /make-this-pc-active\.cmd/.test(said.join('\n')), true);
  check('...and how to recover when that PC is broken', /Release the PC/.test(said.join('\n')), true);
}
{
  const { api } = stubSheets(tab(ME));
  check('the active PC carries on', await haltIfNotActiveMachine(api, 'sheet1', { log: () => {} }), false);
}
{
  /*
   * A READ FAILURE MUST NOT STOP THE RUN.
   *
   * One bad network minute would otherwise switch the whole automation off silently — every job standing
   * down, nothing in Chat, the cards going stale — which is a far bigger failure than two browsers. So an
   * unreadable registry means "carry on", and it says so in the log.
   */
  const said = [];
  const { api } = stubSheets([], { throws: 'socket hang up' });
  const halt = await haltIfNotActiveMachine(api, 'sheet1', { log: (m) => said.push(String(m)) });
  check('a network failure does not halt the automation', halt, false);
  check('...but it is mentioned', /Could not read which PC is active/.test(said.join('\n')), true);
}

console.log('\n=== every unattended job checks it ===');
/*
 * A registry one job ignores is not a registry. The spare PC would sweep REI, or write statuses, or create
 * a duplicate row, and the collision would be back with an extra layer of code implying it could not be.
 */
const read = (p) => fs.readFileSync(new URL(`../twin-visit-logger-sandbox/${p}`, import.meta.url), 'utf8');
for (const file of ['scripts/recheck-rei.mjs', 'scripts/audit-notes.mjs', 'scripts/fill-pending-rei.mjs',
  'src/run-once.mjs']) {
  const src = read(file);
  check(`${file} checks which PC is active`, /haltIfNotActiveMachine\(/.test(src), true);
  /*
   * Before the browser. Standing down AFTER launching Chromium on the REI profile is not standing down —
   * that launch is the thing that corrupts the profile and logs the account out.
   */
  const browser = src.indexOf('launchReiContext(');
  if (browser >= 0) {
    check(`${file} checks it before opening REI`, src.indexOf('haltIfNotActiveMachine(') < browser, true);
  }
}
/*
 * And the INTAKE checks it, even though the pause deliberately exempts the intake. The two switches answer
 * different questions — the pause is "which jobs are wanted", this is "which machine" — and the client's
 * exemption was about the first: "i said you only pause the check in REI auto update, not the auto add in
 * calendar and check in email". A spare PC racing the active one to create a row and a calendar event is
 * not something they asked to keep.
 */
const INTAKE = read('src/run-once.mjs');
check('the intake checks the machine even though the pause exempts it',
  /haltIfNotActiveMachine\(/.test(INTAKE) && !/haltForPause/.test(INTAKE), true);
check('...and the reason is written down where somebody will read it',
  /the PAUSE deliberately does not cover/.test(INTAKE), true);

console.log('\n=== the workbook side ===');
{
  const GS = fs.readFileSync(new URL('../apps-script/AgentSettings.gs', import.meta.url), 'utf8');
  const COMBINED = fs.readFileSync(new URL('../apps-script/Code.combined.gs', import.meta.url), 'utf8');
  check('the tab name matches on both sides', GS.includes(`'${AGENT_SETTINGS_SHEET}'`), true);
  /*
   * Reachable from the menu — checked on the HANDLER, not the wording.
   *
   * These pinned the exact labels, emoji and all, and broke when the menu was regrouped into submenus even
   * though both items were still there and still worked. A test that fails on a rename it does not care
   * about trains you to edit tests without reading them, which is how a real break gets waved through.
   * What matters is that the workbook offers a way to run these functions; tests/menu.test.mjs separately
   * holds every menu action to a function that actually exists.
   */
  check('publishing is reachable from the menu', /'publishAgentSettings'\)/.test(COMBINED), true);
  /*
   * Releasing from the SHEET is the case the whole feature is for: the active PC is broken and cannot
   * release its own claim, so there has to be a way in that does not involve that machine.
   */
  check('the PC can be released from the workbook when it is broken',
    /'releaseActiveMachine'\)/.test(COMBINED), true);
  check('...and you can see which PC without unhiding the tab',
    /addItem\('💻 Which PC is running the automation\?'/.test(COMBINED), true);
  /*
   * Re-publishing must not unclaim the machine. It is a menu item somebody will click whenever they change
   * the webhook, and having that quietly stop the automation would be a trap.
   */
  check('re-publishing settings does not release the machine',
    /existingMachine = getAgentSetting_\(AGENT_SETTING_KEYS\.ACTIVE_MACHINE\)/.test(GS), true);
  /* The tab holds a credential, so it is hidden and protected, and the person publishing it is told. */
  check('the tab is hidden', /hideSheet\(\)/.test(GS), true);
  check('...and protected against a stray edit', /\.protect\(\)/.test(GS), true);
  check('...and the credential is called one, on screen',
    /which is a credential/.test(GS), true);
  check('the deployed copy carries it', COMBINED.includes('function publishAgentSettings()'), true);
}

console.log('\n--- the machine name is the same one the Chat alerts use ---');
/*
 * The REI logout alert says which PC to sign in on. If it used a different name from the registry, the
 * message would send somebody to the wrong machine — worse than no name at all.
 */
check('one source for this PC\'s name', machineName(), os.hostname().trim());
check('the logout alert uses it too',
  /os\.hostname\(\)/.test(read('scripts/recheck-rei.mjs')), true);
check('standDownMessage names this PC as well as the other',
  standDownMessage({ claimedBy: 'PC-ALPHA', since: '' }).includes(ME), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
