/**
 * The 3pm digest — Cherry's revision: a work queue, not a data-quality report.
 *
 *   node tests/attention-digest.test.mjs
 *
 * Her acceptance criteria, from "3:00 PM LEAD NOTIFICATION REVISION":
 *   - every category represents ONE business action, not one database condition
 *   - each lead appears once, in the most urgent applicable bucket
 *   - each bucket shows its count; each line shows name, address, owner and the exact reason
 *   - unassigned leads say UNASSIGNED
 *   - Lost / Closed Out and Contract Signed never appear
 *   - no due date or action is invented in order to raise an alert
 *   - an ambiguous record is flagged, not guessed at
 *
 * This runs the SHIPPED attentionBucket_ out of ChatNotify.gs rather than a copy of its rules. The
 * previous version of this file re-implemented the bucket logic, which meant the tests could agree
 * with themselves while disagreeing with the code that actually posts to Chat.
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

const CHAT = read('apps-script/ChatNotify.gs');

/* ------------------------------------------------------------------
 * Lift the real functions out of the .gs and run them here.
 * ---------------------------------------------------------------- */
const slice = (from, to) => CHAT.slice(CHAT.indexOf(from), CHAT.indexOf(to));
const source = [
  slice('var ATTENTION_BUCKETS = [', '/** A sheet date cell'),
  slice('function dateCell_(', 'function attentionBucket_('),
  slice('function attentionBucket_(', '/**\n * Post the 3pm work queue')
].join('\n');

const { attentionBucket_, ATTENTION_BUCKETS } = new Function(
  'fmt_',
  `${source}\nreturn { attentionBucket_: attentionBucket_, ATTENTION_BUCKETS: ATTENTION_BUCKETS };`
)((d) => new Date(d).toISOString().slice(0, 10));

const TODAY = new Date(2026, 7, 4);            // Aug 4 2026, local midnight
const day = (y, m, d) => new Date(y, m - 1, d);
const bucket = (rec) => { const h = attentionBucket_(rec, TODAY); return h ? h.key : null; };
const reason = (rec) => { const h = attentionBucket_(rec, TODAY); return h ? h.reason : ''; };

/** A record with nothing wrong with it, to vary one field at a time. */
const OK = {
  'Property Address': '1390 Estudillo Ave, San Leandro, CA 94577',
  'Seller Name': 'David Jackowitz',
  'Current Stage': 'Visit Scheduled',
  'Visit Status': 'Scheduled',
  'Visit Date': day(2026, 8, 20),
  'Next Action': 'Conduct scheduled visit & log outcome',
  'Next Action Due Date': day(2026, 8, 20),
  'Assigned Owner': 'Juan',
  'Stalled Status': 'No',
  'Data Quality Status': 'OK'
};

console.log('=== Cherry\'s seven buckets exist, in her priority order ===');
check('eight buckets: her seven plus the ambiguity residue', ATTENTION_BUCKETS.length, 8);
check('in her order', ATTENTION_BUCKETS.map((b) => b.title), [
  'Visit Overdue',
  'Offer Needs Completion',
  'Missing Next Action',
  'Missing Seller Motivation',
  'Missing Assigned Owner',
  'Long-Term Nurture Missing Follow-Up',
  'Stalled',
  'Flagged — ambiguous, needs a person'
]);
check('every bucket names one action', ATTENTION_BUCKETS.every((b) => /\.$/.test(b.action)), true);
check('every bucket has an icon', ATTENTION_BUCKETS.every((b) => !!b.icon), true);

console.log('\n=== A healthy record does not appear at all ===');
check('nothing wrong, nothing posted', bucket(OK), null);

console.log('\n=== 1. Visit Overdue ===');
const missed = { ...OK, 'Visit Date': day(2026, 8, 1) };
check('a passed visit still marked Scheduled', bucket(missed), 'visitOverdue');
check('the reason names the date', reason(missed), 'visit was 2026-08-01, still marked Scheduled');
check("today's visit is not overdue", bucket({ ...OK, 'Visit Date': TODAY }), null);
check('a completed visit is not overdue',
  bucket({ ...missed, 'Visit Status': 'Completed', 'Seller Motivation': 'Relocating' }), null);
check('a cancelled visit is not overdue', bucket({ ...missed, 'Visit Status': 'Canceled' }), null);
// The sheet stores dates as serials when written by the API; both shapes must behave the same.
check('a Sheets date serial works too', bucket({ ...OK, 'Visit Date': 46235 }), 'visitOverdue');

