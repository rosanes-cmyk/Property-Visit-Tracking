/**
 * The last thing between seller contact details and a group chat.
 *
 *   node tests/notify.test.mjs
 *
 * These notifications go to a Google Chat space with the whole team in it. Saying "a visit was logged
 * at 1390 Estudillo Ave" is the point. Including the seller's mobile number and email is not — that is
 * contact data spreading into a chat log nobody is auditing, so it gets stripped on the way out
 * regardless of what the caller assembled.
 */
import { scrubContactDetails, notifyChat } from '../twin-visit-logger-sandbox/src/utils/notify.mjs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

console.log('=== Contact details never reach the chat space ===');
check('a US phone in brackets', scrubContactDetails('Call (707) 481-7040 today'), 'Call [phone] today');
check('a dotted phone', scrubContactDetails('510.346.8546'), '[phone]');
check('an E.164 number', scrubContactDetails('+15103468546'), '[phone]');
check('a PH number with spaces', scrubContactDetails('+63 966 811 8312'), '[phone]');
check('an email', scrubContactDetails('jon.box@aol.com booked'), '[email] booked');
check('an email with a plus tag', scrubContactDetails('a+b@twinhomebuyer.com'), '[email]');
check('both at once',
  scrubContactDetails('Jon Box · jon@aol.com · (707) 481-7040'), 'Jon Box · [email] · [phone]');

console.log('\n=== ...while everything worth reading survives ===');
// If this over-matches, the notifications become unreadable and get ignored, which defeats the point.
check('a street address is not a phone number',
  scrubContactDetails('1390 Estudillo Ave, San Leandro, CA 94577'),
  '1390 Estudillo Ave, San Leandro, CA 94577');
check('a date and time survive',
  scrubContactDetails('Tue, Aug 4, 2026, 11:00 AM'), 'Tue, Aug 4, 2026, 11:00 AM');
check('a row number survives', scrubContactDetails('Row 44 in "Data"'), 'Row 44 in "Data"');
check('a name and owner survive',
  scrubContactDetails('David Jackowitz · Assigned: Juan'), 'David Jackowitz · Assigned: Juan');
check('a member count survives', scrubContactDetails('5 member(s) added'), '5 member(s) added');
// Eight digits and a dash looks exactly like a phone number by shape. Redacting the appointment date
// out of a message whose entire purpose is to say when the visit is would be a self-defeating fix.
check('an ISO date is not a phone number',
  scrubContactDetails('2026-08-04T11:00:00-07:00'), '2026-08-04T11:00:00-07:00');
check('a zip code survives', scrubContactDetails('San Leandro, CA 94577'), 'San Leandro, CA 94577');
check('a REI record id survives', scrubContactDetails('REI record 20533149'), 'REI record 20533149');
check('empty is empty', scrubContactDetails(''), '');
check('undefined does not throw', scrubContactDetails(undefined), '');

console.log('\n=== No webhook configured means silence, not a crash ===');
// A notification must never be able to fail the run it is reporting on.
check('an empty webhook is a no-op', await notifyChat('anything', { webhookUrl: '' }), false);
check('...and returns false rather than throwing',
  await notifyChat('anything', { webhookUrl: 'not-a-url' }), false);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
