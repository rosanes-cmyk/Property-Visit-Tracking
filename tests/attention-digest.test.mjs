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
const source = slice('var ATTENTION_BUCKETS = [', '/**\n * Post the 3pm work queue');

const { attentionBucket_, giftPending_, excludedFromDigest_, digestMoney_, ATTENTION_BUCKETS } = new Function(
  'fmt_', 'CFG',
  `${source}\nreturn { attentionBucket_, giftPending_, excludedFromDigest_, digestMoney_, ATTENTION_BUCKETS };`
)(
  (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
  { DIGEST_INCLUDE_IMPORTED: false }
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

console.log("=== Cherry's five stages, plus gifts, in her order ===");
check('six buckets', ATTENTION_BUCKETS.length, 6);
check('in her reading order', ATTENTION_BUCKETS.map((b) => b.title), [
  'Upcoming Visit',
  'Completed Visit — Needs Next Course of Action',
  'Pending Offer — ASAP',
  'Offer Sent',
  'Still Negotiating',
  'Gift Follow-Up'
]);
check('each of the five names one stage', ATTENTION_BUCKETS.slice(0, 5).map((b) => b.stage), [
  'Visit Scheduled',
  'Visit Completed — Needs Review',
  'Offer Preparation',
  'Offer Sent',
  'Active Negotiation'
]);
check('the gift bucket is not tied to a stage', ATTENTION_BUCKETS[5].stage, '');
check('every bucket names one action', ATTENTION_BUCKETS.every((b) => /\.$/.test(b.action)), true);
// The stages must be real values of the workbook's own dropdown, or a bucket can never fire.
const STAGES = (read('apps-script/Config.gs').match(/'Current Stage':\s*\[([^\]]+)\]/) || [])[1] || '';
check('every stage exists in the Current Stage dropdown',
  ATTENTION_BUCKETS.slice(0, 5).every((b) => STAGES.includes(`'${b.stage}'`)), true);

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
check('a passed visit stays visible, flagged OVERDUE',
  reason({ ...BASE, 'Visit Date': day(2026, 8, 1) }),
  'OVERDUE — visit was Aug 1, 2026 and is still marked Scheduled');
check('...and is marked so it can be sorted to the top',
  attentionBucket_({ ...BASE, 'Visit Date': day(2026, 8, 1) }, TODAY).attention, true);
check('a future visit needs no attention flag', !!attentionBucket_(BASE, TODAY).attention, false);
check('no visit date at all is still surfaced',
  reason({ ...BASE, 'Visit Date': '' }), 'no visit date set — nothing to confirm against');
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
check('it stays in Upcoming Visit', bucket(canceled), 'upcomingVisit');
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
check('"Sent" is finished', giftPending_({ ...sent, 'Gift Status': 'Sent' }), '');
check('"Not Appropriate" is finished', giftPending_({ ...sent, 'Gift Status': 'Not Appropriate' }), '');
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
const everyStage = ATTENTION_BUCKETS.slice(0, 5).map((b) => bucket({ ...BASE, 'Current Stage': b.stage }));
check('each stage lands in its own bucket', everyStage, ATTENTION_BUCKETS.slice(0, 5).map((b) => b.key));
check('no stage lands in two', new Set(everyStage).size, 5);

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
check('an imported row owes no gift either',
  giftPending_({ ...BASE, Source: 'Import', 'Gift Status': 'Recommended' }), '');
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

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
