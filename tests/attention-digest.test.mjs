/**
 * The 3pm work queue — Cherry's SECOND revision: five pipeline stages plus gifts.
 *
 *   node tests/attention-digest.test.mjs
 *
 * Her words: "notification should be like this only — Upcoming Visit / Completed Visit - Need next
 * course of action / Pending offer - ASAP / Offer Sent / Still negotiating (those leads that undecided
 * after the offer has been sent). Also we want to track sending gifts to them as part of follow up."
 *
 * This replaced a field-based structure (missing owner, missing next action, missing motivation…). The
 * five below answer "where is this deal and who owes it a move" instead of "which cell is empty",
 * which is what a manager reads a work queue for.
 *
 * These tests run the SHIPPED functions lifted out of ChatNotify.gs, not a copy of their rules, so
 * they cannot agree with themselves while disagreeing with what posts to Chat.
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
const slice = (from, to) => CHAT.slice(CHAT.indexOf(from), CHAT.indexOf(to));
/*
 * Starts at DIGEST_LINES_PER_SECTION rather than GIFT_SENT_VISIBLE_DAYS so that shortAddress_ and
 * clipReason_ — which decide how long a line reads on a phone — are inside the region proved identical.
 * They were added just above the old start marker, which left the preview free to print full addresses
 * while the card printed short ones.
 */
const source = slice('var DIGEST_LINES_PER_SECTION', '/**\n * Post the 3pm work queue');

/*
 * A FIXED today, so a gift's visibility window is tested rather than the wall clock. Without this, "sent
 * three days ago" quietly becomes "sent four days ago" overnight and the suite starts failing on its own.
 */
const TODAY_FIXED = new Date(2026, 7, 7);

const { attentionBucket_, giftPending_, excludedFromDigest_, digestMoney_, ATTENTION_BUCKETS,
  shortAddress_, clipReason_, DIGEST_REASON_MAX, timeCell_ } = new Function(
  'fmt_', 'CFG', 'today_',
  `${source}\nreturn { attentionBucket_, giftPending_, excludedFromDigest_, digestMoney_, ATTENTION_BUCKETS,
    shortAddress_, clipReason_, DIGEST_REASON_MAX, timeCell_ };`
)(
  (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
  { DIGEST_INCLUDE_IMPORTED: false },
  () => TODAY_FIXED
);

const TODAY = new Date(2026, 7, 5);              // Aug 5 2026, local midnight
const day = (y, m, d) => new Date(y, m - 1, d);
const bucket = (rec) => { const h = attentionBucket_(rec, TODAY); return h ? h.key : null; };
const reason = (rec) => { const h = attentionBucket_(rec, TODAY); return h ? h.reason : ''; };

/** A lead with a visit booked next week. Vary one field at a time from here. */
const BASE = {
  'Property Address': '1390 Estudillo Ave, San Leandro, CA 94577',
  'Seller Name': 'David Jackowitz',
  'Current Stage': 'Visit Scheduled',
  'Visit Status': 'Scheduled',
  'Visit Date': day(2026, 8, 12),
  'Assigned Owner': 'Juan'
};

console.log("=== Cherry's five stages, plus gifts — and one section she did not ask for ===");
/*
 * SEVEN sections now, and this is a deliberate departure from Cherry's sign-off that she needs to be told
 * about. She wrote "notification should be like this only" and named five stages plus gifts.
 *
 * The client then asked for cancelled visits to leave the visit list on their own: "the card should
 * automatic move as well where that should be move, it should be automated right?" Sara Davenport was
 * sitting under "Upcoming Visit — confirm the visit is going ahead" for a visit that had been called off,
 * so the section read as three visits coming up when one was off.
 *
 * It is inserted directly after Upcoming Visit rather than at the end, because it IS the visit list's
 * overflow — a reader who has just looked at what is coming up should see next what was called off.
 */
/*
 * EIGHT now, and the eighth came from Cherry herself, which is why it is not the departure the seventh was.
 *
 * "if there was lead is suddenly cancelled but not sure if the lead will go or what, should had a pending tab",
 * and about Jose: "this was for follow up, should move to follow up tab."
 *
 * OFF and UNKNOWN want opposite actions. Off means decide — rebook or close out. Unknown means find out, and
 * there is nothing to decide until somebody has spoken to the seller.
 */
check('eight buckets', ATTENTION_BUCKETS.length, 8);
check('in reading order', ATTENTION_BUCKETS.map((b) => b.title), [
  'Upcoming Visit',
  'Follow Up — Outcome Not Known Yet',
  'Cancelled — Close Out or Rebook',
  'Completed Visit — Needs Next Course of Action',
  'Pending Offer — ASAP',
  'Offer Sent',
  'Still Negotiating',
  'Gift Follow-Up'
]);
/* The five STAGE-driven buckets, which are still exactly Cherry's five. */
const STAGE_BUCKETS = ATTENTION_BUCKETS.filter((b) => b.stage);
check("Cherry's five stages are untouched", STAGE_BUCKETS.map((b) => b.stage), [
  'Visit Scheduled',
  'Visit Completed — Needs Review',
  'Offer Preparation',
  'Offer Sent',
  'Active Negotiation'
]);
/*
 * The two stage-less buckets are the ones that route on something else: gifts on Gift Status, cancellations
 * on Visit Status. Neither may name a stage, or a lead would land in two sections at once.
 */
check('gifts, follow-ups and cancellations are not tied to a stage',
  ATTENTION_BUCKETS.filter((b) => !b.stage).map((b) => b.key),
  ['pendingFollowUp', 'needsRebooking', 'giftFollowUp']);
check('every bucket names one action', ATTENTION_BUCKETS.every((b) => /\.$/.test(b.action)), true);
// The stages must be real values of the workbook's own dropdown, or a bucket can never fire.
const STAGES = (read('apps-script/Config.gs').match(/'Current Stage':\s*\[([^\]]+)\]/) || [])[1] || '';
check('every stage exists in the Current Stage dropdown',
  STAGE_BUCKETS.every((b) => STAGES.includes(`'${b.stage}'`)), true);

console.log('\n=== a TIME cell is rendered as a time ===');
/*
 * The card posted: "visit TODAY at Sat Dec 30 1899 16:00:00 GMT-0800".
 *
 * A time-only cell is a Date on the spreadsheet epoch — 30 December 1899 — and the reason line was doing
 * String() on it. The bug was always here; it only became visible once dates parsed, because until then no
 * line ever got as far as printing a time.
 */
check('a spreadsheet time Date', timeCell_(new Date(1899, 11, 30, 16, 0)), '4:00 PM');
check('...in the morning', timeCell_(new Date(1899, 11, 30, 10, 30)), '10:30 AM');
check('midnight is 12 AM', timeCell_(new Date(1899, 11, 30, 0, 5)), '12:05 AM');
check('noon is 12 PM', timeCell_(new Date(1899, 11, 30, 12, 0)), '12:00 PM');
/* The Sheets API sends a time as a fraction of a day. */
check('a fraction of a day', timeCell_(0.5), '12:00 PM');
check('...and a quarter past four', timeCell_(0.6875), '4:30 PM');
/* Text a person typed is normalised rather than reformatted into something else. */
check('text stays readable', timeCell_('10:30 AM'), '10:30 AM');
check('24-hour text becomes 12-hour', timeCell_('16:00'), '4:00 PM');
/* Nothing recognisable is returned untouched — an odd time tells the reader more than a blank. */
check('unparseable text is kept', timeCell_('TBC'), 'TBC');
check('blank stays blank', timeCell_(''), '');
check('null is safe', timeCell_(null), '');
/* And the whole line, which is what the client actually saw go wrong. */
check('the visit line reads properly',
  reason({ ...BASE, 'Visit Date': TODAY, 'Visit Time': new Date(1899, 11, 30, 16, 0) }),
  'visit TODAY at 4:00 PM');
