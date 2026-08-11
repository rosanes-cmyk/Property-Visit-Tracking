/**
 * The portable package — what goes in it, and much more importantly what does not.
 *
 *   node tests/portable-package.test.mjs
 *
 * The client asked for an app they could put on every PC: "can we make it into app? so it can just tranfer on
 * evry pc", after asking what happens if their machine is damaged.
 *
 * The risk in that request is not technical difficulty, it is DISCLOSURE. A folder that gets copied to a USB
 * stick, dropped in Drive and emailed around is the least controlled artefact this project produces — and the
 * working install it is built from contains a Google refresh token, a live REI browser session, the Chat
 * webhook, and 379 sellers' names, addresses and phone numbers. Package any of that and the folder itself
 * becomes a way into the accounts.
 *
 * Nothing here can run PowerShell, so these are checks on the script's text. That is a real limitation and
 * the tests are written to match it: they assert the SHAPE of the safety (an allow-list, an explicit refusal)
 * rather than pretending to have executed a build.
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

const SANDBOX = path.resolve('twin-visit-logger-sandbox');
const read = (p) => fs.readFileSync(path.join(SANDBOX, p), 'utf8');
const PS = read('scripts/make-portable.ps1');

console.log('=== what is packaged is an ALLOW-list ===');
/*
 * The single most important line in the script. A deny-list is one forgotten folder away from shipping the
 * REI session, and the failure is SILENT — the package works perfectly and is a credential. An allow-list
 * means a folder of seller data added next year is excluded by default rather than by somebody remembering.
 */
