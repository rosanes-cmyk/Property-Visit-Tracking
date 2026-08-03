/**
 * WhatsApp group-planning tests.
 *
 *   node tests/whatsapp-plan.test.mjs
 *
 * This layer decides who gets added to a group chat that includes a seller. WhatsApp Web's DOM
 * cannot be exercised from here, but this part can be, and it is the part where a mistake reaches a
 * real person: a mis-parsed phone number does not fail loudly, it adds a stranger to a conversation
 * about somebody's house.
 *
 * So the emphasis is on refusal — every ambiguous number must produce nothing rather than a guess.
 */
import {
  toE164, fieldFromDescription, shortAddress, groupName, participants, planForEvent, planForEvents,
  GROUP_NAME_MAX, suspiciousNumber
} from '../twin-visit-logger-sandbox/src/whatsapp/plan.mjs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

const TZ = 'America/Los_Angeles';
const NOW = new Date('2026-08-02T09:00:00-07:00');

console.log('=== Phone numbers: parse the clear ones, refuse the rest ===');
check('US 10-digit', toE164('(650) 771-7814'), '+16507717814');
check('with country code', toE164('1 650 771 7814'), '+16507717814');
check('already E.164', toE164('+16507717814'), '+16507717814');
check('dots and dashes', toE164('650.771-7814'), '+16507717814');
check('international with +', toE164('+44 20 7946 0958'), '+442079460958');

console.log('\n--- refused (a wrong number here messages a stranger) ---');
check('too short', toE164('771-7814'), '');
check('extension glued on', toE164('(650) 771-7814 x22'), '');
check('letters', toE164('call the office'), '');
check('empty', toE164(''), '');
check('null', toE164(null), '');
check('"Not found"', toE164('Not found'), '');

console.log('\n=== Numbers that already carry a country code ===');
// The test lead is Philippine: +63 905 453 7035. A 12-digit number with no "+" used to be REFUSED,
// which silently dropped the seller from the group.
check('PH with +', toE164('+63 905 453 7035'), '+639054537035');
check('PH without the + (used to be refused)', toE164('63 905 453 7035'), '+639054537035');
check('PH as bare digits', toE164('639054537035'), '+639054537035');
check('a US seller from REI still gets +1', toE164('(650) 771-7814'), '+16507717814');

console.log('\n--- a local trunk prefix is refused, not guessed at ---');
// 09054537035 is how a PH mobile is written locally. The 0 is a trunk prefix, not a country code,
// and no country code starts with 0 — so the country is unknowable from the digits.
check('leading 0 is refused', toE164('09054537035'), '');
check('...and explained', suspiciousNumber('09054537035').includes('trunk prefix'), true);
check('another local form refused', toE164('0917 123 4567'), '');
check('the 10-digit default country can be changed', toE164('9054537035', '63'), '+639054537035');
check('...and still defaults to US for REI sellers', toE164('9054537035'), '+19054537035');

console.log('\n=== Mistyped numbers are caught before a run ===');
// The real case: a Philippine mobile entered as +9928379192 instead of +639928379192. Valid E.164
// on its face, reads as +992 (Tajikistan), matches nobody, and fails silently.
check('a correct PH number is not flagged', suspiciousNumber('+639054537035'), '');
check('a PH mobile missing its 63 is flagged',
  suspiciousNumber('+9928379192').includes('country code looks missing'), true);
check('the same number written correctly passes', suspiciousNumber('+639928379192'), '');
check('other PH team numbers pass', suspiciousNumber('+639668118312'), '');
check('a US 10-digit (seller format) passes', suspiciousNumber('(650) 771-7814'), '');
check('a US E.164 passes', suspiciousNumber('+14155550100'), '');
check('unreadable input is reported, not silently accepted',
  suspiciousNumber('call the office'), 'could not be read as a phone number');
check('blank is not a complaint', suspiciousNumber(''), '');

console.log('\n=== Reading the event description ===');
const DESC = [
  'Seller: Jose Anguiano',
  'Phone: (650) 771-7814',
  'Email: Not found',
  'Property: 2145 Capitol Ave, East Palo Alto, CA, 94303',
  'Assigned Owner: Juan'
].join('\n');
check('phone', fieldFromDescription(DESC, 'Phone'), '(650) 771-7814');
check('property', fieldFromDescription(DESC, 'Property'), '2145 Capitol Ave, East Palo Alto, CA, 94303');
check('"Not found" reads as empty, not as a value', fieldFromDescription(DESC, 'Email'), '');
check('missing label', fieldFromDescription(DESC, 'Nonsense'), '');

console.log('\n=== Group names match the team\'s own convention ===');
// Their existing groups are named for the FULL address with no date, e.g.
// "728 Tampico, Walnut Creek, CA 94598". Dateless on purpose: one group per PROPERTY, reused on a
// reschedule or a second visit, rather than a new group each time.
const AUG5 = new Date('2026-08-05T14:00:00-07:00');
check('the real example from their WhatsApp',
  groupName('728 Tampico, Walnut Creek, CA 94598', AUG5, TZ),
  '728 Tampico, Walnut Creek, CA 94598');
check('a full address is kept whole', groupName('15340 Canyon 2 Rd, Guerneville, CA 95446', AUG5, TZ),
  '15340 Canyon 2 Rd, Guerneville, CA 95446');