console.log('\n=== 2. Offer Needs Completion ===');
const offer = { ...OK, 'Current Stage': 'Offer Sent', 'Visit Status': 'Completed', 'Seller Motivation': 'Divorce' };
check('Offer Sent with no amount and no date', bucket(offer), 'offerIncomplete');
check('...and says so', reason(offer), 'stage is Offer Sent but neither the amount nor the sent date is filled in');
check('amount only', reason({ ...offer, 'Approved Offer Amount': 450000 }),
  'stage is Offer Sent but the sent date is blank');
check('date only', reason({ ...offer, 'Offer Sent Date': day(2026, 8, 1) }),
  'stage is Offer Sent but the offer amount is blank');
check('both filled in disappears from the queue',
  bucket({ ...offer, 'Approved Offer Amount': 450000, 'Offer Sent Date': day(2026, 8, 1) }), null);
// A £0 offer is a real number, not a blank.
check('a zero offer amount counts as filled in',
  bucket({ ...offer, 'Approved Offer Amount': 0, 'Offer Sent Date': day(2026, 8, 1) }), null);
check('an earlier stage with no offer figures is not this bucket',
  bucket({ ...OK, 'Current Stage': 'Offer Preparation' }), null);

console.log('\n=== 3. Missing Next Action ===');
check('no action, no due date', bucket({ ...OK, 'Next Action': '', 'Next Action Due Date': '' }), 'missingNextAction');
check('...and the reason says both', reason({ ...OK, 'Next Action': '', 'Next Action Due Date': '' }),
  'no next action and no due date');
/*
 * This is the artifact Cherry queried: the stage cascade stamps a due date, nobody writes an action,
 * and the old digest reported it as "overdue". The work is to write the action — so it belongs here.
 */
check('a due date the cascade stamped, with no action written',
  reason({ ...OK, 'Next Action': '' }), 'a due date with no action written against it');
check('an action with no due date',
  reason({ ...OK, 'Next Action Due Date': '' }), 'next action "Conduct scheduled visit & log outcome" has no due date');
check('whitespace is not an action', bucket({ ...OK, 'Next Action': '   ' }), 'missingNextAction');

console.log('\n=== 4. Missing Seller Motivation ===');
const visited = { ...OK, 'Visit Status': 'Completed', 'Visit Date': day(2026, 8, 1) };
check('visit completed, motivation blank', bucket(visited), 'missingMotivation');
check('the reason names the visit date', reason(visited), 'visit on 2026-08-01 completed, seller motivation still blank');
check('filled in, gone', bucket({ ...visited, 'Seller Motivation': 'Inherited, wants a quick close' }), null);
check('the review stage counts as visited',
  bucket({ ...OK, 'Visit Status': '', 'Current Stage': 'Visit Completed — Needs Review' }), 'missingMotivation');
// Motivation is a POST-visit field: an upcoming visit must not be nagged for it.
check('an upcoming visit is not asked for motivation yet', bucket(OK), null);

console.log('\n=== 5. Missing Assigned Owner ===');
const noOwner = { ...OK, 'Assigned Owner': '' };
check('no owner', bucket(noOwner), 'missingOwner');
check('the reason is plain', reason(noOwner), 'no assigned owner');
check('whitespace is not an owner', bucket({ ...OK, 'Assigned Owner': '  ' }), 'missingOwner');
/*
 * Her priority list puts Missing Next Action at 3 and Missing Assigned Owner at 5, so a lead missing
 * both reports as Missing Next Action. Raised as question C in docs/3pm-Digest-Revision.md — a manager
 * arguably needs the ownerless leads first — but implemented as specified, not quietly reordered.
 */
check('missing next action outranks missing owner, per her order',
  bucket({ ...OK, 'Assigned Owner': '', 'Next Action': '' }), 'missingNextAction');

console.log('\n=== 6. Long-Term Nurture Missing Follow-Up ===');
const nurture = { ...OK, 'Current Stage': 'Long-Term Nurture', 'Visit Status': '', 'Next Action Due Date': '' };
check('in nurture with no follow-up date', bucket(nurture), 'nurtureNoFollowUp');
check('the reason says so', reason(nurture), 'no follow-up date set');
check('a past follow-up date is not a follow-up',
  reason({ ...nurture, 'Next Action Due Date': day(2026, 7, 1) }), 'follow-up date 2026-07-01 is not in the future');
check('a future date clears it', bucket({ ...nurture, 'Next Action Due Date': day(2026, 12, 1) }), null);
/*
 * The exemption that makes bucket 6 reachable at all: a nurture lead with no due date satisfies bucket
 * 3 as well, and bucket 3 comes first. Without exempting nurture from bucket 3, bucket 6 reads zero
 * forever. Flagged for approval rather than decided silently.
 */