check('no 1899 can reach the card',
  /1899/.test(reason({ ...BASE, 'Visit Date': TODAY, 'Visit Time': new Date(1899, 11, 30, 16, 0) })), false);
/* The rules must not go back to stringifying the cell. */
check('the reason line uses timeCell_', /var time = timeCell_\(rec\['Visit Time'\]\);/.test(source), true);

console.log('\n=== a date stored as TEXT is still a date ===');
/*
 * The preview reported "no visit date set — nothing is actually booked" for four leads, including Pam Long
 * booked for the next day and Jose Anguiano, whom the card had shown as OVERDUE that morning. The sheet was
 * right: Jose's row holds Visit Date 2026-08-01.
 *
 * dateCell_ took a Date — what Apps Script's getValues() returns for a real date cell — or a serial number,
 * and rejected everything else. But the automation WRITES dates as strings, so those cells are TEXT. Every
 * row the automation created rather than a person typing was invisible to every date rule here, in the LIVE
 * card as well as the preview. Asking the API for unformatted values did not help and could not: a text cell
 * is text however you request it.
 */
const dateBucket = (v) => bucket({ ...BASE, 'Visit Date': v });
const dateReason = (v) => reason({ ...BASE, 'Visit Date': v });
check('an ISO string, as the automation writes it', dateBucket('2026-08-12'), 'upcomingVisit');
check('...and it reads the right day', dateReason('2026-08-12'), 'visit Aug 12, 2026');
check('a US string, as the workbook formats it', dateBucket('08/12/2026'), 'upcomingVisit');
check('...and it reads the right day too', dateReason('08/12/2026'), 'visit Aug 12, 2026');
/* An ISO datetime, which is what a calendar-sourced value looks like. */
check('an ISO date with a time on it', dateReason('2026-08-12T14:30:00.000Z'), 'visit Aug 12, 2026');
/*
 * Built from the PARTS, never new Date(string). new Date("2026-08-01") is UTC midnight, which is July 31 for
 * anyone west of Greenwich — the same one-day shift that put a task on the wrong day once already. Jose's
 * Aug 1 must read as Aug 1, and as OVERDUE rather than as a visit still to come.
 */
check("Jose's Aug 1 reads as Aug 1, overdue",
  dateReason('2026-08-01'),
  'OVERDUE — visit was Aug 1, 2026 and is still marked Scheduled — nobody has recorded what happened');
check('...and lands in Follow Up', dateBucket('2026-08-01'), 'pendingFollowUp');
/* A serial and a real Date still work — this widened what is accepted, it did not replace it. */
check('a serial still works', dateBucket(46246), 'upcomingVisit');
check('a real Date still works', dateBucket(day(2026, 8, 12)), 'upcomingVisit');
/* And nothing that is not a date may become one. */
for (const junk of ['', '   ', 'TBC', 'not scheduled', 'n/a', '-']) {
  check(`"${junk}" is still no date`,
    /no visit date set/.test(dateReason(junk)), true);
}

console.log('\n=== 1. Upcoming Visit ===');
check('a visit booked for next week', bucket(BASE), 'upcomingVisit');
check('the reason gives the date', reason(BASE), 'visit Aug 12, 2026');
check("today's visit says TODAY", reason({ ...BASE, 'Visit Date': TODAY }), 'visit TODAY');
check('a time is included when there is one',
  reason({ ...BASE, 'Visit Date': TODAY, 'Visit Time': '11:00 AM' }), 'visit TODAY at 11:00 AM');
/*
 * Cherry's five have no "Visit Overdue" bucket. Dropping those leads silently would be the worst
 * outcome of simplifying, since a passed visit still marked Scheduled is the one line that means
 * something may have gone wrong with a seller. So it is called out INSIDE Upcoming Visit.
 */
/*
 * A passed visit is still surfaced, still flagged OVERDUE — and now in Follow Up rather than Upcoming Visit,
 * where it was sitting under "Confirm the visit is going ahead" for a visit whose date had gone. Jose Anguiano
 * read that way for five days. The reason says what is actually wanted: somebody has to find out.
 */
check('a passed visit stays visible, flagged OVERDUE',
  reason({ ...BASE, 'Visit Date': day(2026, 8, 1) }),
  'OVERDUE — visit was Aug 1, 2026 and is still marked Scheduled — nobody has recorded what happened');
check('...and it moves to Follow Up, out of the visit list',
  bucket({ ...BASE, 'Visit Date': day(2026, 8, 1) }), 'pendingFollowUp');
check("...while today's visit stays upcoming", bucket({ ...BASE, 'Visit Date': TODAY }), 'upcomingVisit');
check('...and so does one still to come', bucket(BASE), 'upcomingVisit');
check('...and is marked so it can be sorted to the top',
  attentionBucket_({ ...BASE, 'Visit Date': day(2026, 8, 1) }, TODAY).attention, true);
check('a future visit needs no attention flag', !!attentionBucket_(BASE, TODAY).attention, false);
/*
 * A lead with NO DATE is not an upcoming visit either, and the live board is what settled it: "UPCOMING VISITS
 * (SCHEDULED) 8" where all eight read NO DATE. A heading saying Scheduled over eight leads with nothing
 * scheduled is untrue, and the count is the part people act on.
 *
 * I had left these in Upcoming when the Follow Up section went in, arguing a missing date is a booking gap
 * rather than an unknown outcome. On the board that distinction does not survive: no date, no owner, no visit.
 */
check('no visit date at all is still surfaced',
  reason({ ...BASE, 'Visit Date': '' }), 'no visit date set — nothing is actually booked');
check('...and it goes to Follow Up, not Upcoming',
  bucket({ ...BASE, 'Visit Date': '' }), 'pendingFollowUp');
check('...so Upcoming Visit only ever holds a lead with a real future date',
  ['', null, undefined].map((v) => bucket({ ...BASE, 'Visit Date': v })),
  ['pendingFollowUp', 'pendingFollowUp', 'pendingFollowUp']);
// A Sheets serial must behave exactly like a real Date — the API writes serials.
check('a date serial works too', reason({ ...BASE, 'Visit Date': 46235 }).startsWith('OVERDUE'), true);

console.log('\n--- a cancelled visit is LISTED here, and says so ---');
/*
 * Cancelling does not move Current Stage (realignStage_ leaves it for a human to close out), so the
 * lead stays at Visit Scheduled and lands in this section. Reading it back is what found the bug: it
 * said "visit Aug 12, 2026" under "Confirm the visit is going ahead", and a cancelled visit whose date
 * had passed said "OVERDUE ... still marked Canceled". Removing it would be worse — a cancellation is
 * exactly what somebody has to act on.
 */
const canceled = { ...BASE, 'Visit Status': 'Canceled' };
/*
 * It used to stay in Upcoming Visit, flagged. The client asked for the card to move itself, and it now does:
 * out of the visit list and into its own section, driven by VISIT STATUS. Current Stage is untouched, so the
 * lead still cannot be quietly written off by a display rule.
 */
check('it moves itself out of Upcoming Visit', bucket(canceled), 'needsRebooking');
check('and reads as cancelled, not as a visit going ahead',
  reason(canceled), 'CANCELED — was booked for Aug 12, 2026 — rebook it or close the lead out');
check('a past cancelled visit is NOT called overdue',
  reason({ ...canceled, 'Visit Date': day(2026, 8, 1) }).startsWith('CANCELED'), true);
check('it sorts to the top of the section', attentionBucket_(canceled, TODAY).attention, true);
check('Reschedule Needed gets its own wording',
  reason({ ...BASE, 'Visit Status': 'Reschedule Needed' }),
  'RESCHEDULE NEEDED — was booked for Aug 12, 2026 — agree a new date with the seller');
check('a cancelled visit with no date still surfaces',
  reason({ ...canceled, 'Visit Date': '' }), 'CANCELED — rebook it or close the lead out');
// Once the lead is actually closed out it leaves the notification entirely — that is the exit.
check('closing the lead out removes it',
  bucket({ ...canceled, 'Current Stage': 'Lost / Closed Out' }), null);