check('the country suffix REI appends is dropped',
  groupName('2145 Capitol Ave, East Palo Alto, CA, 94303, UNITED STATES', AUG5, TZ),
  '2145 Capitol Ave, East Palo Alto, CA, 94303');
check('no date in the name, so a reschedule reuses the same group',
  /Aug|\d{1,2}\/\d{1,2}/.test(groupName('728 Tampico, Walnut Creek, CA 94598', AUG5, TZ)), false);
check('a missing date changes nothing', groupName('2145 Capitol Ave, EPA', null, TZ),
  '2145 Capitol Ave, EPA');

// A template CAN still ask for the date; then shortening must protect it.
const dated = groupName('27833 Gainesville Ave, Hayward, CA 94545', AUG5, TZ, 'Visit {address} {date}');
check('the {address} token still means street only', dated, 'Visit 27833 Gainesville Ave Aug 5');
const absurd = groupName(`${'Very Long Street Name '.repeat(8)}Ave, Hayward, CA`, AUG5, TZ, 'Visit {address} {date}');
check('an over-long name is capped', absurd.length <= GROUP_NAME_MAX, true);
check('...and the date survives the trim', absurd.endsWith('Aug 5'), true);
check('a tighter cap can be imposed without a code change',
  groupName('2145 Capitol Ave, EPA', AUG5, TZ, 'Visit {address} {date}', 25).length <= 25, true);

console.log('\n=== Who ends up in the group ===');
const TEAM = ['(415) 555-0100', '+14155550101'];
check('team only',
  participants({ teamNumbers: TEAM, sellerPhone: '(650) 771-7814', includeSeller: false })
    .map((p) => p.number),
  ['+14155550100', '+14155550101']);
check('team plus seller',
  participants({ teamNumbers: TEAM, sellerPhone: '(650) 771-7814', includeSeller: true })
    .map((p) => `${p.role}:${p.number}`),
  ['team:+14155550100', 'team:+14155550101', 'seller:+16507717814']);
check('an unparseable seller number is dropped, the group is still created',
  participants({ teamNumbers: TEAM, sellerPhone: 'Not found', includeSeller: true }).length, 2);
check('the same person listed twice is added once',
  participants({ teamNumbers: ['(415) 555-0100', '415-555-0100'] }).length, 1);
check('our own number is never added as a participant',
  participants({ teamNumbers: TEAM, ownNumber: '+14155550100' }).map((p) => p.number),
  ['+14155550101']);

console.log('\n=== Which calendar events get a group ===');
const base = {
  id: 'evt1',
  summary: 'Property Visit - 2145 Capitol Ave, East Palo Alto, CA',
  location: '2145 Capitol Ave, East Palo Alto, CA, 94303',
  description: DESC,
  start: { dateTime: '2026-08-05T14:00:00-07:00' }
};
const opts = { timezone: TZ, teamNumbers: TEAM, includeSeller: true, now: NOW };

const good = planForEvent(base, opts);
check('a future visit is planned', good.create, true);
check('...named for the property', good.name, '2145 Capitol Ave, East Palo Alto, CA, 94303');
check('...with the seller in it', good.sellerIncluded, true);
check('...and three participants', good.participants.length, 3);

const reason = (event, extra) => planForEvent({ ...base, ...event }, { ...opts, ...extra }).reason;
console.log('\n--- skipped, with a reason ---');
check('someone else\'s calendar entry', reason({ summary: 'Dentist' }), 'not a Property Visit event');
check('a cancelled event', reason({ status: 'cancelled' }), 'event is cancelled');
check('a past visit', reason({ start: { dateTime: '2024-03-01T14:00:00-08:00' } }), 'visit is in the past');
check('no start time', reason({ start: {} }), 'event has no start time');
check('no address anywhere',
  reason({ location: '', description: 'Seller: X', summary: 'Property Visit' }),
  'no property address on the event');
check('nobody valid to add',
  reason({}, { teamNumbers: [], includeSeller: false }),
  'no valid participant numbers — nobody to add');
check('already created', planForEvent(base, { ...opts, alreadyDone: new Set(['evt1']) }).reason,
  'group already created (2145 Capitol Ave, East Palo Alto, CA, 94303)');

console.log('\n=== Today\'s visit still counts, even later in the day ===');
check("a visit at 8am when it is already 9am",
  planForEvent({ ...base, start: { dateTime: '2026-08-02T08:00:00-07:00' } }, opts).create, true);

console.log('\n=== A whole calendar page ===');
const page = [
  base,
  { ...base, id: 'evt2', summary: 'Team standup', location: '' },
  { ...base, id: 'evt3' },                                   // same property, same day
  { ...base, id: 'evt4', location: '790 Snow Ter, San Jose, CA', start: { dateTime: '2026-08-06T10:00:00-07:00' } }
];
const result = planForEvents(page, opts);
check('two groups, not four', result.create.length, 2);
check('the duplicate property/day is skipped once',
  result.skipped.filter((s) => s.reason.startsWith('duplicate of')).length, 1);
check('the unrelated meeting is skipped',
  result.skipped.some((s) => s.reason === 'not a Property Visit event'), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
