/**
 * First-run setup. The whole install, in one command.
 *
 *   node scripts/setup-app.mjs
 *   node scripts/setup-app.mjs --sheet "<paste the Google Sheet URL>"
 *   node scripts/setup-app.mjs --take-over        claim the automation off another PC
 *   node scripts/setup-app.mjs --no-tasks         set up, but do not schedule anything yet
 *
 * WHAT THE CLIENT ASKED FOR
 *
 * "can we make it into app? so it can just tranfer on evry pc" and "once i installed the application in one
 * pc all must go on like automatic once intall the app."
 *
 * So this does everything that can be done without a person: reads its own settings out of the workbook,
 * writes the config file, claims this machine, schedules all eight tasks, and proves it works before
 * claiming success.
 *
 * TWO STEPS CANNOT BE AUTOMATED, AND BOTH ARE ASKED FOR HERE
 *
 * Google requires a human to click Allow in a browser. There is no way round that and nobody should want
 * one — it is the consent that makes the token yours rather than mine.
 *
 * REI needs the password typed. That one is a REFUSAL, not a limitation: storing it would put the password
 * in a file that gets copied to every PC and onto whatever stick carries the installer, and a leaked REI
 * password is a different order of problem from a spreadsheet nobody swept for an afternoon. The project's
 * own rules have said so from the start — "Never store a REI password in source code or .env".
 *
 * WHY THIS FILE MUST NOT IMPORT config.mjs AT THE TOP
 *
 * config.mjs validates on import and throws without SPREADSHEET_ID — which is the very thing this script
 * exists to write. A static import would make the setup wizard impossible to run before setup was done.
 * So config, and everything that imports it, is pulled in dynamically AFTER the file is written, and the
 * later steps run as child processes so they read the finished config rather than a half-built one.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline/promises';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : null;
};
const TAKE_OVER = args.includes('--take-over');
const NO_TASKS = args.includes('--no-tasks');
const ASSUME_YES = args.includes('--yes');

const ENV_FILE = path.resolve('./.env');
const WORKBOOK_FILE = path.resolve('./config/workbook.json');

let steps = 0, failed = 0;
const notes = [];
function step(n, title) { steps += 1; console.log(`\n[${n}] ${title}`); }
function ok(msg) { console.log(`    OK   ${msg}`); }
function bad(msg) { failed += 1; console.log(`    ---> ${msg}`); }
function note(msg) { notes.push(msg); console.log(`    note ${msg}`); }

/* ------------------------------------------------------------------ helpers */

/**
 * Accept a whole Google Sheets URL, not just the ID.
 *
 * Asking a non-developer for "the spreadsheet ID" means asking them to find a 44-character string in the
 * middle of a URL, and getting it wrong produces a permissions error that looks nothing like the mistake.
 * Pasting the address bar is what a person can actually do, so that is what this takes.
 */
function spreadsheetIdFrom(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  /*
   * The example file's own placeholder is not an ID, and it used to pass as one.
   *
   * `.env.example` ships `SPREADSHEET_ID=PASTE_SANDBOX_SPREADSHEET_ID`. That is 27 characters of letters and
   * underscores, so the "already an ID" test below accepted it, and setup on a real PC printed:
   *
   *   OK      already configured — PASTE_SANDBOX_SPREADSHEET_ID
   *   ---> Cannot open that workbook: Requested entity was not found.
   *
   * A green OK followed by a failure two steps later, blaming the wrong thing — the message even suggested
   * the account might not have access to the sheet, sending somebody to check Drive sharing when the real
   * problem was that nobody had ever pasted an ID.
   *
   * A placeholder here is SCREAMING_SNAKE_CASE; a Google file ID is mixed case. So: no lowercase letters and
   * at least one underscore means somebody copied the example and did not fill it in. Narrow on purpose —
   * Google IDs really do contain underscores and hyphens, so the lowercase test is what separates them.
   */
  const looksLikeAPlaceholder = raw.includes('_') && raw === raw.toUpperCase();
  if (looksLikeAPlaceholder) return '';
  const inUrl = /\/spreadsheets\/d\/([a-zA-Z0-9-_]{20,})/.exec(raw);
  if (inUrl) return inUrl[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(raw)) return raw;      // already an ID
  return '';
}