console.log('\n=== 2. Completed Visit — Needs Next Course of Action ===');
const visited = { ...BASE, 'Current Stage': 'Visit Completed — Needs Review',
  'Visit Status': 'Completed', 'Visit Date': day(2026, 8, 1) };
check('lands in the decision bucket', bucket(visited), 'needsDecision');
check('the reason names the visit date', reason(visited), 'visited Aug 1, 2026, no offer decision recorded yet');
check('it copes with no visit date', reason({ ...visited, 'Visit Date': '' }), 'visited, no offer decision recorded yet');

console.log('\n=== 3. Pending Offer — ASAP ===');
const prep = { ...BASE, 'Current Stage': 'Offer Preparation', 'Visit Status': 'Completed' };
check('offer being prepared', bucket(prep), 'offerPending');
check('unpriced says so', reason(prep), 'offer not priced yet');
check('a priced but unsent offer shows the figure',
  reason({ ...prep, 'Approved Offer Amount': 450000 }), 'offer of $450,000 prepared but not sent');
check('money is formatted with separators', digestMoney_(1250000), '$1,250,000');
check('a zero offer is a real number', digestMoney_(0), '$0');
check('text passes through untouched', digestMoney_('TBD'), 'TBD');

console.log('\n=== 4. Offer Sent ===');
const sent = { ...BASE, 'Current Stage': 'Offer Sent', 'Visit Status': 'Completed',
  'Approved Offer Amount': 415000, 'Offer Sent Date': day(2026, 8, 1) };
check('an offer that is out', bucket(sent), 'offerSent');
check('the reason carries the figure and the date', reason(sent), '$415,000 · sent Aug 1, 2026');
check('a missing sent date is named, not hidden',
  reason({ ...sent, 'Offer Sent Date': '' }), '$415,000 · sent date not recorded');
check('silence since is added when known',
  reason({ ...sent, 'Days Since Last Activity': 6 }), '$415,000 · sent Aug 1, 2026 · no contact for 6 day(s)');

console.log('\n=== 5. Still Negotiating ===');
const negotiating = { ...BASE, 'Current Stage': 'Active Negotiation', 'Visit Status': 'Completed' };
check('an undecided lead after the offer', bucket(negotiating), 'negotiating');
check('with nothing recorded it says so', reason(negotiating), 'undecided since the offer went out');
check('a counter is shown', reason({ ...negotiating, 'Counteroffer Amount': 480000 }),
  'seller countered at $480,000');
check('what the seller said is included',
  reason({ ...negotiating, 'Counteroffer Amount': 480000, 'Last Contact Result': 'Wants to think it over' }),
  'seller countered at $480,000 · Wants to think it over');
check('a long note is clipped rather than filling the card',
  reason({ ...negotiating, 'Last Contact Result': 'x'.repeat(200) }).length <= 90, true);

console.log('\n=== 6. Gift Follow-Up — additive, the one place a lead can appear twice ===');
/*
 * Gifts are recommended at any stage, so making the gift compete with the stage buckets would hide
 * every gift behind the deal it belongs to. Sending a gift is a different job, often for a different
 * person, than deciding a counter-offer.
 */
check('a recommended gift is pending',
  giftPending_({ ...sent, 'Gift Status': 'Recommended' }), 'gift recommended — awaiting approval');
check('the reason and approver are named when present',
  giftPending_({ ...sent, 'Gift Status': 'Recommended', 'Gift Recommendation Reason': 'Visit went well',
    'Gift Approval Owner': 'Cherry' }),
  'gift recommended (Visit went well) — awaiting approval from Cherry');
check('an approved gift still needs sending',
  giftPending_({ ...sent, 'Gift Status': 'Approved', 'Gift Approved By': 'Cherry',
    'Gift Approval Date': day(2026, 8, 2) }),
  'gift approved by Cherry on Aug 2, 2026 — not sent yet');
check('approved AND sent is finished',
  giftPending_({ ...sent, 'Gift Status': 'Approved', 'Gift Sent Date': day(2026, 8, 3) }), '');
/*
 * 'Sent' used to be silent unconditionally. It now shows for GIFT_SENT_VISIBLE_DAYS as confirmation and then
 * drops off, and a Sent with no date is flagged as a data fault — the row claims the gift went out and cannot
 * say when, so nobody can tell whether it is overdue. Both are asserted in full further down.
 */
check('"Sent" long ago is finished',
  giftPending_({ ...sent, 'Gift Status': 'Sent', 'Gift Sent Date': day(2026, 1, 1) }), '');
check('"Not Reviewed" is not a commitment anyone made',
  giftPending_({ ...sent, 'Gift Status': 'Not Reviewed' }), '');
check('no gift status at all is silent', giftPending_(sent), '');
check('the lead keeps its stage bucket as well as the gift',
  bucket({ ...sent, 'Gift Status': 'Recommended' }), 'offerSent');
// An excluded lead owes nothing, gift included.
check('a closed-out lead owes no gift',
  giftPending_({ ...sent, 'Current Stage': 'Lost / Closed Out', 'Gift Status': 'Recommended' }), '');
