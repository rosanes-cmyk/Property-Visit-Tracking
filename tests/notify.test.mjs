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
import path from 'node:path';

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
check('notifyChat honours it', /if \(cfg && !cfg\.chatAlerts && !critical\) return false;/.test(NOTIFY), true);

/*
 * ...with ONE exception, and the line between them is what makes the switch safe to leave off.
 *
 * What the client asked to silence was per-lead noise: "this visit moved", "that gift went out" — news it
 * is fine to read tomorrow. `critical: true` is for a message that says the automation CANNOT WORK AT ALL,
 * and there is exactly one today: REI is logged out, so nothing is being checked and every card from here
 * is stale. Before this, that condition wrote one line into a log file and stopped. Nobody reads log files,
 * so it could sit for days while the cards carried on looking authoritative.
 *
 * Silencing that is not "fewer interruptions" — it is the system failing quietly, which is the single
 * failure mode this project has spent the most effort designing out.
 */
check('a critical alert is not silenced by the off switch', /critical = false/.test(NOTIFY), true);
/*
 * Anchored on the CALL, not the name: `scrubContactDetails` also appears where it is defined, further up
 * the file, so a bare indexOf compares against the definition and passes for the wrong reason.
 */
check('...and it is still redacted like everything else',
  NOTIFY.indexOf('critical = false') < NOTIFY.indexOf(': scrubContactDetails(text)}`'), true);
/*
 * Narrow on purpose. If this list grows, the switch stops meaning anything — so the count is asserted, and
 * adding a second critical message is a deliberate act that edits this line.
 */
{
  const RECHECK = fs.readFileSync('twin-visit-logger-sandbox/scripts/recheck-rei.mjs', 'utf8');
  const users = ['scripts/recheck-rei.mjs', 'scripts/fill-pending-rei.mjs', 'scripts/audit-notes.mjs',
    'src/services/process.mjs', 'src/whatsapp/watch.mjs', 'src/rei/recheck.mjs']
    /* `critical: true }` — the closing brace anchors this to a real call site rather than a comment. */
    .flatMap((f) => (fs.readFileSync(`twin-visit-logger-sandbox/${f}`, 'utf8')
      .match(/critical: true \}/g) || []).map(() => f));
  check('exactly one message in the project is critical', users, ['scripts/recheck-rei.mjs']);
  check('...and it is the REI logout', /REI is LOGGED OUT on \$\{os\.hostname\(\)\}/.test(RECHECK), true);
  /*
   * Throttled, and the number matters. Four jobs hit REI on timers — the 20-minute whole-book re-check, the
   * hourly sweep, three fixed pre-card sweeps, and the two-minute board intake. A logged-out REI fails every
   * one of them, so an unthrottled alert is roughly forty identical messages an hour. That is how a space
   * gets muted, and a muted space is worse than no alert because everybody believes they are covered.
   */
  check('the logout alert is throttled', /LOGOUT_ALERT_EVERY_MS = 2 \* 60 \* 60 \* 1000/.test(RECHECK), true);
  check('...and the throttle only stamps on a SUCCESSFUL send',
    RECHECK.indexOf('if (!sent) {') < RECHECK.indexOf('seen.reiLoggedOutAt = Date.now()'), true);
  /*
   * Because recording the ATTEMPT would let a Chat outage silence the one message that says nothing works —
   * exactly the wrong direction, and a mistake that would be invisible for two hours at a time.
   */
  check('...so a Chat outage does not silence it for two hours',
    /Recording the attempt would mean a Chat outage silences the alert/.test(RECHECK), true);
  check('the alert names a fix a non-developer can run', /scripts\\\\login-rei\.cmd/.test(RECHECK), true);
  check('...and that file exists', fs.existsSync('twin-visit-logger-sandbox/scripts/login-rei.cmd'), true);
  /*
   * It must say no data was lost. "REI is logged out" reads like an emergency, and the honest reassurance —
   * a failed lead is never recorded as checked, so it returns to the front of the queue — is the difference
   * between someone fixing it calmly and someone going looking for damage that is not there.
   */
  check('...and says nothing was lost', /No data is lost/.test(RECHECK), true);
}
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

