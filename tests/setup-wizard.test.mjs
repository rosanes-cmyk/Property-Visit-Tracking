/**
 * First-run setup — the "install it and everything works" wizard.
 *
 *   node tests/setup-wizard.test.mjs
 *
 * The client: "once i installed the application in one pc all must go on like automatic once intall the app."
 *
 * Most of what could go wrong here is ORDER, and order is invisible when you read the file top to bottom
 * and looks fine. Two constraints in particular are load-bearing and neither is obvious:
 *
 *   - config.mjs validates on import and throws without SPREADSHEET_ID. So the wizard cannot import it, or
 *     anything that imports it, until it has written that value — which is the whole reason it exists. A
 *     static import at the top would make setup unrunnable before setup had been done.
 *   - .env must be written before Google sign-in, because authorizeGoogle pulls config in.
 *
 * Both are asserted here, because both would present as "setup crashes on a fresh PC" — the one machine
 * nobody can test on until it is too late.
 */
import fs from 'node:fs';
import path from 'node:path';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');
const SETUP = read('twin-visit-logger-sandbox/scripts/setup-app.mjs');
const CMD = read('twin-visit-logger-sandbox/SET-UP-THIS-PC.cmd');

console.log('=== the import order that makes it runnable at all ===');
/*
 * The failure this prevents: `import { config } from '../src/config.mjs'` at the top of the file. It reads
 * perfectly, it passes node --check, and it throws "SPREADSHEET_ID is required" on every fresh machine —
 * before printing a single line, so there is nothing on screen to diagnose from.
 */
check('config.mjs is NOT imported statically',
  /^import .*from '\.\.\/src\/config\.mjs'/m.test(SETUP), false);
