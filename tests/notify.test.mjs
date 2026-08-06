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
import fs from 'node:fs';

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

console.log('\n=== CHAT_ALERTS=off, without touching the credential ===');
/*
 * The client, after the same false alert arrived twice: "but we need to turn off the auto alert."
 *
 * Before this the only way to stop them was to delete CHAT_WEBHOOK_URL, which is a credential — it would
 * have to be found and pasted back to turn anything on again, and it would also silence the failure notices
 * that are the reason this automation is allowed to run unattended at all.
 *
 * Read from the shipped source rather than by loading config, because config.mjs pulls in dotenv and a
 * validated .env, which is exactly what keeps this file testable from the repo root.
 */
const CFG = fs.readFileSync('twin-visit-logger-sandbox/src/config.mjs', 'utf8');
const NOTIFY = fs.readFileSync('twin-visit-logger-sandbox/src/utils/notify.mjs', 'utf8');
check('the switch exists and reads an env var',
  /chatAlerts:\s*\(process\.env\.CHAT_ALERTS \|\| 'on'\)/.test(CFG), true);
check('...defaulting to ON, so nobody loses alerts by upgrading',
  /CHAT_ALERTS \|\| 'on'/.test(CFG), true);
check("...and only the exact word 'off' turns it off",
  /!==\s*'off'/.test(CFG), true);
check('it is validated like every other setting', /chatAlerts: z\.boolean\(\)/.test(CFG), true);
check('notifyChat honours it', /if \(cfg && !cfg\.chatAlerts\) return false;/.test(NOTIFY), true);
/*
 * The order matters: the switch is checked BEFORE the webhook, so turning alerts off works whether or not a
 * webhook is configured, and cannot depend on one being present.
 */
check('...before it even looks at the webhook',
  NOTIFY.indexOf('!cfg.chatAlerts') < NOTIFY.indexOf('const url = webhookUrl !== null'), true);
/* An explicit webhookUrl bypasses config entirely — this is how these very tests call it. */
check('an explicit webhook still bypasses config',
  await notifyChat('anything', { webhookUrl: '' }), false);
check('it is documented where somebody would look for it',
  fs.readFileSync('twin-visit-logger-sandbox/.env.example', 'utf8').includes('CHAT_ALERTS=on'), true);
/*
 * The 11am and 3pm work queue must NOT be affected. Apps Script posts that from its own Script Properties,
 * so the digest keeps arriving while the per-lead interruptions stop — which is the whole point of having a
 * switch rather than deleting the webhook.
 */
check('the digest is posted by Apps Script, not by this notifier',
  /CHAT_WEBHOOK_PROP/.test(fs.readFileSync('apps-script/ChatNotify.gs', 'utf8')), true);
check('...and nothing in Apps Script reads CHAT_ALERTS',
  /CHAT_ALERTS/.test(fs.readFileSync('apps-script/ChatNotify.gs', 'utf8')), false);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
