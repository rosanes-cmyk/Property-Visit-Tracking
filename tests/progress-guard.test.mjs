/**
 * Progress-guard tests.
 *
 *   node tests/progress-guard.test.mjs
 *
 * The scraper re-syncs a booking on every matching email. This proves it cannot walk a human's
 * progress backwards: once someone has advanced a record past initial scheduling, automation must not
 * rewrite Visit Status / Current Stage — except for a cancellation, which is new information.
 *
 * The stage list and the decision are read from src/google/sheets.mjs at test time, so the test
 * cannot drift from shipped code.
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(path.resolve('twin-visit-logger-sandbox/src/google/sheets.mjs'), 'utf8');

// Pull HUMAN_ADVANCED_STAGES out of the real source.
const s = SRC.indexOf('const HUMAN_ADVANCED_STAGES = new Set([');
const e = SRC.indexOf(']);', s) + 3;
if (s < 0 || e <= s) throw new Error('HUMAN_ADVANCED_STAGES not found in sheets.mjs');
const HUMAN_ADVANCED_STAGES = new Function(`${SRC.slice(s, e)}\nreturn HUMAN_ADVANCED_STAGES;`)();

const normalize = (v) => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Mirrors the decision in upsertVisit's update branch. */
function protectedFields(existingStage, existingStatus, incomingTaskStatus) {
  const cancelling = normalize(incomingTaskStatus).includes('cancel');
  const progressed = HUMAN_ADVANCED_STAGES.has(existingStage) || existingStatus === 'Completed';
  return progressed && !cancelling ? ['Visit Status', 'Current Stage'] : [];
}

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)} but got ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}
const PROTECTED = ['Visit Status', 'Current Stage'];
const OPEN = [];

console.log('=== A reschedule must NOT undo human progress ===');
check('visit already Completed -> protected',
  protectedFields('Visit Completed — Needs Review', 'Completed', ''), PROTECTED);
check('Offer Sent -> protected', protectedFields('Offer Sent', 'Completed', ''), PROTECTED);
check('Active Negotiation -> protected', protectedFields('Active Negotiation', 'Completed', ''), PROTECTED);
check('Contract Signed -> protected', protectedFields('Contract Signed', 'Completed', ''), PROTECTED);
check('Long-Term Nurture -> protected', protectedFields('Long-Term Nurture', '', ''), PROTECTED);
check('Lost / Closed Out -> protected', protectedFields('Lost / Closed Out', '', ''), PROTECTED);
check('Visit Status=Completed even on an early stage -> protected',
  protectedFields('Visit Scheduled', 'Completed', ''), PROTECTED);

console.log('\n=== A still-scheduled record stays updatable ===');
check('Visit Scheduled / Scheduled -> open', protectedFields('Visit Scheduled', 'Scheduled', ''), OPEN);
check('brand-new blank row -> open', protectedFields('', '', ''), OPEN);

console.log('\n=== Cancellation always gets through ===');
check('cancel on a completed visit -> open', protectedFields('Visit Completed — Needs Review', 'Completed', 'Cancelled'), OPEN);
check('cancel on a signed contract -> open', protectedFields('Contract Signed', 'Completed', 'cancelled appointment'), OPEN);
check('cancel on a scheduled visit -> open', protectedFields('Visit Scheduled', 'Scheduled', 'Cancelled'), OPEN);

console.log('\n=== Em-dash integrity (the stage name contains U+2014) ===');
check('exact em-dash stage is recognised',
  [HUMAN_ADVANCED_STAGES.has('Visit Completed — Needs Review')], [true]);
check('a plain hyphen is NOT silently treated as advanced (would be a data-entry bug, not progress)',
  [HUMAN_ADVANCED_STAGES.has('Visit Completed - Needs Review')], [false]);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