check('the copy is driven by a named list', /\$include = @\(/.test(PS), true);
for (const wanted of ['src', 'scripts', 'config', 'node_modules', 'package.json']) {
  check(`...which includes ${wanted}`, new RegExp(`"${wanted.replace('.', '\\.')}"`).test(PS), true);
}
check('...and the reason it is not a deny-list is written down',
  /An allow-list, not a deny-list/.test(PS), true);
/* None of these may appear as things to copy. */
for (const secret of ['\\.env', 'credentials', 'browser-data', 'debug']) {
  const inInclude = new RegExp(`\\$include = @\\([^)]*${secret}`, 's').test(PS);
  check(`the include list does not name ${secret.replace('\\\\', '')}`, inInclude, false);
}

console.log('\n--- and it refuses to finish if a secret got in another way ---');
/*
 * Belt and braces, because "I am fairly sure it is not in there" is not good enough for a folder that gets
 * emailed. A stray copy of .env inside config\, or a token somebody parked in scripts\, would pass the
 * allow-list by riding along inside an allowed folder.
 */
check('the built folder is scanned afterwards', /\$forbidden = @\(/.test(PS), true);
check('...for .env', /"\.env"/.test(PS), true);
check('...for the Google token', /"token\.json"/.test(PS), true);
check('...for the Google client secret', /"credentials\.json"/.test(PS), true);
check('...and for the REI browser session', /browser-data/.test(PS), true);
/*
 * It DELETES the half-built folder rather than leaving it with a warning. A warning in a console that then
 * closes is how somebody ends up shipping the folder anyway.
 */
check('a leak deletes the package rather than warning about it',
  /REFUSING TO CONTINUE[\s\S]{0,600}?Remove-Item -Recurse -Force \$dest/.test(PS), true);
check('...and says nothing was written', /Nothing was written/.test(PS), true);

console.log('\n=== self-contained: nothing to install, nothing to download ===');
check('node.exe is packaged', /Copy-Item -Force \$nodeExe/.test(PS), true);
/*
 * node.exe alone, not the whole Node install. npm is not needed because node_modules is packaged — which is
 * also what lets the package work on a machine with no internet at all.
 */
check('...without npm, because node_modules travels with it',
  /node\.exe alone, not the whole Node installation/.test(PS), true);
check('Chromium is packaged', /PLAYWRIGHT_BROWSERS_PATH/.test(PS), true);
check('...only Chromium, not firefox and webkit', /Chromium only/.test(PS), true);
/*
 * And only the build Playwright ACTUALLY USES. The ms-playwright folder accumulates a directory per version
 * forever: the first real build here shipped chromium-1228, chromium-1234 and both headless_shell siblings —
 * four copies of a browser, and why the package came out at 1.68 GB instead of about 800 MB.
 *
 * Which one is right cannot be guessed from the version numbers; it is whichever the PACKAGED node_modules
 * asks for. So Playwright is asked directly. Guessing "highest number" would eventually package a build the
 * bundled Playwright does not want, and that lands on a new PC as "Executable doesn't exist" during setup —
 * the worst possible place for it.
 */
check('...and only the build Playwright asks for',
  /p\.chromium\.executablePath\(\)/.test(PS), true);
check('...with its headless shell, so REI_HEADLESS=true still works',
  /chromium_headless_shell/.test(PS), true);
/* A bigger package still works; a missing browser does not. So the fallback is to over-include. */
check('...falling back to all builds rather than none',
  /packaging all Chromium builds/.test(PS), true);
check('...and a missing browser is explained rather than silently skipped',
  /Run 'npm run install-browser'/.test(PS), true);
check('a missing Node is explained too', /Node is not on PATH here/.test(PS), true);

console.log('\n=== the ONE value the package carries ===');
/*
 * The spreadsheet ID, and it is not a secret: it is in the URL of the sheet and grants nothing without
 * permission to open it. Everything else — tracker tab, calendar, Chat webhook — is read from the workbook
 * after the Google sign-in, which is what keeps the package itself credential-free.
 */
check('the workbook id is written into the package', /config\\workbook\.json/.test(PS), true);
check('...and it is stated to be not a secret', /it is not a secret/.test(PS), true);
check('...and a missing one is not fatal — setup asks',
  /setup will ask for the sheet link on the new PC/.test(PS), true);
check('the wizard reads that file', /config\/workbook\.json/.test(read('scripts/setup-app.mjs')), true);

console.log('\n=== EVERY launcher must use the bundled runtime ===');
/*
 * THE failure this section exists for, and it is the nastiest one in the whole packaging job.
 *
 * The packaged folder deliberately has no Node on PATH. A launcher calling bare `node` is not found — and
 * Task Scheduler still reports the task as HAVING RUN. So the install looks perfect, the dashboard shows
 * "Nothing yet", and every job silently does nothing. There is no error anywhere to find.
 */
const LAUNCHERS = ['run-once.cmd', 'recheck.cmd', 'recheck-buckets.cmd', 'fill-pending.cmd',
  'audit-notes.cmd', 'whatsapp-watch.cmd', 'login-rei.cmd', 'dashboard.cmd', 'make-this-pc-active.cmd'];
for (const file of LAUNCHERS) {
  const src = read(`scripts/${file}`);
  check(`${file} resolves the bundled Node`, /if exist "%~dp0\.\.\\runtime\\node\.exe"/.test(src), true);
  /* And must not call bare `node` anywhere — that is the line that would silently do nothing. */
  check(`${file} never calls bare node`, /^node\s/m.test(src), false);
}
/*
 * Only the launchers that OPEN A BROWSER need Chromium pointed at. Setting it everywhere would be harmless
 * but would hide which jobs actually drive a browser, and that distinction matters here: those are the ones
 * that contend for the REI profile and the run lock.
 */
for (const file of ['run-once.cmd', 'recheck.cmd', 'recheck-buckets.cmd', 'fill-pending.cmd', 'login-rei.cmd']) {
  const src = read(`scripts/${file}`);
  check(`${file} points at the bundled Chromium`, /PLAYWRIGHT_BROWSERS_PATH=/.test(src), true);
  check(`${file} never downloads a browser`, /PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1/.test(src), true);
}
/* The dashboard opens no browser, and a test elsewhere asserts that on purpose. */
check('the dashboard does not claim to need Chromium',
  /PLAYWRIGHT_BROWSERS_PATH/.test(read('scripts/dashboard.cmd')), false);

console.log('\n=== the read-me a person finds in the folder ===');
check('it names the one thing to double-click', /double-click  SET-UP-THIS-PC\.cmd/.test(PS), true);
check('...and warns that only one PC may run it', /ONLY ONE PC AT A TIME/.test(PS), true);
check('...and says how to move it when the old PC is broken',
  /Release the PC/.test(PS), true);
/*
 * And it says what is NOT in the folder. Somebody handed a USB stick needs to know whether it is sensitive,
 * and the honest answer here is a selling point rather than a caveat.
 */
check('...and states that no credentials are inside', /No passwords, no Google token, no REI session/.test(PS), true);
check('...and why that is deliberate', /not a way into your accounts/.test(PS), true);

console.log('\n--- Mark of the Web, the one that wastes a whole day ---');
/*
 * A folder extracted from a downloaded zip is blocked by Windows, and a blocked script run by Task Scheduler
 * fails SILENTLY. It has already cost one debugging session on this project. The zip path therefore says to
 * run setup first, and setup clears it as its first act.
 */
check('the zip step says to run setup first', /do not run anything else first/.test(PS), true);
check('...and setup is what clears the block', /Unblock-File/.test(read('SET-UP-THIS-PC.cmd')), true);

console.log('\n--- it will not quietly overwrite a previous build ---');
check('an existing folder needs -Force', /re-run with -Force/.test(PS), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
