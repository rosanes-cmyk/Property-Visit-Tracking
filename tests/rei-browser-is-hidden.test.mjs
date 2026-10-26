/**
 * A scheduled REI run never opens a window on somebody's desk.
 *
 *   node tests/rei-browser-is-hidden.test.mjs
 *
 * WHY THIS EXISTS. REI_HEADLESS defaulted to false, so a fresh install drove a visible Chromium around
 * REI in front of whoever was at the desk. The client asked for it hidden on the first server — "xan we
 * hide this crawler?" — set the flag by hand, and then had to ask again on the SECOND server, because
 * setup-app rebuilds .env from the workbook and this is not one of the settings it carries across.
 *
 * A preference somebody has to remember on every machine is a default in the wrong place. So the default
 * is now hidden, and this guards the two halves of that: the default itself, and the rule that no
 * scheduled job may override it. A single `{ headless: false }` added to a runner would put the window
 * back on every PC with nothing to reveal it but somebody noticing a browser open itself.
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
const read = (p) => fs.readFileSync(path.resolve('twin-visit-logger-sandbox', p), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('=== hidden is the default ===');
/*
 * Comment-stripped: the comment above this line in config.mjs names the old `false` on purpose, and this
 * project has had six assertions satisfied by the prose explaining a fix rather than the fix.
 */
const CONFIG = strip(read('src/config.mjs'));
check('REI_HEADLESS defaults to true',
  /reiHeadless: bool\(process\.env\.REI_HEADLESS, true\)/.test(CONFIG), true);
check('...and is still overridable, so a person can watch a run',
  /process\.env\.REI_HEADLESS/.test(CONFIG), true);

console.log('\n=== no scheduled job forces a window ===');
/*
 * These are the ones Windows Task Scheduler fires. Every one must call launchReiContext bare, so the
 * config decides. A hand-run diagnostic passing { headless: false } is correct — a person is watching
 * that on purpose — but a timer has nobody watching and a window it opens cannot be closed by anyone.
 */
const SCHEDULED = [
  'src/run-once.mjs',
  'scripts/recheck-rei.mjs',
  'scripts/fill-pending-rei.mjs',
  'scripts/audit-notes.mjs',
  'scripts/sweep-parked.mjs',
  'scripts/send-briefing.mjs',
];
for (const f of SCHEDULED) {
  const src = strip(read(f));
  check(`${f} does not force a visible browser`, /headless\s*:\s*false/.test(src), false);
}

console.log('\n=== the diagnostics that SHOULD show a window still do ===');
/*
 * The other half of the rule. If these ever went headless, somebody debugging a selector would be staring
 * at a blank console wondering why nothing happened — which is how pagedoctor and inspect-rei earn their
 * keep in the first place.
 */
const WATCHED = ['scripts/inspect-rei.mjs', 'scripts/pagedoctor.mjs', 'scripts/rei-login.mjs',
                 'scripts/rei-fields.mjs', 'scripts/test-scrape.mjs', 'scripts/rei-task-doctor.mjs'];
for (const f of WATCHED) {
  check(`${f} still opens a window for the person running it`,
    /launchReiContext\(\{ headless: false \}\)/.test(strip(read(f))), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