// Every value of the Gift Status dropdown must be accounted for above.
const GIFTS = (read('apps-script/Config.gs').match(/'Gift Status':\s*\[([^\]]+)\]/) || [])[1] || '';
check('the dropdown has exactly the five values these rules cover',
  (GIFTS.match(/'/g) || []).length / 2, 5);

console.log('\n=== Leads that never appear ===');
check('Lost / Closed Out', bucket({ ...BASE, 'Current Stage': 'Lost / Closed Out' }), null);
check('Contract Signed', bucket({ ...BASE, 'Current Stage': 'Contract Signed' }), null);
check('a TEST row', bucket({ ...BASE, Source: 'TEST' }), null);
check('no property address', bucket({ ...BASE, 'Property Address': '' }), null);
check('a blank row', bucket({}), null);
check('the exclusion says which rule caught it',
  excludedFromDigest_({ ...BASE, 'Current Stage': 'Contract Signed' }), 'contract signed');
check('...and nothing for a live lead', excludedFromDigest_(BASE), '');

console.log('\n=== Stages deliberately left out — DECIDED, not pending ===');
/*
 * Cherry, asked directly and twice, re-sent her list with the workbook's full stage dropdown beside it:
 * "notification should be like this only" — the five stages, plus gifts. So Verbal Agreement, Contract
 * Sent and Long-Term Nurture appear in the 3pm message nowhere, and that is the decision rather than an
 * oversight.
 *
 * The consequence, in writing as the review asked: a lead where the seller has already said yes, or
 * where a contract is out for signature, will not appear in the daily work queue at all. Those leads
 * are visible on the dashboard (Contracts Possible This Week) and nowhere else. Reversing this means
 * changing these three lines on purpose.
 */
check('Verbal Agreement appears NOWHERE — decided',
  bucket({ ...BASE, 'Current Stage': 'Verbal Agreement' }), null);
check('Contract Sent appears NOWHERE — decided',
  bucket({ ...BASE, 'Current Stage': 'Contract Sent' }), null);
check('Long-Term Nurture appears NOWHERE — decided',
  bucket({ ...BASE, 'Current Stage': 'Long-Term Nurture' }), null);
// The dashboard is where those leads live instead, so that claim had better be true.
check('the dashboard still surfaces them',
  /\['Verbal Agreement','Contract Sent','Active Negotiation'\]/.test(read('apps-script/Dashboard.html')), true);
check('a blank stage appears nowhere', bucket({ ...BASE, 'Current Stage': '' }), null);
check('an unrecognised stage appears nowhere', bucket({ ...BASE, 'Current Stage': 'Dead Lead' }), null);
// But a gift is still chased at those stages, because the gift rule does not read the stage.
check('a nurture lead still owes its gift',
  giftPending_({ ...BASE, 'Current Stage': 'Long-Term Nurture', 'Gift Status': 'Approved' }),
  'gift approved — not sent yet');

console.log('\n=== One lead, one stage bucket ===');
// The five stages are mutually exclusive, so this is true by construction rather than by a tie-break.
const everyStage = STAGE_BUCKETS.map((b) => bucket({ ...BASE, 'Current Stage': b.stage }));
check('each stage lands in its own bucket', everyStage, STAGE_BUCKETS.map((b) => b.key));
check('no stage lands in two', new Set(everyStage).size, 5);
/*
 * And the cancelled section cannot be reached by a stage at all — only by Visit Status. Otherwise a lead
 * would appear twice: once for where it sits in the pipeline and once for being called off.
 */
check('no stage routes to the cancelled section', everyStage.includes('needsRebooking'), false);

console.log('\n=== The posted card ===');
const post = CHAT.slice(CHAT.indexOf('function sendAttentionDigestToChat'));
check('unassigned is spelled out', /UNASSIGNED/.test(post), true);
check('the owner is labelled', post.includes("Owner: '"), true);
check('the seller name is on the line', /rec\['Seller Name'\]/.test(post), true);
check('the address is on the line', /rec\['Property Address'\]/.test(post), true);
check('each bucket shows its count', /\(' \+ arr\.length \+ '\)/.test(post), true);
check('each bucket shows its action', /b\.action/.test(post), true);
check('decisions sort above ordinary upcoming visits', /if \(x\.attention !== y\.attention\) return x\.attention - y\.attention/.test(post), true);
check('then soonest visit first', /return a - c;/.test(post), true);
check('a dated line carries its sort key', /at: hit\.sort/.test(post), true);
check('gifts are counted separately from leads', /var leads = ATTENTION_BUCKETS\.reduce/.test(post), true);
check('the header reports leads and gifts apart', /' lead\(s\)' \+ \(gifts \?/.test(post), true);
check('the digest still writes nothing to the sheet', /setValue|setValues/.test(post), false);
check('it stays silent when there is nothing to do', /if \(!total\) \{/.test(post), true);

console.log('\n=== A cancelled visit KEEPS its calendar event, tagged ===');
/*
 * Cherry reversed this: "if the status of the calendar is cancelled it should not be removed in the
 * calendar and this will notify as well". A visit vanishing off Juan's day looks identical to it never
 * having been booked — nobody learns the seller cancelled, and no record survives that the slot was
 * held. So the event stays, tagged, with its reminders off, and a Chat alert goes out once.
 */
const WEB = read('apps-script/WebApp.gs');
check('Canceled is tagged, not deleted', /status === 'Canceled' \? 'CANCELED'/.test(WEB), true);
check('Reschedule Needed gets its own tag', /'RESCHEDULE NEEDED'/.test(WEB), true);
check('a closed-out lead is tagged too', /'CLOSED OUT'/.test(WEB), true);
check('the tag path never calls delete',
  /if \(tag\) \{[\s\S]{0,600}?markVisitEvents_/.test(WEB), true);
check('deletion is now ONLY for a row with no visit date',
  /if \(!visitDate\) \{\s*\n\s*var removed = deleteVisitEvents_/.test(WEB), true);

console.log('\n--- what tagging does to the event ---');
check('the title carries the tag', /e\.setTitle\(prefix \+ t\.replace/.test(WEB), true);
check('reminders are stripped so it cannot ping anyone', /removeAllReminders\(\)/.test(WEB), true);
check('the reason and date go into the description', /e\.setDescription\(/.test(WEB), true);
check('the event is never moved or re-dated',
  /markVisitEvents_[\s\S]{0,1800}?setTime|markVisitEvents_[\s\S]{0,1800}?setAllDayDate/.test(WEB), false);
check('an old tag is replaced rather than stacked', /replace\(\/\^\\\[\[A-Z \]\+\\\]/.test(WEB), true);

console.log('\n--- the alert fires once, and does NOT depend on finding an event ---');
/*
 * The bug behind "I cancelled it and nothing happened": the alert fired only when an event had just
 * been tagged. Most cancelled leads have no event — the old behaviour deleted it on cancel, and
 * maybeCreateVisitEvent_ refuses to create one for a past date — so there was no alert and no sign
 * anything had happened. A seller cancelling is news whether or not a calendar entry survived.
 */
check('the alert is keyed to the ROW, not to a tagged event',
  /if \(R\.getNote\('cancelAlert'\) !== tag\) \{/.test(WEB), true);
check('it no longer requires a tagged event', /if \(marked\.newlyTagged\)/.test(WEB), false);
check('the marker records WHICH tag, so Canceled after Reschedule alerts again',
  /R\.setNote\('cancelAlert', tag\)/.test(WEB), true);
check('re-booking clears the marker, so a later cancellation is fresh news',
  /if \(R\.getNote\('cancelAlert'\)\) R\.setNote\('cancelAlert', ''\)/.test(WEB), true);
check('the card says honestly when no event was found',
  /No calendar event was found for this visit, so there was nothing to tag/.test(WEB), true);
check('...and says it IS tagged when one was', /tagged \[' \+ tag \+ '\], with its reminders switched off/.test(WEB), true);
check('an already-tagged event still reports newlyTagged false', /newlyTagged: fresh > 0/.test(WEB), true);
check('the alert names the tag and says the event was kept',
  /tagged \[' \+ tag \+ '\], with its reminders switched off/.test(WEB), true);
check('it is silent with no webhook configured', /typeof chatWebhookUrl_ !== 'function' \|\| !chatWebhookUrl_\(\)/.test(WEB), true);

console.log('\n--- a SHEET edit syncs the calendar too, not just a dashboard edit ---');
/*
 * The client set a visit to Canceled and nothing happened anywhere: no tag, no alert, no change. The
 * cause was that syncVisitCalendar_ was only ever called from webAction, so cancelling on the dashboard
 * worked and cancelling by typing in the sheet did nothing — two ways to record the same fact with two
 * different outcomes, and the sheet is the one people actually use.
 */
const AUTO = read('apps-script/Automation.gs');
const DASH_SRC = read('apps-script/Dashboard.html');
check('the sheet-edit handler calls the calendar sync',
  /if \(typeof syncVisitCalendar_ === 'function'\) syncVisitCalendar_\(sh, row\);/.test(AUTO), true);
check('...on Visit Status', /header === 'Visit Status' \|\|/.test(AUTO), true);
check('...on Current Stage', /header === 'Current Stage' \|\|/.test(AUTO), true);
check('...and on Visit Date, so moving a visit moves the event',
  /header === 'Visit Date' \|\| header === 'Visit Time'/.test(AUTO), true);
check('it runs AFTER the row is flushed, so the sync reads the new value',
  AUTO.indexOf('R.flush();\n\n    /*') < AUTO.indexOf('syncVisitCalendar_(sh, row)'), true);
check('Canceled is recorded in the automation log',
  /v === 'Canceled' \|\| v === 'Reschedule Needed'/.test(AUTO), true);
/*
 * The stage must NOT be moved automatically — "the seller cancelled" and "we are done with this lead"
 * are different decisions and only one is safe to make without a person. Sliced to the branch body
 * exactly: a looser window ran into the 'Completed' branch below, which legitimately does set the stage.
 */
const cancelBranch = AUTO.slice(
  AUTO.indexOf("} else if (v === 'Canceled'"),
  AUTO.indexOf("} else if (v === 'Completed')")
);
check('the Canceled branch exists and is its own block', cancelBranch.length > 0, true);
check('cancelling does not set Current Stage', /R\.set\('Current Stage'/.test(cancelBranch), false);
check('cancelling writes nothing to the row at all', /R\.set\(/.test(cancelBranch), false);
check('...it only logs', /logAuto_\('INFO'/.test(cancelBranch), true);

console.log('\n--- the same change through any door gives the same outcome ---');
/*
 * Three ways to set Visit Status: type it in the sheet, edit the full record on the dashboard, or press
 * an action button. They used to behave differently — the form only wrote the cells, so the stage
 * cascade and the log line were skipped. All three now run onVisitStatus_ and sync the calendar.
 */
check('the full-record form runs the visit-status automation',
  /if \(params\['Visit Status'\] !== undefined\) runHandler_\(onVisitStatus_, sh, rowNum\);/.test(WEB), true);
check('...and the stage automation when the stage is edited',
  /else if \(params\['Current Stage'\] !== undefined\) runHandler_\(onStageManual_, sh, rowNum\);/.test(WEB), true);
check('an edit touching neither still syncs the calendar',
  /else syncVisitCalendar_\(sh, rowNum\);/.test(WEB), true);
check('runHandler_ syncs the calendar itself, so it is not done twice',
  /function runHandler_[\s\S]{0,200}?syncVisitCalendar_\(sh, rowNum\);/.test(WEB), true);
check('Visit Status is editable on the dashboard, with Canceled in the list',
  /'Visit Status':\['','Scheduled','Completed','Canceled','Reschedule Needed'\]/.test(DASH_SRC), true);
check('...and is not in the read-only list', /RO_FIELDS=\[[^\]]*'Visit Status'/.test(DASH_SRC), false);

console.log('\n--- one matcher, so tag and delete cannot disagree ---');
check('a shared findVisitEvents_ exists', /function findVisitEvents_\(cal, addr, visitDate\)/.test(WEB), true);
check('deleteVisitEvents_ uses it', /function deleteVisitEvents_[\s\S]{0,400}?findVisitEvents_\(cal/.test(WEB), true);
check('markVisitEvents_ uses it', /function markVisitEvents_[\s\S]{0,700}?findVisitEvents_\(cal/.test(WEB), true);
check('it matches this script\'s title format', /\^Property Visit\\b/.test(WEB), true);
// Critical: once tagged, the title starts "[CANCELED] Property Visit …". Without stripping the tag
// before matching, a re-booked visit would leave the cancelled copy on the calendar forever.
check('it strips any tag before matching, so a re-book still finds the old copy',
  /var t = String\(e\.getTitle\(\) \|\| ''\)\.replace/.test(WEB), true);
check('the sync still runs after every dashboard action',
  /function runHandler_[\s\S]{0,400}syncVisitCalendar_/.test(WEB), true);

console.log('\n=== The preview script cannot disagree with what ships ===');
/*
 * scripts/preview-3pm-digest.mjs prints the notification from the live sheet so Cherry can approve the
 * design before rollout. It carries a copy of the rules because it runs in the Node sandbox, which has
 * no access to the .gs files — so the copy has to be provably identical, or the thing she approves is
 * not the thing that ships.
 */
const PREVIEW = read('twin-visit-logger-sandbox/scripts/preview-3pm-digest.mjs');
check('the preview carries the rules verbatim', PREVIEW.includes(source.trim()), true);
check('it is marked as a copy, not a second implementation', /VERBATIM FROM apps-script\/ChatNotify\.gs/.test(PREVIEW), true);
check('it posts nothing to Chat', /chatPost_|UrlFetchApp/.test(PREVIEW), false);
check('it writes nothing to the sheet', /values\.update|values\.append|batchUpdate/.test(PREVIEW), false);
check('it counts gifts apart from leads too', /const gifts = found\.giftFollowUp\.length/.test(PREVIEW), true);
/*
 * The preview must read the sheet in the SHAPE the rules expect.
 *
 * dateCell_ accepts a Date — what Apps Script's getValues() returns — or a serial number, and rejects a
 * string. The API's default is FORMATTED_VALUE, which hands back "2026-08-01", so every lead read "no visit
 * date set — nothing is actually booked": Upcoming Visit showed 0 on a day with a visit booked for tomorrow.
 * Carrying the rules verbatim is not enough if they are fed a different shape of value.
 */
check('the preview asks for unformatted values',
  /valueRenderOption: 'UNFORMATTED_VALUE'/.test(PREVIEW), true);
check('...and dates as serial numbers',
  /dateTimeRenderOption: 'SERIAL_NUMBER'/.test(PREVIEW), true);
/* dateCell_ handles exactly those two shapes, and that is why the option above is the right fix. */
check('dateCell_ takes a Date or a serial, not a string',
  /if \(raw instanceof Date\)[\s\S]{0,120}typeof raw === 'number'/.test(CHAT), true);
/*
 * Every Script Property the copied rules read must be DEFINED in the preview.
 *
 * In Apps Script CFG comes from Config.gs. The preview has no Config.gs, so it has to supply one — and did
 * not, so the script died with "CFG is not defined" the first time it was pointed at the live sheet. A
 * missing key is worse than a crash: it would read as undefined and quietly flip a rule.
 */
const cfgKeys = [...new Set([...source.matchAll(/CFG\.([A-Z_]+)/g)].map((m) => m[1]))];
check('the rules read at least one Script Property', cfgKeys.length > 0, true);
for (const key of cfgKeys) {
  check(`the preview defines CFG.${key}`, new RegExp(`${key}\\s*:`).test(PREVIEW), true);
  /* And with the same value the workbook uses, or the preview approves a card that is not the one shipping. */
  const inConfig = (read('apps-script/Config.gs').match(new RegExp(`${key}\\s*:\\s*([^,\n]+)`)) || [])[1];
  const inPreview = (PREVIEW.match(new RegExp(`${key}\\s*:\\s*([^,\n/]+)`)) || [])[1];
  check(`...with Config.gs's value (${String(inConfig).trim()})`,
    String(inPreview).trim(), String(inConfig).trim());
}

console.log('\n=== The file people paste has no duplicate function names ===');
/*
 * Apps Script puts every file in one global scope, so two functions of the same name resolve to
 * whichever loads last — silently. This digest defined its own money_ alongside an existing one with
 * different behaviour (that one returns '' for zero, this returns '$0'), which made the offer-prep task
 * text depend on file order. Renamed to digestMoney_; this check stops the next one.
 */
const COMBINED = read('apps-script/Code.combined.gs');
const fnNames = COMBINED.match(/^function [A-Za-z0-9_]+\s*\(/gm).map((m) => m.slice(9).replace(/\s*\($/, ''));
const dupes = [...new Set(fnNames.filter((n, i) => fnNames.indexOf(n) !== i))];
check('no function is defined twice in Code.combined.gs', dupes, []);
check('the digest uses its own money formatter', /function digestMoney_\(v\)/.test(COMBINED), true);
check('...and does not redefine the existing money_', (COMBINED.match(/^function money_/gm) || []).length, 1);

console.log('\n=== Imported history stays OUT of the work queue ===');
/*
 * The first live run posted 103 leads, nearly all reading "Owner: UNASSIGNED · no visit date set" or
 * "no contact for 131 day(s)" — the rows imported from the old workbook. That fails the one thing
 * Cherry asked for, and it fails it on volume rather than on the categories.
 *
 * Source = 'Import' is the exact signature: importFromOldWorkbook stamps it and nothing else does
 * (the dashboard writes 'Manual', the REI intake writes 'Intake'). So no cutover date is invented,
 * and no live lead is caught by accident. The rows stay in the sheet and on the dashboard.
 */
check('an imported row is excluded', bucket({ ...BASE, Source: 'Import' }), null);
check('...and the reason says why',
  excludedFromDigest_({ ...BASE, Source: 'Import' }), 'imported history (pre-cutover)');
/*
 * A gift is the exception, and only a gift.
 *
 * The volume argument above is about 373 leads all claiming attention at once. It does not apply to a gift:
 * money is already spent on a named seller, and the tracker only began in July, so a lead far enough along
 * to be sent a gift is imported almost by definition. Excluding Import here was removing the section's
 * whole subject matter — checked against the live sheet, where it was hiding Rob Walker's basket.
 */
check('an imported row DOES still owe a gift',
  giftPending_({ ...BASE, Source: 'Import', 'Gift Status': 'Recommended', 'Gift Approval Owner': 'Cherry' }),
  'gift recommended — awaiting approval from Cherry');
check('...while its stage bucket stays excluded', bucket({ ...BASE, Source: 'Import' }), null);
check('a dashboard-added lead is NOT excluded', bucket({ ...BASE, Source: 'Manual' }), 'upcomingVisit');
check('a REI intake lead is NOT excluded', bucket({ ...BASE, Source: 'Intake' }), 'upcomingVisit');
check('a scraper lead with no Source is NOT excluded', bucket({ ...BASE, Source: '' }), 'upcomingVisit');
// The flag must be able to put them back without touching the rules.
const withImported = new Function('fmt_', 'CFG',
  `${source}\nreturn { attentionBucket_ };`
)((d) => String(d), { DIGEST_INCLUDE_IMPORTED: true }).attentionBucket_;
check('CFG.DIGEST_INCLUDE_IMPORTED = true puts them back',
  !!withImported({ ...BASE, Source: 'Import' }, TODAY), true);
check('the flag is declared in Config.gs',
  /DIGEST_INCLUDE_IMPORTED: false/.test(read('apps-script/Config.gs')), true);

console.log('\n=== Upcoming Visit is ordered by how soon the visit is ===');
/*
 * Cherry: "it should be prioritized, the upcoming visit by its date that near to visit". Before this
 * the section came out in sheet order, so a visit three weeks away could sit above tomorrow's.
 */
const at = (rec) => attentionBucket_(rec, TODAY).sort;
check("today's visit sorts before next week's",
  at({ ...BASE, 'Visit Date': TODAY }) < at({ ...BASE, 'Visit Date': day(2026, 8, 12) }), true);
check('an undated visit sorts last', at({ ...BASE, 'Visit Date': '' }), Infinity);
check('a date serial produces the same key as a real Date',
  at({ ...BASE, 'Visit Date': 46235 }), at({ ...BASE, 'Visit Date': day(2026, 8, 1) }));
// The sort must run over the whole section, and decisions must still win over date.
const order = [
  { ...BASE, 'Visit Date': day(2026, 8, 20) },                       // furthest out
  { ...BASE, 'Visit Date': day(2026, 8, 6) },                        // tomorrow
  { ...BASE, 'Visit Date': day(2026, 8, 1) },                        // overdue
  { ...BASE, 'Visit Date': day(2026, 8, 7), 'Visit Status': 'Canceled' }
].map((r) => attentionBucket_(r, TODAY))
  .sort((x, y) => (x.attention ? 0 : 1) - (y.attention ? 0 : 1) || x.sort - y.sort)
  .map((h) => h.reason.slice(0, 12));
check('overdue and cancelled first, then soonest',
  order, ['OVERDUE — vi', 'CANCELED — w', 'visit Aug 6,', 'visit Aug 20']);

console.log('\n=== A line short enough to scan on a phone ===');
/*
 * The client: "we need to lessen in the notf." The line that prompted it was
 *
 *   Jose Anguiano · 2145 Capitol Ave, East Palo Alto, CA, 94303, UNITED STATES · Owner: Juan · OVERDUE …
 *
 * and half of it is postcode, state and country. This is the same complaint as the five-per-section cap
 * below — the message is unreadable when it is long — so the two are tested together.
 */
check('country, state and postcode come off the end',
  shortAddress_('2145 Capitol Ave, East Palo Alto, CA, 94303, UNITED STATES'),
  '2145 Capitol Ave, East Palo Alto');
check('state and postcode written as one part come off too',
  shortAddress_('492 Umland Dr, Santa Rosa, CA 95401'), '492 Umland Dr, Santa Rosa');
check('ZIP+4 is recognised', shortAddress_('1 Main St, Reno, NV, 89501-1234'), '1 Main St, Reno');
/*
 * Only from the END, and only parts that ARE one of those things. A flat number is part of the address —
 * dropping it would send somebody to the wrong door, which is worse than a long line.
 */
check('a flat number is kept',
  shortAddress_('340 Vallejo Dr, Apt 83, Millbrae, CA, 94030'), '340 Vallejo Dr, Apt 83, Millbrae');
check('an address in any other shape is left alone',
  shortAddress_('1390 Estudillo Ave, San Leandro'), '1390 Estudillo Ave, San Leandro');
check('a one-part address survives', shortAddress_('94303'), '94303');
check('a blank stays blank', shortAddress_(''), '');
/* Real rows from the tracker, so this is not only tested against addresses I invented. */
check('the tracker\'s own rows shorten as expected', [
  shortAddress_('1390 Estudillo Ave, San Leandro, CA 94577'),
  shortAddress_('7331 Terrace Dr, El Cerrito, CA, 94530, UNITED STATES')
], ['1390 Estudillo Ave, San Leandro', '7331 Terrace Dr, El Cerrito']);

/*
 * The reason is one line of a scan, not a paragraph. REI notes run to hundreds of characters and one of
 * them wraps to five lines on a phone, pushing the sections below it off the screen entirely.
 */
check('a short reason is untouched', clipReason_('visit Aug 12, 2026'), 'visit Aug 12, 2026');
const longReason = 'Seller called back after the walkthrough and said the family are still discussing whether to sell now or wait until the spring market improves, and wants another offer';
const clipped = clipReason_(longReason);
check('a long one is cut to the limit', clipped.length <= DIGEST_REASON_MAX, true);
check('...and marked as cut', /…$/.test(clipped), true);
/*
 * Cut at a word boundary — a reason ending mid-word reads like the message itself broke. The proof is that
 * the kept text is a prefix of the original and the original's very next character is a space, so no word
 * was sliced through.
 */
const kept = clipped.slice(0, -1);
check('...at a word boundary',
  longReason.startsWith(kept) && /\s/.test(longReason.charAt(kept.length)), true);
check('...keeping the front of the sentence', clipped.startsWith('Seller called back after the walkthrough'), true);
/* Newlines in a note would otherwise break the card's line structure entirely. */
check('newlines collapse to spaces', clipReason_('called seller\n\n  no answer'), 'called seller no answer');
check('a blank reason stays blank', clipReason_(''), '');

console.log('\n=== Five leads per section, not eight ===');
/*
 * Cherry: "it only should have 5 person or lead should be included". Eight pushed the later sections
 * off a phone screen entirely, which defeats the message. The heading count stays the TRUE total, so
 * shortening the list hides nothing — the section says "…and N more" itself.
 */
check('the cap is declared once, as a constant', /var DIGEST_LINES_PER_SECTION = 5;/.test(CHAT), true);
check('the list is sliced to it', /arr\.slice\(0, DIGEST_LINES_PER_SECTION\)/.test(post), true);
check('the overflow line counts from the same constant',
  /arr\.length - DIGEST_LINES_PER_SECTION\) \+ ' more'/.test(post), true);
check('no bare 8 is left behind in the digest', /slice\(0, 8\)|length > 8/.test(post), false);
// The heading must show the real total, or a capped section would under-report the work.
check('the heading counts every lead, not just the listed ones',
  /\(' \+ arr\.length \+ '\)/.test(post), true);
check('the preview uses the same cap',
  /arr\.slice\(0, DIGEST_LINES_PER_SECTION\)/.test(read('twin-visit-logger-sandbox/scripts/preview-3pm-digest.mjs')), true);
/* Defining the shorteners is not the same as calling them — the card and the preview must both do it. */
check('the card shortens the address', /shortAddress_\(rec\['Property Address'\]\)/.test(post), true);
check('...and clips the reason', /clipReason_\(reason\)/.test(post), true);
const PREVIEW_LINE = read('twin-visit-logger-sandbox/scripts/preview-3pm-digest.mjs');
check('the preview shortens the address too',
  /address: shortAddress_\(rec\['Property Address'\]\)/.test(PREVIEW_LINE), true);
check('...and clips the reason too', /reason: clipReason_\(reason\)/.test(PREVIEW_LINE), true);

console.log('\n=== The work queue posts TWICE a day ===');
/*
 * The client: "we will update start from shift before lunch and then few hours before we go home the
 * notif." It posted once, at 3pm.
 *
 * 11am and 3pm. The first lands while there is still a morning left to act in -- a visit confirmed at 11
 * can still be rearranged, the same news at 3 cannot. The second is late enough to reflect the day's work
 * and early enough that somebody can still make a call before leaving.
 */
const COMBINED_H = fs.readFileSync(new URL('../apps-script/Code.combined.gs', import.meta.url), 'utf8');
check('the two hours are declared in one place', /var DIGEST_HOURS = \[11, 15\];/.test(COMBINED_H), true);
check('a trigger is created for each', /DIGEST_HOURS\.forEach\(function \(h\) \{[\s\S]*?\.atHour\(h\)\.create\(\);/.test(COMBINED_H), true);
// Installing twice must not leave four triggers behind: the old ones are cleared first.
check('existing triggers are cleared before installing',
  COMBINED_H.indexOf("if (t.getHandlerFunction() === 'sendAttentionDigestToChat') ScriptApp.deleteTrigger(t);")
    < COMBINED_H.indexOf('DIGEST_HOURS.forEach'), true);
check('the toast names both times, not one', /posts daily in the ' \+ when \+ ' hours/.test(COMBINED_H), true);
check('the menu says both times', /Turn ON work-queue digest \(11am \+ 3pm\)/.test(COMBINED_H), true);
check('turning it off still removes every one of them',
  /function removeChatAttentionTrigger\(\)[\s\S]*?getProjectTriggers\(\)\.forEach/.test(COMBINED_H), true);
/*
 * Apps Script fires a daily trigger somewhere inside the named hour, not on the minute. Saying so in the
 * code stops the next person treating an 11:40 arrival as a bug.
 */
check('the hour-not-minute behaviour is written down',
  /somewhere inside the named hour/.test(COMBINED_H), true);
check('...and so is whose timezone applies', /SPREADSHEET'S timezone/.test(COMBINED_H), true);
// Both firings run the same function, so neither can drift into a different format.
check('both times run the same digest function',
  (COMBINED_H.match(/newTrigger\('sendAttentionDigestToChat'\)/g) || []).length, 1);

console.log('\n=== A cancelled visit MOVES itself out of Upcoming Visit ===');
/*
 * The client: "the card should automatic move as well where that should be move, it should be automated
 * right?"
 *
 * Sara Davenport sat under "Upcoming Visit — confirm the visit is going ahead" for a visit that had been
 * called off, so the section read as three visits coming up when one was off. The distinction that makes
 * automating this safe is between MOVING a card and CLOSING a deal: the move is driven by Visit Status,
 * which REI and the team both set, while Current Stage — the field that decides whether a lead is dead — is
 * still only ever moved by a person.
 */
const CHAT_C = fs.readFileSync(new URL('../apps-script/Code.combined.gs', import.meta.url), 'utf8');
check('there is a section for them', /title: 'Cancelled — Close Out or Rebook'/.test(CHAT_C), true);
check('...and it tells you both options',
  /Agree a new date with the seller, or move the lead to Lost \/ Closed Out\./.test(CHAT_C), true);
check('a cancelled visit is routed there, not to its stage bucket',
  /if \(status === 'Canceled'\) \{\s*\n\s*return \{ key: 'needsRebooking'/.test(CHAT_C), true);
/*
 * Reschedule-needed goes to FOLLOW UP, not Cancelled — Cherry's own split. "Called off but still wanted" is a
 * lead whose outcome nobody knows yet, and the job there is to find out; Cancelled is where a decision is owed.
 */
check('...while reschedule-needed goes to Follow Up',
  /if \(status === 'Reschedule Needed'\) \{\s*\n\s*return \{ key: 'pendingFollowUp'/.test(CHAT_C), true);
check('...and so does an overdue visit, which is what Cherry asked for by name',
  /if \(on < today\) \{\s*\n\s*return \{ key: 'pendingFollowUp'/.test(CHAT_C), true);
/*
 * The safety line: nothing here writes Current Stage. Moving a card is a display decision; closing a lead
 * out is a business one, and the automation still refuses the second.
 */
check('the move never rewrites Current Stage',
  /key: 'needsRebooking'[\s\S]{0,400}Current Stage'\] =/.test(CHAT_C), false);

console.log('\n--- and the dashboard moves it the same way ---');
/*
 * Both views must tell the same story about one lead. A card that has left Upcoming Visit on the 3pm
 * message but still sits in it on the board is worse than neither moving.
 */
const DASH_C = fs.readFileSync(new URL('../apps-script/Dashboard.html', import.meta.url), 'utf8');
check('Upcoming Visits excludes cancelled',
  /r\.stage==='Visit Scheduled' && r\.visitStatus!=='Canceled' && r\.visitStatus!=='Reschedule Needed'/.test(DASH_C), true);
check('...and requires a real date that has not passed',
  /&& !!r\.visitDate && r\.visitDate >= todayISO\(\)/.test(DASH_C), true);
check('...while Follow Up takes both the undated and the passed',
  /\(!r\.visitDate \|\| r\.visitDate < todayISO\(\)\)/.test(DASH_C), true);
check('...and there is a section to receive the cancelled',
  /\['Cancelled — Close Out or Rebook',function\(r\)\{/.test(DASH_C), true);
check('...and one for the unknowns', /\['Follow Up — Outcome Not Known Yet',function\(r\)\{/.test(DASH_C), true);
/*
 * Both views must tell the same story about one lead, so the SECTION NAMES are asserted identical. A lead in
 * Follow Up on the 3pm card and in Upcoming Visits on the board is worse than neither moving.
 */
for (const title of ['Follow Up — Outcome Not Known Yet', 'Cancelled — Close Out or Rebook']) {
  check(`"${title}" is worded identically in both views`,
    CHAT_C.includes(title) && DASH_C.includes(title), true);
}
check('...and the old combined heading is gone from both',
  /Cancelled — Rebook or Close Out/.test(CHAT_C) || /Cancelled — Rebook or Close Out/.test(DASH_C), false);

console.log('\n=== A gift shows even on a lead the stage sections have finished with ===');
/*
 * "THE GIFT IS NOT INCLUDED?" — no, and it was a bug introduced the same day.
 *
 * Rob Walker is Contract Signed. excludedFromDigest_ drops that stage, and giftPending_ deferred to it
 * wholesale. So the moment Contract Signed leads became re-checkable and their gifts started reaching the
 * sheet, the one section that exists to track gifts could not show them.
 *
 * Gifts follow a deal PAST its stage — Rob's is a post-signing apology basket — so the stage exclusions do
 * not apply here. Gift Follow-Up is already the one section where a lead may appear twice, which makes
 * ignoring stage consistent rather than a special case.
 */
const giftSrc = CHAT.slice(CHAT.indexOf('function giftPending_'), CHAT.indexOf('\n}\n', CHAT.indexOf('function giftPending_')) + 3);
const giftPending = new Function('CFG', 'dateCell_', 'fmt_', 'today_', 'GIFT_SENT_VISIBLE_DAYS',
  `${giftSrc}\nreturn giftPending_;`)(
  { DIGEST_INCLUDE_IMPORTED: false },
  (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; },
  (d) => new Date(d).toISOString().slice(0, 10),
  () => new Date('2026-08-07T00:00:00Z'),
  3
);
const SIGNED = { 'Property Address': '492 Umland Dr', Source: 'Intake', 'Current Stage': 'Contract Signed' };
check('a gift awaiting approval shows on a SIGNED contract',
  giftPending({ ...SIGNED, 'Gift Status': 'Recommended', 'Gift Approval Owner': 'Cherry' }),
  'gift recommended — awaiting approval from Cherry');
check('so does one approved but not sent',
  giftPending({ ...SIGNED, 'Gift Status': 'Approved', 'Gift Approved By': 'Cherry', 'Gift Approval Date': '2026-08-05' }),
  'gift approved by Cherry on 2026-08-05 — not sent yet');
/* The exclusions that DO still hold are about the row, not its stage. */
check('a test row is still excluded', giftPending({ ...SIGNED, Source: 'TEST', 'Gift Status': 'Recommended' }), '');
check('a row with no address is still excluded — nowhere to send it',
  giftPending({ 'Gift Status': 'Recommended' }), '');

/*
 * Rob Walker's row, exactly as the live sheet holds it after the re-check wrote his gift.
 *
 * Three separate exclusions had to come off before this line could appear: the Contract Signed stage, the
 * Import source, and — still outstanding — REI never gave up a delivery date, so the section says so
 * instead of inventing one. This is the regression test for all three at once.
 */
check('Rob Walker, live: imported, signed, sent, no date',
  giftPending({
    'Property Address': '492 Umland Dr, Santa Rosa, CA 95401',
    Source: 'Import',
    'Current Stage': 'Contract Signed',
    'Gift Status': 'Sent',
    'Gift Sent Date': '',
    'Gift Recommendation Reason': 'Gift ordered in REI — Gourmet Get-Together Gift Basket · order #104240205',
    'Gift Approval Owner': 'Juan',
    'Gift Approved By': 'Cherry',
    'Gift Approval Date': '08/05/2026'
  }),
  'gift marked Sent but no Gift Sent Date recorded');

console.log('\n--- a gift SENT is shown briefly, then drops off by itself ---');
/*
 * The section is a work queue and a sent gift needs no action, so listing every gift ever sent would grow it
 * forever and bury the ones still waiting on somebody. But Cherry asked to "track sending gifts to them as
 * part of follow up", and a tracker that only ever shows what has NOT happened is half a tracker. Three days
 * is the compromise: seen on at least one 11am and one 3pm card, gone before it becomes a ledger.
 */
check("Rob's gift, sent yesterday, is shown",
  giftPending({ ...SIGNED, 'Gift Status': 'Sent', 'Gift Sent Date': '2026-08-06',
    'Gift Recommendation Reason': 'Gourmet Get-Together Gift Basket' }),
  'gift SENT 2026-08-06 — Gourmet Get-Together Gift Basket — nothing to do, for your awareness');
check('...and says plainly that nothing is needed',
  /nothing to do, for your awareness/.test(giftPending({ ...SIGNED, 'Gift Status': 'Sent', 'Gift Sent Date': '2026-08-06' })), true);
check('a gift sent ten days ago has dropped off',
  giftPending({ ...SIGNED, 'Gift Status': 'Sent', 'Gift Sent Date': '2026-07-28' }), '');
// A future date is a delivery still to happen, not a lapse.
check('a gift out for delivery reads as such',
  giftPending({ ...SIGNED, 'Gift Status': 'Sent', 'Gift Sent Date': '2026-08-09' }),
  'gift out for delivery on 2026-08-09');
/*
 * Sent with no date is a data fault worth surfacing: the row claims the gift went out and cannot say when,
 * so nobody can tell whether it is overdue.
 */
check('Sent with no date is flagged rather than hidden',
  giftPending({ ...SIGNED, 'Gift Status': 'Sent', 'Gift Sent Date': '' }),
  'gift marked Sent but no Gift Sent Date recorded');
check('Not Reviewed is not a to-do', giftPending({ ...SIGNED, 'Gift Status': 'Not Reviewed' }), '');
check('no gift status at all is silent', giftPending({ ...SIGNED }), '');
check('the visibility window is one named constant',
  /var GIFT_SENT_VISIBLE_DAYS = 3;/.test(CHAT), true);

console.log('\n--- the card does not tell you a sent gift was ordered ---');
/*
 * The real line was "gift SENT Aug 4, 2026 — Gift ordered in REI — ordered 08/04/2026 — nothing to do",
 * which says "gift ordered in REI" to somebody who has just been told the gift was sent. The reason column
 * carries that prefix because it has to stand alone in the sheet; on the card it is noise.
 */
const sentWithPrefix = giftPending({ ...SIGNED, 'Gift Status': 'Sent', 'Gift Sent Date': '2026-08-06',
  'Gift Recommendation Reason': 'Gift ordered in REI — moving-supplies gift · $48.32' });
check('the prefix is stripped', /Gift ordered in REI/.test(sentWithPrefix), false);
check('...but what the gift WAS survives', /moving-supplies gift · \$48\.32/.test(sentWithPrefix), true);
check('the whole line reads cleanly', sentWithPrefix,
  'gift SENT 2026-08-06 — moving-supplies gift · $48.32 — nothing to do, for your awareness');
/* A reason a person wrote has no prefix to strip and must come through untouched. */
check("a person's own wording is untouched",
  giftPending({ ...SIGNED, 'Gift Status': 'Sent', 'Gift Sent Date': '2026-08-06',
    'Gift Recommendation Reason': 'Cherry sent flowers after the walkthrough' }),
  'gift SENT 2026-08-06 — Cherry sent flowers after the walkthrough — nothing to do, for your awareness');
/* Nothing but the prefix leaves no dangling dash. */
check('a reason that is only the prefix leaves no empty clause',
  giftPending({ ...SIGNED, 'Gift Status': 'Sent', 'Gift Sent Date': '2026-08-06',
    'Gift Recommendation Reason': 'Gift ordered in REI —' }),
  'gift SENT 2026-08-06 — nothing to do, for your awareness');

console.log('\n--- the sent line does not print the same date twice ---');
/*
 * The client, on a real line: "gift SENT 2026-08-04 — ordered 08/04/2026 — nothing to do, for your awareness."
 * That is one date in two formats, and it never says what was sent. The column keeps the order date — ordered
 * and delivered are different facts — but a card that already leads with the sent date does not need it.
 */
check('an order date on the end is dropped',
  giftPending({ ...SIGNED, 'Gift Status': 'Sent', 'Gift Sent Date': '2026-08-06',
    'Gift Recommendation Reason': 'Gift ordered in REI — moving-supplies gift · $48.32 · ordered 08/04/2026' }),
  'gift SENT 2026-08-06 — moving-supplies gift · $48.32 — nothing to do, for your awareness');
/* Marlene's, exactly as the sheet holds it: prefix plus order date and nothing else in between. */
check('a reason that is ONLY prefix and order date leaves a clean line',
  giftPending({ ...SIGNED, 'Gift Status': 'Sent', 'Gift Sent Date': '2026-08-04',
    'Gift Recommendation Reason': 'Gift ordered in REI — ordered 08/04/2026' }),
  'gift SENT 2026-08-04 — nothing to do, for your awareness');
/* An order date in the MIDDLE is not touched — only a trailing clause is noise. */
check('a date that is part of the description survives',
  /ordered 08\/04\/2026/.test(giftPending({ ...SIGNED, 'Gift Status': 'Sent', 'Gift Sent Date': '2026-08-06',
    'Gift Recommendation Reason': 'Gift ordered in REI — ordered 08/04/2026 · basket' })), true);

console.log('\n=== the preview prints the same dates the card does ===');
/*
 * The preview exists so Cherry can see exactly what will post. It was formatting dates as "Aug 4, 2026" while
 * the workbook's fmt_ produces "2026-08-04", so on every date it was showing something the card would not —
 * and the client spotted it on a real line before I did.
 */
const PREVIEW_SRC = read('twin-visit-logger-sandbox/scripts/preview-3pm-digest.mjs');
check("the workbook's fmt_ is yyyy-MM-dd",
  /function fmt_\(d\)[^\n]*'yyyy-MM-dd'/.test(read('apps-script/Code.combined.gs')), true);
check('...and the preview matches it', /\$\{x\.getFullYear\(\)\}-\$\{String\(x\.getMonth\(\) \+ 1\)/.test(PREVIEW_SRC), true);
check('...and no longer prints a month name', /month: 'short'/.test(PREVIEW_SRC), false);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
