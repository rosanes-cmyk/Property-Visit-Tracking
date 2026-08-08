/**
 * The re-check knows which leads are on the card, using the card's OWN rules.
 *
 *   node tests/rei-buckets.test.mjs
 *
 * The client: "we need to prioritise those 8 buckets in updating and checking… that is the main goal, time
 * to time check in the REI of those every hour, check all buckets, and continue checking the others."
 *
 * So the re-check has to answer "is this lead on the card right now?" — and the rules that decide that live
 * in Apps Script. Hand-translating them into Node would create a second definition that drifts, which is
 * precisely what produced "Upcoming Visit: 0" and "no visit date set" on a preview that was supposed to be
 * identical to the card. They are COPIED instead, and this suite is what makes the copy trustworthy.
 */
import { bucketOf, onTheCard, ATTENTION_BUCKETS } from '../twin-visit-logger-sandbox/src/rei/attention-rules.mjs';
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
const CHAT = read('apps-script/ChatNotify.gs');
const RULES = read('twin-visit-logger-sandbox/src/rei/attention-rules.mjs');

console.log('=== the copy is the same text as the card ===');
/*
 * The whole safety of this approach. If ChatNotify.gs is edited and the copy is not regenerated, this fails
 * here rather than a lead quietly falling off the hourly sweep — which nobody would notice, because the
 * symptom is a lead being checked less often, not an error.
 */
const source = CHAT.slice(CHAT.indexOf('var DIGEST_LINES_PER_SECTION'), CHAT.indexOf('/**\n * Post the 3pm work queue'));
check('the rules are carried verbatim', RULES.includes(source.trim()), true);
check('it is marked as a copy', /VERBATIM FROM apps-script\/ChatNotify\.gs/.test(RULES), true);
check('...and says how to regenerate it', /sync-attention-rules/.test(RULES), true);
/* It must never write, post or fetch. It answers one question about a row. */
for (const forbidden of ['UrlFetchApp', 'values.update', 'values.append', 'chatPost_', 'fetch(']) {
  check(`it never calls ${forbidden}`, RULES.includes(forbidden), false);
}

console.log('\n=== which bucket a lead is in ===');
const TODAY = new Date(2026, 7, 7);
const at = (row) => bucketOf(row, TODAY);
const BASE = { 'Property Address': '2145 Capitol Ave, East Palo Alto' };

check('a visit next week is Upcoming Visit',
  at({ ...BASE, 'Current Stage': 'Visit Scheduled', 'Visit Status': 'Scheduled', 'Visit Date': '2026-08-12' }),
  'upcomingVisit');
check("today's visit too",
  at({ ...BASE, 'Current Stage': 'Visit Scheduled', 'Visit Status': 'Scheduled', 'Visit Date': '2026-08-07' }),
  'upcomingVisit');
/* Jose: the visit date has passed and the row still says Scheduled. */
check('an overdue visit is Follow Up',
  at({ ...BASE, 'Current Stage': 'Visit Scheduled', 'Visit Status': 'Scheduled', 'Visit Date': '2026-08-01' }),
  'pendingFollowUp');
check('...and so is one with no date at all',
  at({ ...BASE, 'Current Stage': 'Visit Scheduled', 'Visit Status': 'Scheduled' }), 'pendingFollowUp');
/* Jose after the appointment-gone rule fired. */
check('Reschedule Needed is Follow Up',
  at({ ...BASE, 'Current Stage': 'Visit Scheduled', 'Visit Status': 'Reschedule Needed', 'Visit Date': '2026-08-01' }),
  'pendingFollowUp');
check('Canceled is Cancelled — Close Out or Rebook',
  at({ ...BASE, 'Current Stage': 'Visit Scheduled', 'Visit Status': 'Canceled', 'Visit Date': '2026-08-12' }),
  'needsRebooking');
