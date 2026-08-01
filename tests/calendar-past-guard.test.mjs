/**
 * Calendar past-date guard.
 *
 *   node tests/calendar-past-guard.test.mjs
 *
 * Rule: a visit that already happened must never land on Juan's calendar. The 379 imported legacy
 * records carry visit dates back to 2023, and burying the upcoming visits under years of history
 * would make the calendar useless.
 *
 * maybeCreateVisitEvent_ is the single choke point every caller goes through — the import, the
 * dashboard quick-actions, "Fix mismatched stages", and the REI intake — so the guard lives there
 * and this test asserts it is there, in both the module and the deployed combined file, and that
 * the comparison itself is right.
 */
import fs from 'node:fs';
import path from 'node:path';

const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

console.log('=== The guard is present in both shipped files ===');
for (const file of ['apps-script/WebApp.gs', 'apps-script/Code.combined.gs']) {
  const source = read(file);
  const from = source.indexOf('function maybeCreateVisitEvent_');
  const body = source.slice(from, source.indexOf('\n}', from));
  check(`${file}: maybeCreateVisitEvent_ exists`, from >= 0, true);
  check(`${file}: refuses a past visit date`, /start < midnight/.test(body), true);
  check(`${file}: the guard runs BEFORE createEvent`,
    body.indexOf('start < midnight') < body.indexOf('createEvent'), true);
  check(`${file}: guard appears exactly once`, (body.match(/start < midnight/g) || []).length, 1);
}

/* The comparison itself, extracted so the date arithmetic is actually exercised. */
function wouldCreate(visitDate, now) {
  const start = new Date(visitDate); start.setHours(9, 0, 0, 0);
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  return !(start < midnight);
}

const NOW = new Date('2026-08-01T14:30:00');

console.log('\n=== Past visits are refused ===');
check('a 2023 legacy visit', wouldCreate(new Date('2023-11-15'), NOW), false);
check('last month', wouldCreate(new Date('2026-07-01'), NOW), false);
check('yesterday', wouldCreate(new Date('2026-07-31'), NOW), false);

console.log('\n=== Today and future visits still get an event ===');
check('today, even though it is already 2:30pm', wouldCreate(new Date('2026-08-01'), NOW), true);
check('tomorrow', wouldCreate(new Date('2026-08-02'), NOW), true);
check('next month', wouldCreate(new Date('2026-09-15'), NOW), true);

console.log('\n=== A rescheduled legacy lead is not permanently blocked ===');
// An imported 2024 record moved to a future date must be allowed onto the calendar — the rule is
// about the visit date, not about where the record came from.
check('imported record rebooked for next week', wouldCreate(new Date('2026-08-08'), NOW), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