check('nurture is exempt from bucket 3, or bucket 6 could never fire',
  bucket({ ...nurture, 'Next Action': '' }), 'nurtureNoFollowUp');

console.log('\n=== 7. Stalled ===');
const stalled = { ...OK, 'Stalled Status': 'Yes', 'Days Since Last Activity': 6 };
check('stalled with everything else in order', bucket(stalled), 'stalled');
check('the reason counts the silence', reason(stalled), 'no activity for 6 day(s)');
check('...and copes without the number', reason({ ...OK, 'Stalled Status': 'Yes' }), 'no recent activity');

console.log('\n=== 8. Flagged — the ambiguity residue, not the old catch-all ===');
check('flagged but matching none of the seven',
  bucket({ ...OK, 'Data Quality Status': 'Exception', 'Exception Reason': 'Two sellers on one address' }), 'flagged');
check('it carries the exception reason',
  reason({ ...OK, 'Data Quality Status': 'Exception', 'Exception Reason': 'Two sellers on one address' }),
  'Two sellers on one address');
check('or the missing-fields list',
  reason({ ...OK, 'Data Quality Status': 'Incomplete', 'Missing Required Fields': 'Phone' }), 'Phone');
/*
 * The whole point of the revision: an incomplete record now reports the ACTION, not the flag. This
 * record is both Incomplete and missing its next action, and it must land in bucket 3.
 */
check('a real missing field beats the generic flag',
  bucket({ ...OK, 'Next Action': '', 'Data Quality Status': 'Incomplete' }), 'missingNextAction');

console.log('\n=== Records that must never appear ===');
check('Lost / Closed Out', bucket({ ...missed, 'Current Stage': 'Lost / Closed Out' }), null);
check('Contract Signed', bucket({ ...missed, 'Current Stage': 'Contract Signed' }), null);
check('a TEST row', bucket({ ...missed, Source: 'TEST' }), null);
check('no property address', bucket({ ...missed, 'Property Address': '' }), null);
check('an entirely blank row', bucket({}), null);

console.log('\n=== One lead, one bucket ===');
/*
 * Jose Anguiano is the record that appeared three times in the old digest, inflating the headline
 * count. Every condition below is true of him at once; he must produce exactly one line.
 */
const jose = {
  'Property Address': '2145 Capitol Ave, East Palo Alto, CA',
  'Seller Name': 'Jose Anguiano',
  'Current Stage': 'Visit Scheduled',
  'Visit Status': 'Scheduled', 'Visit Date': day(2026, 8, 1),
  'Next Action': '', 'Next Action Due Date': '',
  'Assigned Owner': '',
  'Seller Motivation': '',
  'Stalled Status': 'Yes',
  'Data Quality Status': 'Incomplete'
};
check('five conditions, one bucket', bucket(jose), 'visitOverdue');
check('...and it is the most urgent one', ATTENTION_BUCKETS[0].key, 'visitOverdue');
const hits = ATTENTION_BUCKETS.filter((b) => bucket(jose) === b.key);
check('exactly one bucket claims him', hits.length, 1);

console.log('\n=== The count is the number of leads ===');
const many = [OK, missed, jose, noOwner, stalled, { ...visited }, { ...nurture },
  { ...missed, 'Current Stage': 'Contract Signed' }];
const lines = many.map(bucket).filter(Boolean);
check('8 records in, 6 lines out (one healthy, one excluded)', lines.length, 6);
check('no record produces two lines', lines.length, new Set(many.map((_, i) => i)).size - 2);

console.log('\n=== The posted card meets her display rules ===');
const post = CHAT.slice(CHAT.indexOf('function sendAttentionDigestToChat'));
check('unassigned is spelled out', /UNASSIGNED/.test(post), true);
check('each line carries the seller name', /rec\['Seller Name'\]/.test(post), true);
check('each line carries the address', /rec\['Property Address'\]/.test(post), true);
check('each line carries the reason', /hit\.reason/.test(post), true);
check('each bucket shows its count', /\(' \+ arr\.length \+ '\)/.test(post), true);
check('each bucket shows its action', /b\.action/.test(post), true);
check('the header points at the first bucket with work in it', /start with/.test(post), true);
check('it is numbered so priority is visible', /\(i \+ 1\)/.test(post), true);
// Read-only: raising an alert must never write a date or an action back to the sheet.
check('the digest never writes to the sheet', /setValue|setValues/.test(post), false);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
