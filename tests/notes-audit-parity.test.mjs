/**
 * The notes audit exists twice. This is what stops the two copies disagreeing.
 *
 *   node tests/notes-audit-parity.test.mjs
 *
 * The client: "the should be start like the auto checker in calendar something."
 *
 * He is right, and the distinction matters. The 3pm digest and the calendar sync run on GOOGLE'S servers,
 * so they work whether his laptop is on, asleep or shut down. The REI re-check cannot join them — it needs
 * a real browser to log into REI, which Apps Script cannot drive. But the notes audit never touches REI: it
 * reads the sheet and writes the sheet. So it now runs in Apps Script, hourly, unattended and forever.
 *
 * Which means the phrase rules live in two places — src/rei/cancel-signal.mjs and apps-script/NotesAudit.gs
 * — and two copies of a regex is how a lead gets cancelled by one and ignored by the other. This suite runs
 * BOTH against the same inputs and fails if they ever disagree, the same way address-normalization.test.mjs
 * pins the three copies of the address key.
 */
import { visitOutcomeFromNotes } from '../twin-visit-logger-sandbox/src/rei/cancel-signal.mjs';
import fs from 'node:fs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

/* Lift the SHIPPED Apps Script function, so this cannot pass against a copy that is not deployed. */
const GS = fs.readFileSync(new URL('../apps-script/NotesAudit.gs', import.meta.url), 'utf8');
const from = GS.indexOf('var NA_THING');
const to = GS.indexOf('/**\n * Scan every row');
if (from < 0 || to < 0) throw new Error('could not locate the outcome rules in NotesAudit.gs');
const gsOutcome = new Function(`${GS.slice(from, to)}\nreturn visitOutcomeFromNotes_;`)();

/*
 * Every wording that has mattered on this project, verbatim where it came from real data. Both
 * implementations must agree on all of them.
 */
const CASES = [
  // The two the audit actually found on the client's live sheet.
  'Cancelled the property visit - spoke to her first asbout the price range | Cherry to call her back',
  'and 7/25/2025 Appointment booked Apr 2,2026 12PM 4/2/2026 - Appointment canceled due to lead needs to work a double shift. Pending reschedule',
  // From Jon Box's REI contact page — the one word that hid a cancellation for five days.
  'Notes Equity Percentage: 22% |cancelled booked appointment',
  'Lead is no show, continue to engage with him',
  // A visit that already moved is LIVE and must not be cancelled by either copy.
  'Appointment cancelled, rescheduled to Aug 12 at 2pm',
  'visit cancelled and rebooked for next Tuesday',
  'appointment pushed to the 14th',
  // Reschedule intent.
  'cancelled the visit, seller wants to rebook next week',
  'appointment canceled - pending reschedule',
  'visit cancelled, needs to be rescheduled',
  // Completions.
  'Visit completed, seller wants 495k',
  'visit went well, preparing offer',
  'Completed the walkthrough this morning',
  'Nobody was home when Juan arrived',
  "didn't show up",
  // The four false positives caught before any of this shipped — all would have killed a LIVE visit.
  'no show risk — she has cancelled on two other buyers',
  'cancelled visit is a possibility if the tenant refuses access',
  'possible no show, Juan will call ahead',
  'worried about a cancelled walkthrough',
  // The boilerplate on EVERY scheduled lead. A loose rule here cancels the entire pipeline.
  'Conduct scheduled visit & log outcome',
  'Scheduled-visit reminder — conduct visit & log outcome',
  'Auto-logged from REI task email - source: PropertyLeads (PPL) - REI stage: 3 Appointment Booked',
  // Things that are not about a visit at all.
  'cancelled the mailer campaign for this zip',
  'cancelled the contract, buyer walked',
  'visited the area last week to check comps',
  'she may cancel the visit if we cannot do 495',
  'met her at the office to sign paperwork',
  ''
];

console.log(`=== Both copies agree, on ${CASES.length} real wordings ===`);
for (const note of CASES) {
  const mjs = visitOutcomeFromNotes(note);
  const gs = gsOutcome(note);
  check(`"${note.slice(0, 54) || '(empty)'}"`, { status: gs.status, kind: gs.kind },
    { status: mjs.status, kind: mjs.kind });
}

console.log('\n=== The Apps Script copy is wired to run in the cloud ===');
const COMBINED = fs.readFileSync(new URL('../apps-script/Code.combined.gs', import.meta.url), 'utf8');
check('the audit is mirrored into the file people paste', /function auditVisitNotes\(/.test(COMBINED), true);
check('...and so is the outcome reader', /function visitOutcomeFromNotes_\(/.test(COMBINED), true);
/*
 * It has to be in installTriggers, not only behind its own menu item. "Install automation triggers" is what
 * the deployment doc tells somebody to run, and a job nobody remembers to switch on separately is a job
 * that does not run.
 */
check('it is part of the standard trigger set',
  /ScriptApp\.newTrigger\('auditVisitNotesSilent'\)\.timeBased\(\)\.everyHours\(1\)/.test(COMBINED), true);
check('it can be turned on alone', /function installNotesAuditTrigger\(/.test(COMBINED), true);
check('...and off again', /function removeNotesAuditTrigger\(/.test(COMBINED), true);
check('the menu offers all three', ['auditVisitNotesNow', 'installNotesAuditTrigger', 'removeNotesAuditTrigger']
  .every((f) => COMBINED.includes(`'${f}'`)), true);
// The scheduled handler must not raise a toast: a time trigger has no user interface to raise it in.
check('the scheduled run is silent', /function auditVisitNotesSilent\(\) \{ auditVisitNotes\(true\); \}/.test(COMBINED), true);

console.log('\n=== And it keeps the same refusals as the Node copy ===');
check('a status a person set is never overwritten',
  /if \(current && current !== 'Scheduled'\) \{/.test(COMBINED), true);
check('...it is logged as an exception instead',
  /the automation does not overrule a status somebody set/.test(COMBINED), true);
check('every change records the sentence it acted on', /because: "' \+/.test(COMBINED), true);
check('the completion stage move is limited to Visit Scheduled',
  /ch\.stage === 'Visit Scheduled'/.test(COMBINED), true);
check('it writes Visit Status, not Visit Notes', /idx\['Visit Notes'\] \+ 1/.test(COMBINED), false);

console.log('\n--- no duplicate definitions in the pasted file ---');
/*
 * Apps Script has ONE global scope: two functions with the same name silently resolve to whichever loaded
 * last. That already happened once on this project, with money_, and cost a debugging session.
 */
const fnNames = [...COMBINED.matchAll(/^function ([A-Za-z0-9_]+)\s*\(/gm)].map((m) => m[1]);
check('no duplicate function names', fnNames.filter((n, i) => fnNames.indexOf(n) !== i), []);
const varNames = [...COMBINED.matchAll(/^var ([A-Z][A-Z0-9_]+)\s*=/gm)].map((m) => m[1]);
check('no duplicate top-level constants', varNames.filter((n, i) => varNames.indexOf(n) !== i), []);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