check('...nor is anything that imports it', /^import .*google\/auth\.mjs'/m.test(SETUP), false);
check('the Google client is imported dynamically instead',
  /await import\('\.\.\/src\/google\/auth\.mjs'\)/.test(SETUP), true);
check('...and so are the settings helpers',
  /await import\('\.\.\/src\/google\/agent-settings\.mjs'\)/.test(SETUP), true);
/*
 * And the .env write has to come BEFORE that dynamic import, not merely before it is used. This is the one
 * step whose position is forced by something other than sense, so it is asserted rather than trusted.
 */
check('.env is written before Google sign-in',
  SETUP.indexOf('await upsertEnv({ SPREADSHEET_ID: spreadsheetId })')
    < SETUP.indexOf("await import('../src/google/auth.mjs')"), true);

console.log('\n=== pasting a link, because nobody can find a spreadsheet ID ===');
/*
 * Asking a non-developer for "the spreadsheet ID" means asking them to pick a 44-character string out of the
 * middle of a URL. Getting it wrong produces a permissions error that looks nothing like the mistake made.
 * Pasting the address bar is the thing a person can actually do.
 */
const idFrom = (input) => {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const inUrl = /\/spreadsheets\/d\/([a-zA-Z0-9-_]{20,})/.exec(raw);
  if (inUrl) return inUrl[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(raw)) return raw;
  return '';
};
const ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
check('a full edit URL works',
  idFrom(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`), ID);
check('...with a sharing suffix', idFrom(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`), ID);
check('...on a Workspace domain path',
  idFrom(`https://docs.google.com/a/twinhomebuyer.com/spreadsheets/d/${ID}/edit`), ID);
check('a bare ID still works', idFrom(ID), ID);
check('whitespace is trimmed', idFrom(`  ${ID}  `), ID);
/* And the things that must NOT be accepted, because each produces a confusing failure much later. */
check('a Drive folder link is refused',
  idFrom('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345'), '');
check('an empty paste is refused', idFrom(''), '');
check('a short scrap is refused', idFrom('sheet1'), '');
check('the wizard uses this shape of parser', /\\\/spreadsheets\\\/d\\\/\(\[a-zA-Z0-9-_\]\{20,\}\)/.test(SETUP), true);

console.log('\n=== .env is edited, never rewritten ===');
/*
 * Rewriting the file would silently discard anything set by hand — REI_COMPLETE_TASKS, a pause flag, a
 * WhatsApp setting — and setup is exactly the moment nobody would notice. This is why upsertEnv maps over
 * existing lines instead of building a fresh file.
 */
check('existing lines are preserved', /const out = lines\.map\(\(line\) => \{/.test(SETUP), true);
check('...and only managed keys are replaced', /if \(!m \|\| !remaining\.has\(m\[1\]\)\) return line;/.test(SETUP), true);
check('new keys are appended, not prepended', /out\.push\(`\$\{key\}=\$\{value\}`\)/.test(SETUP), true);
check('the appended block says where it came from',
  /Written by scripts\/setup-app\.mjs/.test(SETUP), true);

console.log('\n=== the two logins it cannot do for you ===');
check('Google sign-in is a step', /Sign in to Google/.test(SETUP), true);
check('REI sign-in is a step', /Sign in to REI/.test(SETUP), true);
/*
 * The REI password is a REFUSAL, not a missing feature, and the reason belongs on screen where the person
 * wondering why they have to type it will read it. The project's rules have said so from the start:
 * "Never store a REI password in source code or .env."
 */
check('...and it says the password is deliberately not stored',
  /password is not stored by this app, deliberately/.test(SETUP), true);
check('the file explains why storing it would be worse',
  /copied to every PC and onto whatever stick carries the installer/.test(SETUP), true);

console.log('\n=== the first Google sign-in must use the same client as every later one ===');
/*
 * FOUND DURING A LIVE RECOVERY on a replacement PC, and it cost an hour.
 *
 * Google sign-in reported success, and the very next call — reading the workbook — failed with:
 *
 *   Method doesn't allow unregistered callers (callers without established identity).
 *
 * Which reads exactly like a permissions problem, and is not one. `@google-cloud/local-auth` depends on
 * `google-auth-library` separately from `googleapis`; when npm resolves them to different versions, each gets
 * its own copy of the class, and `google.sheets({ auth })` does not recognise local-auth's client as an auth
 * client at all. So it makes the request UNAUTHENTICATED.
 *
 * It had never happened before because every dependency in this project is pinned to "latest": the old PC's
 * node_modules was installed months earlier with a combination that happened to dedupe. A fresh install got
 * that day's versions and behaved differently — which is the worst kind of bug, one that appears only on a
 * machine being set up in a hurry because the previous one died.
 *
 * The fix routes the first run through loadSavedCredentials, the same path every later run uses, which builds
 * the client with googleapis' OWN google.auth.fromJSON. Asserted here because the line looks redundant and is
 * exactly the sort of thing somebody tidies away.
 */
{
  const AUTH = read('twin-visit-logger-sandbox/src/google/auth.mjs');
  check('the saved token is reloaded rather than local-auth\'s client returned',
    /const rebuilt = await loadSavedCredentials\(\);\s*\n\s*return rebuilt \|\| client;/.test(AUTH), true);
  /* Matched across the comment's line wrap — a fixed phrase breaks the moment a sentence is re-flowed. */
  check('...and the reason is written down so it is not tidied away',
    /does not recognise local-auth's/.test(AUTH), true);
  /* Order matters: the token has to be on disk before it can be reloaded. */
  check('...after the token is saved',
    AUTH.indexOf('await saveCredentials(client)') < AUTH.indexOf('const rebuilt ='), true);
  /*
   * And it falls back to the original client rather than returning null. If the token could not be re-read for
   * any reason, a working-but-fragile client beats no client at all — the run should degrade, not die.
   */
  check('...falling back rather than returning nothing', /return rebuilt \|\| client;/.test(AUTH), true);
}

console.log('\n=== every step can fail without wrecking the install ===');
/*
 * A wizard that half-completes and cannot be re-run is worse than one that fails cleanly. Each step writes
 * its result as it goes, so a second run skips what is done — and the verdict says so, because otherwise
 * somebody who hit an error will assume they have to start from scratch or, worse, uninstall something.
 */
check('the verdict says a failed run is safe to repeat',
  /safe to run again once/.test(SETUP), true);
check('...and that nothing was half-written', /nothing was half-written/.test(SETUP), true);
check('the launcher says the same thing', /Nothing is half-written/.test(CMD), true);

console.log('\n--- a spare PC is a valid outcome, not a failure ---');
/*
 * Installing on a standby machine and leaving the live one alone is the entire point of being able to
 * install everywhere. If a taken claim counted as a failed step, every second install would end in red and
 * somebody would "fix" it by forcing a takeover — causing the REI logout the claim exists to prevent.
 */
check('a claim held by another PC is a note, not a failure',
  /note\('another PC is the active one, so this install will sit on standby'\)/.test(SETUP), true);
check('...and it says how to move the automation later',
  /make-this-pc-active\.cmd/.test(SETUP), true);

console.log('\n--- a missing settings tab is explained, not just reported ---');
check('it names the menu item to click', /Publish settings for the PC app/.test(SETUP), true);
check('...and says the work so far is saved', /Everything up to here is already done and saved/.test(SETUP), true);

console.log('\n--- a missing webhook is a note, because everything else still works ---');
/*
 * Without a webhook the automation runs perfectly and says nothing — including saying nothing when REI logs
 * out. Treating it as a hard failure would block an otherwise good install; treating it as silence nobody
 * mentions is how you discover it in a month.
 */
check('no webhook is called out', /run silently, with no alerts and no logout warning/.test(SETUP), true);
check('the webhook is never printed to screen',
  /not printed — it is a credential/.test(SETUP), true);

console.log('\n=== the Windows failure with a known cure ===');
/*
 * schtasks answers "Access is denied" when the task already exists and was created from an elevated prompt.
 * Nothing is wrong with the paths or the runner. It cost a debugging session once, so the wizard says the
 * fix rather than printing an exit code.
 */
check('"Access is denied" is translated into what to do',
  /Access is denied.*already exist and were made as Administrator/s.test(SETUP), true);
check('...naming Run as administrator', /Run as administrator/.test(SETUP), true);

console.log('\n=== the launcher a person actually double-clicks ===');
check('it sits in the folder root, not scripts\\',
  fs.existsSync('twin-visit-logger-sandbox/SET-UP-THIS-PC.cmd'), true);
check('...and says why it is there', /this is the file a person is looking\r?\nrem for/.test(CMD), true);
/*
 * Mark of the Web is the one that would waste a whole day: a script extracted from a downloaded zip is
 * blocked, and a blocked script run by Task Scheduler fails SILENTLY — the task reports success and does
 * nothing at all. It already cost one debugging session on this project.
 */
check('it clears Mark of the Web', /Unblock-File/.test(CMD), true);
check('...and says why that matters', /fails\r?\nrem silently when Windows runs it on a schedule/.test(CMD), true);
/* The packaged folder has no Node on PATH, so "node" would fail on exactly the machine this is written for. */
check('it prefers the bundled Node', /if exist "%~dp0runtime\\node\.exe"/.test(CMD), true);
check('...and the bundled Chromium', /PLAYWRIGHT_BROWSERS_PATH/.test(CMD), true);
check('...and never downloads a browser', /PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1/.test(CMD), true);
check('the wizard spawns the SAME Node it is running under',
  /const NODE = process\.execPath;/.test(SETUP), true);
check('...and says why that is not the string "node"',
  /there is no Node on PATH at all/.test(SETUP), true);

console.log('\n--- a source checkout is told apart from the packaged app ---');
check('a missing node_modules is explained rather than crashing',
  /This folder has no node_modules/.test(CMD), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