check('Offer Sent', at({ ...BASE, 'Current Stage': 'Offer Sent' }), 'offerSent');
check('Offer Preparation is Pending Offer', at({ ...BASE, 'Current Stage': 'Offer Preparation' }), 'offerPending');
check('Active Negotiation is Still Negotiating',
  at({ ...BASE, 'Current Stage': 'Active Negotiation' }), 'negotiating');
/* A gift is additive — it puts a lead on the card whatever its stage. */
check('a gift awaiting approval, on a signed contract',
  at({ ...BASE, 'Current Stage': 'Contract Signed', 'Gift Status': 'Recommended' }), 'giftFollowUp');

console.log('\n--- and who is NOT on the card ---');
check('a parked lead', at({ ...BASE, 'Current Stage': 'Long-Term Nurture' }), '');
check('a closed lead', at({ ...BASE, 'Current Stage': 'Lost / Closed Out' }), '');
/*
 * An imported row is excluded by the same DIGEST_INCLUDE_IMPORTED rule the card uses. This matters for the
 * sweep: 373 of the 378 rows came in from the client's own workbook, and hourly-checking all of them would
 * be a different feature entirely from "keep the card fresh".
 */
check('an imported row', at({ ...BASE, 'Current Stage': 'Offer Sent', Source: 'Import' }), '');
check('a test row', at({ ...BASE, 'Current Stage': 'Offer Sent', Source: 'TEST' }), '');
check('a row with no address', at({ 'Current Stage': 'Offer Sent' }), '');
check('an empty row', at({}), '');

console.log('\n--- onTheCard is just "any bucket at all" ---');
check('true for a bucket',
  onTheCard({ ...BASE, 'Current Stage': 'Offer Sent' }, TODAY), true);
check('false for none', onTheCard({ ...BASE, 'Current Stage': 'Long-Term Nurture' }, TODAY), false);
/* Every key it can return has to be a real section, or the sweep would chase a bucket nobody sees. */
const keys = ATTENTION_BUCKETS.map((b) => b.key);
for (const row of [
  { ...BASE, 'Current Stage': 'Visit Scheduled', 'Visit Status': 'Scheduled', 'Visit Date': '2026-08-12' },
  { ...BASE, 'Current Stage': 'Visit Scheduled', 'Visit Status': 'Canceled' },
  { ...BASE, 'Current Stage': 'Offer Preparation' },
  { ...BASE, 'Current Stage': 'Contract Signed', 'Gift Status': 'Recommended' }
]) {
  check(`"${at(row)}" is a real section`, keys.includes(at(row)), true);
}

console.log('\n=== the re-check uses it ===');
const RUNNER = read('twin-visit-logger-sandbox/scripts/recheck-rei.mjs');
check('--buckets is a flag', /--buckets/.test(RUNNER), true);
/*
 * MIDNIGHT, not the current time. The card compares a visit's date against today's midnight; passing
 * `new Date()` made a visit booked for 10:30 this morning read as overdue at 10:35, so the sweep reported
 * "upcomingVisit: 0, pendingFollowUp: 5" for the leads the card was showing as Upcoming Visit (3). Same
 * leads either way, but a count that contradicts the card reads as the two disagreeing about the work.
 */
check('...and it asks at MIDNIGHT, as the card does',
  /new Date\(n\.getFullYear\(\), n\.getMonth\(\), n\.getDate\(\)\)[\s\S]{0,80}onTheCard/.test(RUNNER), true);
/* The proof, rather than the shape: a visit later today is upcoming, not overdue. */
const later = new Date();
later.setHours(23, 0, 0, 0);
const todayIso = `${later.getFullYear()}-${String(later.getMonth() + 1).padStart(2, '0')}-${String(later.getDate()).padStart(2, '0')}`;
const midnight = new Date(later.getFullYear(), later.getMonth(), later.getDate());
check("a visit later TODAY is Upcoming, not overdue",
  bucketOf({ 'Property Address': 'x', 'Current Stage': 'Visit Scheduled', 'Visit Status': 'Scheduled',
    'Visit Date': todayIso }, midnight), 'upcomingVisit');
check('...and it filters on onTheCard', /onTheCard\(/.test(RUNNER), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