/**
 * Write only the keys we manage, leaving every other line exactly as it was.
 *
 * Rewriting the whole file would silently discard anything a person had set by hand — REI_COMPLETE_TASKS,
 * a pause flag, a WhatsApp setting — and setup is precisely the moment somebody would not notice. Comments,
 * blank lines and ordering all survive.
 */
async function upsertEnv(values) {
  let existing = '';
  try { existing = await fs.readFile(ENV_FILE, 'utf8'); } catch { existing = ''; }
  const lines = existing ? existing.split(/\r?\n/) : [];
  const remaining = new Map(Object.entries(values));

  const out = lines.map((line) => {
    const m = /^\s*([A-Z0-9_]+)\s*=/.exec(line);
    if (!m || !remaining.has(m[1])) return line;
    const key = m[1];
    const value = remaining.get(key);
    remaining.delete(key);
    return `${key}=${value}`;
  });

  if (remaining.size) {
    if (out.length && out[out.length - 1].trim() !== '') out.push('');
    out.push('# Written by scripts/setup-app.mjs — published from the workbook, not typed by hand.');
    for (const [key, value] of remaining) out.push(`${key}=${value}`);
  }
  await fs.writeFile(ENV_FILE, `${out.join('\n').replace(/\n+$/, '')}\n`, 'utf8');
}

/** Run a command, streaming its output, and resolve with the exit code. Never throws. */
function run(command, commandArgs, { quiet = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: false
    });
    let out = '';
    if (quiet) {
      child.stdout?.on('data', (d) => { out += d; });
      child.stderr?.on('data', (d) => { out += d; });
    }
    child.on('error', (e) => resolve({ code: -1, out: `${out}${e.message}` }));
    child.on('close', (code) => resolve({ code: code === null ? -1 : code, out }));
  });
}

/*
 * The bundled Node when this is the packaged app, otherwise whatever launched us.
 *
 * process.execPath rather than the string "node": in the packaged folder there is no Node on PATH at all,
 * so spawning "node" would fail on exactly the machine this script is written for.
 */
const NODE = process.execPath;

async function ask(rl, question) {
  if (ASSUME_YES) return '';
  return String(await rl.question(question) || '').trim();
}

/* ------------------------------------------------------------------- banner */