console.log('\n=== the visit briefing goes to Chat, and does so by default ===');
/*
 * This was the other way round, correctly, when WhatsApp carried the briefing: the client saw a full
 * PROPERTY INSPECTION card arrive in the alerts channel as a second, longer copy and said "it should be in
 * the whatsapp only... and should be only in the whatsapp if we enable again."
 *
 * WhatsApp is gone — the number is restricted — so Chat is not duplicating anything; it is the only place
 * the visitor gets this: "it will send notif always in the gc about the notes instead for whats app."
 *
 * The DEFAULT is what this now pins. Leaving it false meant the single channel the team has had to be
 * switched on by hand in a config file, and the client's reply to being asked to do that was the right one:
 * "why would i type that, it should be automated." A default that must be corrected before the software
 * does its job is a bug with a workaround, not a setting.
 */
const PROCESS = fs.readFileSync(new URL('../twin-visit-logger-sandbox/src/services/process.mjs', import.meta.url), 'utf8');
/*
 * The gate, not the builder. This used to pin `const briefing = buildInspectionNote` on the very next
 * line, and broke when the Chat briefing was switched to the shared builder — on a file that was more
 * correct than before. What matters is that nothing is built or posted outside the two conditions.
 */
check('the briefing post is gated',
  /if \(!config\.dryRun && config\.chatVisitBriefing\) \{/.test(PROCESS), true);
check('...and the briefing is built inside that gate',
  PROCESS.indexOf('config.chatVisitBriefing') < PROCESS.indexOf('const briefing = briefingFromDescription'), true);
const CONFIG = fs.readFileSync(new URL('../twin-visit-logger-sandbox/src/config.mjs', import.meta.url), 'utf8');
check('...and defaults to ON now that Chat is the only channel',
  /chatVisitBriefing: bool\(process\.env\.CHAT_VISIT_BRIEFING, true\)/.test(CONFIG), true);
/* Still switchable off, for whenever WhatsApp is genuinely carrying it again. */
check('...and can still be turned off explicitly',
  fs.readFileSync('twin-visit-logger-sandbox/.env.example', 'utf8').includes('CHAT_VISIT_BRIEFING=true'), true);
/*
 * Its own switch, not borrowed from CHAT_ALERTS. Those are different decisions: CHAT_ALERTS silences the
 * per-lead interruptions, this one decides where the briefing lives. Folding them together would mean
 * turning the briefing off could only be done by silencing everything.
 */
check('it is a separate switch from CHAT_ALERTS',
  CONFIG.includes('CHAT_VISIT_BRIEFING') && CONFIG.includes('CHAT_ALERTS'), true);
check('...and the briefing gate does not read chatAlerts',
  /config\.chatAlerts[\s\S]{0,80}buildInspectionNote/.test(PROCESS), false);


console.log('\n--- the briefing is fenced so a teammate can copy just that ---');
/*
 * The client: "how about the template? so my teammate can copy it?"
 *
 * Google Chat renders a ``` block in monospace with a copy control, and copying takes ONLY what is
 * inside it. Posted flat, a teammate copying the briefing also carried "✅ Calendar — event on Juan's
 * Official Calendar · ➡️ NEXT: create the WhatsApp group" into the visit group — instructions to
 * themselves, pasted for the team.
 */
check('the briefing is wrapped in a fence', /const fenced = /.test(PROCESS), true);
/*
 * The fence is built from char codes rather than written literally, so this source file can hold the
 * assertion without the fence closing the block it lives in.
 */
check('...from a real triple backtick',
  /const FENCE = String\.fromCharCode\(96, 96, 96\)/.test(PROCESS), true);
check('...and any fence inside the text is neutralised first',
  /briefing\.split\(FENCE\)\.join\(/.test(PROCESS), true);
/* The checklist must stay OUTSIDE the fence, or copying picks it up again. */
check('the checklist sits outside the fence',
  /\$\{fenced\}\\n\\n━━ DONE FOR YOU ━━/.test(PROCESS), true);
check('...and the message says what to copy',
  /Copy the block below into the visit group/.test(PROCESS), true);

console.log('\n=== keepContactDetails: the one message that keeps the number ===');
/*
 * The visit briefing is copied out of Chat and pasted into the visit group. Redacted, it sends the
 * visitor to a house to meet somebody they cannot then ring, and they go digging in REI — which is the
 * ten minutes the briefing exists to save. Both destinations are team-only.
 *
 * What these tests protect is that it is exactly ONE message. A config flag would have silenced the
 * scrubber everywhere; a parameter means the exception is visible at the call site that asks for it.
 */
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  sent.push(JSON.parse(init.body).text);
  return { ok: true, status: 200, text: async () => '' };
};
const HOOK = 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=k&token=t';
const BRIEF = 'Call Marichu on (415) 555-0100 or marichu@example.com';

await notifyChat(BRIEF, { webhookUrl: HOOK });
check('redacted by default', /\[phone\]/.test(sent.at(-1)) && /\[email\]/.test(sent.at(-1)), true);

await notifyChat(BRIEF, { webhookUrl: HOOK, keepContactDetails: true });
check('kept when asked for', sent.at(-1).includes('(415) 555-0100'), true);
check('...including the email', sent.at(-1).includes('marichu@example.com'), true);
check('...and the message is otherwise unchanged', sent.at(-1).endsWith(BRIEF), true);

await notifyChat(BRIEF, { webhookUrl: HOOK, keepContactDetails: false });
check('explicitly false still redacts', /\[phone\]/.test(sent.at(-1)), true);
globalThis.fetch = realFetch;

/*
 * TWO call sites may ask for it, and they are named. Any third would be a silent widening of what leaves
 * this project, so the counts are asserted rather than the absence — a new one has to come here first.
 *
 *   1. the seeded-group handover (watch.mjs) — the briefing a colleague pastes into the visit group
 *   2. the visit briefing itself (process.mjs) — which became the ONLY delivery once WhatsApp went out
 *
 * Both go to the client's own team-only Workspace, which is the audience the WhatsApp group had.
 */
const WATCH = fs.readFileSync(
  path.resolve('twin-visit-logger-sandbox/src/whatsapp/watch.mjs'), 'utf8');
const PROC = fs.readFileSync(
  path.resolve('twin-visit-logger-sandbox/src/services/process.mjs'), 'utf8');
check('exactly one call site in the WhatsApp watcher',
  (WATCH.match(/keepContactDetails: true/g) || []).length, 1);
check('exactly one call site in the intake',
  (PROC.match(/keepContactDetails: true/g) || []).length, 1);
/* And it is the briefing there, not one of the ordinary alerts. */
check('...and it is the visit briefing',
  /briefing[\s\S]{0,900}keepContactDetails: true/.test(PROC), true);
check('...still gated on CHAT_VISIT_BRIEFING',
  PROC.indexOf('config.chatVisitBriefing') < PROC.indexOf('keepContactDetails: true'), true);
/*
 * Positions, not a character window. The seeded branch grew when admin promotion was added and a
 * fixed-width regex started failing on a file that was still correct — the assertion is that the ONE
 * call keeping contact details sits inside the seeded branch, not that it sits within N characters.
 */
const seedAt = WATCH.indexOf('if (plan.seedOnly)');
const keepAt = WATCH.indexOf('keepContactDetails: true');
check('...and it is the seeded handover', seedAt > 0 && keepAt > seedAt, true);
check('...still inside that branch, before the loop moves on',
  keepAt < WATCH.indexOf('continue;', seedAt), true);

console.log('\n=== a cancelled visit says WHEN it was ===');
/*
 * The client, on a live reschedule card: "there i a bug with this". It read
 *
 *   Was booked for 2026-08-15 at Sat Dec 30 1899 12:00:00 GMT-0800 (Pacific Standard Time)
 *
 * Sheets counts a time-only cell from 30 December 1899, so the cell comes back as a Date on that day and
 * String() prints the epoch instead of the clock. Every other card already went through timeCell_; this one
 * line read the cell raw. It matters more here than anywhere: the card exists to say a booked visit is off,
 * so WHEN it was is the fact the reader acts on, and that was the part rendered as gibberish.
 *
 * Run for real — the shipped timeCell_ driven by the exact line notifyVisitTagged_ now uses.
 */
{
  const gs = fs.readFileSync(new URL('../apps-script/ChatNotify.gs', import.meta.url), 'utf8');
  const web = fs.readFileSync(new URL('../apps-script/WebApp.gs', import.meta.url), 'utf8');
  const combined = fs.readFileSync(new URL('../apps-script/Code.combined.gs', import.meta.url), 'utf8');

  const helpers = gs.slice(gs.indexOf('function clock_('), gs.indexOf('function timeCell_(')) +
    gs.slice(gs.indexOf('function timeCell_('), gs.indexOf('\n}', gs.indexOf('function timeCell_(')) + 2);
  /* The line under test, lifted from the shipped file rather than retyped. */
  const line = web.slice(web.indexOf("var time = (typeof timeCell_ === 'function'"),
    web.indexOf(").trim();", web.indexOf("var time = (typeof timeCell_")) + 9);
  check('the line was found in WebApp.gs', line.length > 0, true);

  const render = new Function('R', `${helpers}\n${line}\nreturn time;`);
  const cell = (v) => ({ get: (k) => (k === 'Visit Time' ? v : '') });

  /* Exactly what Sheets hands back for a time-only cell — the value that produced the live card. */
  check('a noon time cell', render(cell(new Date(1899, 11, 30, 12, 0))), '12:00 PM');
  check('an afternoon visit', render(cell(new Date(1899, 11, 30, 14, 0))), '2:00 PM');
  /* And the serial form, which the Sheets API sends instead when the read goes through the JSON API. */
  check('a 0.5-of-a-day serial', render(cell(0.5)), '12:00 PM');
  check('typed text still works', render(cell('10:30 AM')), '10:30 AM');
  check('an empty cell stays empty', render(cell('')), '');
  /* The failure itself: the epoch must never reach a card again. */
  check('the 1899 epoch never appears',
    /1899/.test(render(cell(new Date(1899, 11, 30, 12, 0)))), false);

  /* Code.combined.gs is what gets pasted — a fix only in WebApp.gs ships nothing. */
  check('the pasted copy has the same fix',
    combined.includes("var time = (typeof timeCell_ === 'function'"), true);
  check('...and neither file reads the cell raw any more',
    /var time = String\(R\.get\('Visit Time'\)/.test(web + combined), false);
}


console.log('\n=== an order reference is not a phone number ===');
/*
 * The client's Chat space, on the very gift the parser had just been fixed to find:
 *
 *   a GIFT is recorded in REI. Gift ordered in REI - $41.13 - order #[phone] - ordered 08/12/2026
 *
 * Home Depot's order id is 20871989699423792 — seventeen digits, well past the nine-digit threshold — so
 * the rule that keeps sellers' numbers out of the space ate the reference. The amount survived, both dates
 * survived, and the one field somebody would act on to find the order did not.
 *
 * Matched by its LABEL, not by length. "Seventeen digits is too long for a phone number" is nearly true and
 * not quite — E.164 allows fifteen — and I would not want a seller's mobile riding on that margin.
 */
check('an order number survives',
  scrubContactDetails('Gift ordered in REI — $41.13 · order #20871989699423792 · ordered 08/12/2026'),
  'Gift ordered in REI — $41.13 · order #20871989699423792 · ordered 08/12/2026');
check('"Order ID:" too', scrubContactDetails('Order ID: 20871989699423792 delivered'),
  'Order ID: 20871989699423792 delivered');
check('and "order no."', scrubContactDetails('order no. 104240205'), 'order no. 104240205');

/* The whole point of the scrubber must still hold — this is seller contact data reaching a team space. */
check('a bracketed phone is still redacted', scrubContactDetails('Call (707) 481-7040 today'),
  'Call [phone] today');
check('a labelled phone is still redacted', scrubContactDetails('Phone: (650) 325-3388'), 'Phone: [phone]');
check('an international phone is still redacted', scrubContactDetails('Reach him on +1 650 620 4017'),
  'Reach him on [phone]');
check('an email is still redacted', scrubContactDetails('seller ngam@example.com'), 'seller [email]');
/* And the date that was being eaten before this function counted digits stays readable. */
check('a visit date is still not a phone number', scrubContactDetails('visit 2026-08-04 at 3:00 PM'),
  'visit 2026-08-04 at 3:00 PM');

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