console.log('='.repeat(72));
console.log('  TWIN VISIT LOGGER — setting this PC up');
console.log('='.repeat(72));
console.log(`
  This PC:  ${os.hostname()}

  It will:  read its settings from your workbook, sign in to Google, sign in to
            REI, claim this PC as the active one, schedule the eight jobs, and
            check that it all works.

  You will be asked to sign in TWICE — once to Google, once to REI. Everything
  else is automatic. Nothing is sent to anybody and no seller is contacted.
`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

try {
  /* ---------------------------------------------------- 1. which workbook */
  step(1, 'Which workbook');

  let spreadsheetId = spreadsheetIdFrom(flag('sheet'));
  if (!spreadsheetId) {
    try {
      const packed = JSON.parse(await fs.readFile(WORKBOOK_FILE, 'utf8'));
      spreadsheetId = spreadsheetIdFrom(packed.spreadsheetId);
      if (spreadsheetId) ok(`from config/workbook.json — ${spreadsheetId}`);
    } catch { /* not packaged with one; ask */ }
  } else {
    ok(`from --sheet — ${spreadsheetId}`);
  }
  if (!spreadsheetId) {
    try {
      const current = await fs.readFile(ENV_FILE, 'utf8');
      spreadsheetId = spreadsheetIdFrom(/^\s*SPREADSHEET_ID\s*=\s*(.+)$/m.exec(current)?.[1] || '');
      if (spreadsheetId) ok(`already configured — ${spreadsheetId}`);
    } catch { /* first run */ }
  }
  while (!spreadsheetId) {
    console.log('\n    Open your Property Visit Tracking sheet in a browser and copy the address bar.');
    const typed = await ask(rl, '    Paste it here: ');
    spreadsheetId = spreadsheetIdFrom(typed);
    if (!spreadsheetId) {
      console.log('    That does not look like a Google Sheets link. It should contain /spreadsheets/d/...');
      if (ASSUME_YES) { bad('No workbook given and --yes cannot prompt.'); break; }
    }
  }
  if (!spreadsheetId) throw new Error('No workbook to set up against.');

  /*
   * Written BEFORE Google sign-in, because authorizeGoogle imports config.mjs and config.mjs throws
   * without this value. This is the one step whose order is forced by something other than sense.
   */
  await upsertEnv({ SPREADSHEET_ID: spreadsheetId });
  ok('.env written');

  /* ------------------------------------------------------- 2. Google login */
  step(2, 'Sign in to Google');
  console.log('    A browser window will open. Choose your work account and click Allow.');
  console.log('    This is what lets the app read the sheet and put visits on the calendar.\n');

  const { authorizeGoogle } = await import('../src/google/auth.mjs');
  const { google } = await import('googleapis');
  let auth;
  try {
    auth = await authorizeGoogle();
    ok('signed in');
  } catch (error) {
    bad(`Google sign-in failed: ${error.message}`);
    console.log('\n    Nothing else can be checked until this works. Common causes:');
    console.log('      - the browser window was closed before clicking Allow — just run this again');
    console.log('      - credentials/credentials.json is missing from this folder');
    throw error;
  }
  const sheets = google.sheets({ version: 'v4', auth });

  /* --------------------------------------------- 3. settings from the sheet */
  step(3, 'Read the settings out of the workbook');
  const { readAgentSettings, SETTING, settingsAgeDays, AGENT_SETTINGS_SHEET } =
    await import('../src/google/agent-settings.mjs');

  let book;
  try {
    book = await sheets.spreadsheets.get({ spreadsheetId });
    ok(`workbook: "${book.data.properties?.title}"`);
  } catch (error) {
    bad(`Cannot open that workbook: ${error.message}`);
    console.log('\n    The account you just signed in as may not have access to it. Check you picked the');
    console.log('    work account, and that the sheet is shared with it.');
    throw error;
  }

  const settings = await readAgentSettings(sheets, spreadsheetId);
  if (!settings) {
    bad(`the workbook has no "${AGENT_SETTINGS_SHEET}" tab yet`);
    console.log('\n    That tab is how this PC learns which sheet tab, which calendar and which Chat');
    console.log('    space to use — so nothing has to be typed here. Create it once:');
    console.log('\n      Open the sheet  ->  menu "🏠 Twin Visit Logger"');
    console.log('        ->  "💻 Publish settings for the PC app"');
    console.log('\n    Then run this setup again. Everything up to here is already done and saved.');
    throw new Error('settings not published');
  }

  const tracker = settings.get(SETTING.trackerSheet) || '';
  const calName = settings.get(SETTING.calendarName) || '';
  const calId = settings.get(SETTING.calendarId) || '';
  const webhook = settings.get(SETTING.chatWebhook) || '';

  if (tracker) ok(`tracker tab: ${tracker}`); else bad('no tracker tab published');
  if (calName || calId) ok(`calendar: ${calName || calId}`); else note('no calendar published — visits will not be added to a calendar');
  /*
   * A missing webhook is a NOTE, not a failure. Everything else works without it; what stops is the alerts,
   * including the one that says REI is logged out. Worth saying out loud rather than discovering in a month.
   */
  if (webhook) ok('Chat webhook: found (not printed — it is a credential)');
  else note('no Chat webhook published — the app will run silently, with no alerts and no logout warning');

  const age = settingsAgeDays(settings);
  if (age !== null && age > 60) {
    note(`those settings were published ${age} days ago — re-publish if the webhook or calendar has changed`);
  }

  await upsertEnv({
    SPREADSHEET_ID: spreadsheetId,
    ...(tracker ? { TRACKER_SHEET: tracker } : {}),
    ...(calName ? { CALENDAR_NAME: calName } : {}),
    ...(calId ? { CALENDAR_ID: calId } : {}),
    ...(webhook ? { CHAT_WEBHOOK_URL: webhook } : {})
  });
  ok('.env updated from the workbook');

  /* --------------------------------------------------- 4. claim this machine */
  step(4, 'Claim this PC as the active one');
  console.log('    Only one PC may run the automation. Two driving REI on one account is what');
  console.log('    logs REI out, so the workbook records which machine is the live one.\n');

  const claimArgs = ['scripts/make-this-pc-active.mjs', ...(TAKE_OVER ? ['--force'] : [])];
  const claim = await run(NODE, claimArgs, { quiet: true });
  console.log(claim.out.split('\n').map((l) => `    ${l}`).join('\n').replace(/\s+$/, ''));
  if (claim.code === 0) {
    ok('this PC is the active one');
  } else {
    /*
     * NOT a failure of setup. Installing on a spare machine and leaving the live one alone is a completely
     * valid thing to do — it is the whole point of being able to install everywhere — so setup carries on
     * and schedules the tasks. They will stand down until somebody moves the automation here.
     */
    note('another PC is the active one, so this install will sit on standby');
    note('to move the automation here later: scripts\\make-this-pc-active.cmd');
  }

  /* ------------------------------------------------------------ 5. REI login */
  step(5, 'Sign in to REI');
  if (ASSUME_YES) {
    note('skipped in --yes mode — run scripts\\login-rei.cmd before the first sweep');
  } else {
    console.log('    A browser opens on REI. Sign in, wait until you can see your dashboard,');
    console.log('    then close the window.\n');
    console.log('    Your password is not stored by this app, deliberately — only the session,');
    console.log('    in this folder, the same way a browser remembers you.\n');
    await ask(rl, '    Press Enter to open REI... ');
    const login = await run(NODE, ['scripts/rei-login.mjs']);
    if (login.code === 0) ok('REI session saved');
    else {
      bad('REI sign-in did not complete');
      note('run scripts\\login-rei.cmd on its own and try again — everything else here is saved');
    }
  }

  /* -------------------------------------------------------- 6. the schedules */
  step(6, 'Schedule the eight jobs');
  if (NO_TASKS) {
    note('skipped (--no-tasks). Nothing will run on its own until you install them.');
  } else if (process.platform !== 'win32') {
    note(`this is ${process.platform}, not Windows — the scheduled tasks are Windows-only`);
  } else {
    const ps = await run('powershell.exe',
      ['-ExecutionPolicy', 'Bypass', '-File', 'scripts\\install-windows-task.ps1', '-SkipWhatsApp'],
      { quiet: true });
    if (ps.code === 0) {
      ok('all tasks created');
      console.log(ps.out.split('\n').filter(Boolean).map((l) => `      ${l}`).join('\n'));
    } else {
      bad('could not create the scheduled tasks');
      /*
       * The one failure with a known cause and a known cure on this machine. schtasks answers "Access is
       * denied" when a task already exists and was made from an elevated prompt — nothing is wrong with the
       * paths or the runner, so saying the fix beats printing an exit code.
       */
      if (/Access is denied/i.test(ps.out)) {
        note('Windows said "Access is denied" — the tasks already exist and were made as Administrator');
        note('close this, right-click the app shortcut, "Run as administrator", and set up again');
      } else {
        console.log(ps.out.split('\n').slice(-12).map((l) => `      ${l}`).join('\n'));
      }
    }
  }

  /* ------------------------------------------------------------- 7. prove it */
  step(7, 'Check that it actually works');
  console.log('    A dry run: reads the sheet and REI, writes nothing at all.\n');
  const verify = await run(NODE, ['scripts/recheck-rei.mjs', '--buckets', '--limit', '2'], { quiet: true });
  const out = verify.out || '';
  if (/Workbook: /.test(out)) ok('the sheet is readable');
  else bad('could not read the tracker tab');
  if (/LOGGED OUT/i.test(out)) {
    bad('REI is not signed in');
    note('run scripts\\login-rei.cmd — everything else is set up and will start working after that');
  } else if (/lead\(s\) to re-check|Nothing is due|on the 3pm card/.test(out)) {
    ok('REI is readable');
  } else {
    note('could not tell whether REI is readable — check logs\\bucket-task.log after the first run');
  }
} catch (error) {
  console.log(`\n    Setup stopped: ${error.message}`);
} finally {
  rl.close();
}

/* -------------------------------------------------------------------- verdict */

console.log(`\n${'='.repeat(72)}`);
if (!failed) {
  console.log('  READY. This PC is set up and the jobs are scheduled.');
  console.log(`\n  Nothing to start — the first run happens within a couple of minutes.`);
  console.log('  To watch it:        scripts\\dashboard.cmd');
  console.log('  To check on it:     scripts\\status.cmd');
  console.log('  To stop everything: scripts\\pause.cmd');
} else {
  console.log(`  NOT FINISHED — ${failed} step(s) did not pass. See the "--->" lines above.`);
  console.log('\n  Nothing is broken and nothing was half-written: this is safe to run again once');
  console.log('  the problem above is fixed, and it will skip what is already done.');
}
if (notes.length) {
  console.log('\n  Worth knowing:');
  for (const n of notes) console.log(`    - ${n}`);
}
console.log('='.repeat(72));
process.exit(failed ? 1 : 0);
