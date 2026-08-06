/**
 * REI's lead stage, offer amount and next step reaching the board.
 *
 *   node tests/stage-map.test.mjs
 *
 * The client, after seeing Amelia Middel side by side: "its automation right so what it gets in the rei
 * should be update in the dashboard and data its important."
 *
 * He was looking at this:
 *
 *   REI                                    the tracker
 *   Lead Stage: 4 Offer Sent               Current Stage: Visit Scheduled
 *   Amount Offer: $930,000                 Approved Offer Amount: (blank)
 *   Next Step: confirm the formal offer    Next Action: Conduct scheduled visit & log outcome
 *
 * An offer of $930,000 was out and the board was telling the team somebody still needed to go and visit
 * her. REI's stage had only ever been written into a note and never mapped.
 *
 * Moving a stage from a web page is the most dangerous thing in this project, so most of what follows
 * tests the refusals: forward only, never onto a closed lead, never on ambiguous wording.
 */
import { STAGE_ORDER, mapReiStage, stageAdvance, stageBehindTracker, stageCloseOut, closeOutRefusal,
  reiSaysLost, nextActionReplaceable, parseReiMoney,
  AUTOMATION_NEXT_ACTIONS }
  from '../twin-visit-logger-sandbox/src/rei/stage-map.mjs';
import { diffFromRei, reiFieldsFromScrape, FILL_IF_BLANK, REI_WINS } from '../twin-visit-logger-sandbox/src/rei/recheck.mjs';
import fs from 'node:fs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

console.log("=== REI's wording -> ours ===");
// REI prefixes a number, so matching is loose: "4 Offer Sent", "2 Follow Up".
check('"4 Offer Sent"', mapReiStage('4 Offer Sent'), 'Offer Sent');
check('"3 Appointment Booked"', mapReiStage('3 Appointment Booked'), 'Visit Scheduled');
check('"5 Negotiating"', mapReiStage('5 Negotiating'), 'Active Negotiation');
check('"Verbal Agreement"', mapReiStage('Verbal Agreement'), 'Verbal Agreement');
check('"Contract Sent"', mapReiStage('Contract Sent'), 'Contract Sent');
// The specific must beat the general: "Contract Signed" contains "contract s...".
check('"Contract Signed" is not read as Contract Sent', mapReiStage('Contract Signed'), 'Contract Signed');
check('"Under Contract"', mapReiStage('7 Under Contract'), 'Contract Signed');
check('every mapped value is a real dropdown value',
  ['4 Offer Sent', '3 Appointment Booked', '5 Negotiating', 'Contract Signed']
    .every((s) => STAGE_ORDER.includes(mapReiStage(s))), true);

console.log("\n=== THE CLIENT'S ACTUAL REI DROPDOWN, every value ===");
/*
 * Sent as a screenshot after I asked what REI's stages really are, and it changed the picture: only THREE of the
 * eleven were being mapped, and the patterns were guesses at wordings this account does not use.
 *
 * Every value is asserted here, including the ones that map to nothing, so a future edit that starts matching
 * "Cancelled Contract" as a live contract fails loudly instead of quietly moving a dead deal into the pipeline.
 */
const REI_DROPDOWN = [
  ['0 Invalid Leads', '', true],
  ['1 New Lead', '', false],
  ['2 Follow Up', '', false],
  ['3 Appointment Booked', 'Visit Scheduled', false],
  ['4 Offer Sent', 'Offer Sent', false],
  ['5 Under Contract', 'Contract Signed', false],
  ['6 Cancelled Contract', '', false],
  ['7 Reinstated', '', false],
  ['8 Clear to Close', 'Contract Signed', false],
  ['9 Lost / Dead Lead', '', true],
  ['10 Acquired', 'Contract Signed', false]
];
for (const [reiStage, expected, closes] of REI_DROPDOWN) {
  check(`"${reiStage}" -> ${expected || '(nothing)'}`, mapReiStage(reiStage), expected);
  check(`   ...closes the lead out: ${closes}`, reiSaysLost(reiStage), closes);
}
/*
 * "6 Cancelled Contract" must NOT reach the Contract Sent pattern. That failure would be silent and wrong in
 * the most expensive direction — a dead contract reading as a live one, in the section that says a deal is in
 * motion.
 */
check('"Cancelled Contract" is never read as a live contract',
  ['Contract Sent', 'Contract Signed'].includes(mapReiStage('6 Cancelled Contract')), false);
/*
 * "0 Invalid Leads" was being ignored entirely: it is not in the lost|dead wording. An invalid lead — wrong
 * number, duplicate, a property never for sale — needs closing out as surely as a dead one.
 */
check('an invalid lead closes out from an active stage',
  stageCloseOut('Offer Sent', '0 Invalid Leads'), 'Lost / Closed Out');
check('...but is still refused at contract stage, like any close-out',
  stageCloseOut('Contract Signed', '0 Invalid Leads'), '');
check('...and that refusal is reported',
  /too far along to close out/.test(closeOutRefusal('Contract Signed', '0 Invalid Leads')), true);
/*
 * 5 is "Under Contract", and it needed no new code — the under\s*contract pattern, written as a guess before the
 * real list existed, was already right. Worth asserting rather than assuming, and worth asserting the
 * DISTINCTION: it means both parties have signed, not that a contract has gone out for signature. Sent and
 * executed are different weeks of work and different sections of the board.
 */
check('"5 Under Contract" means SIGNED, not sent', mapReiStage('5 Under Contract'), 'Contract Signed');
check('...and is not confused with Contract Sent',
  mapReiStage('5 Under Contract') === 'Contract Sent', false);
/* A value nobody has named still maps to nothing — the list can grow, and a guess is worse than a gap. */
check('an unnamed numbered stage maps to nothing', mapReiStage('11 Something New'), '');
check('...and closes nothing out', reiSaysLost('11 Something New'), false);
/* All eleven values are now accounted for, which is the point of having asked for the list. */
check('every value in the dropdown is covered by this suite', REI_DROPDOWN.length, 11);
/* Acquired is the end of the pipeline, so it can only ever be a forward move or no move. */
check('Acquired advances a live deal to Contract Signed',
  stageAdvance('Offer Sent', '10 Acquired'), 'Contract Signed');
check('...and does nothing to one already there', stageAdvance('Contract Signed', '10 Acquired'), '');

console.log('\n--- and the wordings deliberately NOT mapped ---');
/*
 * A wrong stage is worse than a stale one: it moves a lead into a section of the 3pm work queue that tells
 * somebody to do the wrong thing. "Follow Up" is the important one — REI uses it both before a visit and
 * after an offer, so it cannot mean one thing here.
 */
for (const s of ['2 Follow Up', '1 New Lead', 'Dead Lead', 'Lost Deal', "We're Passing", 'Nurture', 'Cold', '', '-']) {
  check(`"${s}" maps to nothing`, mapReiStage(s), '');
}
check('null is safe', mapReiStage(null), '');

console.log('\n=== Forward only ===');
check("Amelia's case: Visit Scheduled -> Offer Sent", stageAdvance('Visit Scheduled', '4 Offer Sent'), 'Offer Sent');
check('a blank stage takes REI\'s', stageAdvance('', '4 Offer Sent'), 'Offer Sent');
check('two steps forward is fine', stageAdvance('Visit Scheduled', 'Contract Sent'), 'Contract Sent');
check('the same stage is not a change', stageAdvance('Offer Sent', '4 Offer Sent'), '');

console.log('\n--- the refusals that make this safe ---');
/*
 * REI's copy can easily be older than the team's. Rewinding a lead from Contract Sent to Visit Scheduled
 * would erase real progress and put a signed deal back in the visit queue.
 */
check('BACKWARDS is refused', stageAdvance('Contract Sent', '3 Appointment Booked'), '');
check('...even one step', stageAdvance('Active Negotiation', '4 Offer Sent'), '');
check('a CLOSED OUT lead is never dragged back', stageAdvance('Lost / Closed Out', '4 Offer Sent'), '');
check('nor is one moved to nurture', stageAdvance('Long-Term Nurture', '4 Offer Sent'), '');
check('an unmapped REI stage changes nothing', stageAdvance('Visit Scheduled', '2 Follow Up'), '');
check('an unknown current stage is left alone', stageAdvance('Something Custom', '4 Offer Sent'), '');

console.log('\n=== Money ===');
check('"$930,000" becomes a number the sheet can add up', parseReiMoney('$930,000'), '930000');
check('a bare number works', parseReiMoney('930000'), '930000');
check('decimals survive', parseReiMoney('$930,000.50'), '930000.5');
// A placeholder must never land in a currency cell.
for (const junk of ['-', '', 'TBD', 'call me', '$', 'N/A', null]) {
  check(`"${junk}" is not an amount`, parseReiMoney(junk), '');
}
check('an implausibly small figure is refused as a typo', parseReiMoney('$5'), '');
check('...at the thousand boundary', parseReiMoney('1000'), '1000');

console.log('\n=== Next Action: our own boilerplate may be replaced, a person\'s may not ===');
for (const a of AUTOMATION_NEXT_ACTIONS) check(`"${a.slice(0, 40)}" is replaceable`, nextActionReplaceable(a), true);
check('a blank is replaceable', nextActionReplaceable(''), true);
// The refusal: somebody committed to this.
check('"Call Cherry back Thursday re: 495k" is NOT replaceable',
  nextActionReplaceable('Call Cherry back Thursday re: 495k'), false);
check('"Send the addendum" is NOT replaceable', nextActionReplaceable('Send the addendum'), false);

console.log('\n=== Amelia end to end ===');
/* Verbatim from scrape-dump.mjs against contacts/20525007, against her real row 4. */
const AMELIA_ROW = {
  'Seller Name': 'Amelia Middel', 'Property Address': '460 5th Avenue, Redwood City, CA, 94063',
  'Assigned Owner': 'Juan', 'Assigned Visitor': 'Thea', 'Approved Offer Amount': '',
  'Current Stage': 'Visit Scheduled', 'Next Action': 'Conduct scheduled visit & log outcome',
  'Visit Status': 'Scheduled', 'Visit Date': '2026-08-01', 'Visit Time': '1:30 PM',
  Phone: '(650) 704-3064', Email: 'Amelia.Middel@cbnorcal.com'
};
const FROM_REI = reiFieldsFromScrape({
  sellerName: 'Amelia Middel', phone: '(650) 704-3064', email: 'Amelia.Middel@cbnorcal.com',
  assignedOwner: 'Juan', contactStage: '4 Offer Sent', amountOffer: '$930,000',
  nextAction: 'Confirm that Amelia prepared and sent the formal offer.'
});
const changes = diffFromRei(AMELIA_ROW, FROM_REI);
const by = (f) => changes.find((c) => c.field === f);
check('the offer amount lands', by('Approved Offer Amount')?.to, '930000');
check('the stage advances to Offer Sent', by('Current Stage')?.to, 'Offer Sent');
check('...and is marked as an advance', by('Current Stage')?.advanced, true);
check('the next action follows REI', /Confirm that Amelia/.test(by('Next Action')?.to || ''), true);
/*
 * Her owner is already Juan, so nothing is written there. Her visitor says Thea and REI says Juan, and that is
 * now CORRECTED rather than kept — the client, third time of asking: "all of the new update on that lead should
 * be included, will automatic update in the dashboard."
 *
 * Thea is worth pausing on, because she is why the dropdown guard exists: REI's owner field on one lead
 * literally reads "Thea, Cherry", which is not a legal value, and an illegal value fails the WHOLE row write.
 * mapVisitor resolves what it can and returns '' otherwise, and '' never overwrites.
 */
check('the owner already matches, so nothing is written', by('Assigned Owner'), undefined);
check('a stale visitor is corrected to the name REI holds', by('Assigned Visitor')?.to, 'Juan');
check('...and the old name is on the record', by('Assigned Visitor')?.from, 'Thea');
check('exactly four fields change', changes.map((c) => c.field).sort(),
  ['Approved Offer Amount', 'Assigned Visitor', 'Current Stage', 'Next Action']);
/*
 * Idempotence is the property that matters most now that REI wins: with overwriting allowed, a rule that is not
 * idempotent rewrites the same cells every twenty minutes, burns a Sheets write each time and fills the audit
 * log with changes that did not happen.
 */
check('a second run changes nothing',
  diffFromRei({ ...AMELIA_ROW, 'Approved Offer Amount': '930000', 'Current Stage': 'Offer Sent',
    'Assigned Visitor': 'Juan',
    'Next Action': 'Confirm that Amelia prepared and sent the formal offer.' }, FROM_REI), []);

console.log('\n--- and the same row once a person has moved it on ---');
check('a lead at Contract Sent keeps its stage',
  diffFromRei({ ...AMELIA_ROW, 'Current Stage': 'Contract Sent' }, FROM_REI).some((c) => c.field === 'Current Stage'), false);
check('a closed-out lead keeps its stage',
  diffFromRei({ ...AMELIA_ROW, 'Current Stage': 'Lost / Closed Out' }, FROM_REI).some((c) => c.field === 'Current Stage'), false);
/*
 * A next action and an offer amount typed on the dashboard are now REPLACED by REI's. Both were guarded on the
 * grounds that a person wrote them — but REI's Next Step and Amount Offer are written by this same team, in REI,
 * so both sides were human and the older one was winning.
 *
 * Current Stage is the exception that stays: it is still forward-only, and still refuses to move a lead somebody
 * closed out. Rewinding a signed deal into the visit queue is not a stale-cell problem, it is destruction.
 */
check("a dashboard next action is replaced by REI's",
  diffFromRei({ ...AMELIA_ROW, 'Next Action': 'Call Cherry back Thursday' }, FROM_REI)
    .find((c) => c.field === 'Next Action')?.from, 'Call Cherry back Thursday');
check('an offer amount is corrected to REI\'s figure',
  diffFromRei({ ...AMELIA_ROW, 'Approved Offer Amount': '905000' }, FROM_REI)
    .find((c) => c.field === 'Approved Offer Amount')?.to, '930000');

console.log('\n=== The completion rule still wins over REI\'s stage ===');
/*
 * A visit REI has ticked off moves the lead to "Needs Review" — the same move the workbook makes itself.
 * That must not be replaced by a stage advance from REI's own pipeline field, or a completed visit would
 * skip the review step Cherry's section 2 exists for.
 */
const completed = diffFromRei({ ...AMELIA_ROW, 'Current Stage': 'Visit Scheduled' },
  { ...FROM_REI, 'Visit Status': 'Completed' });
check('a completed visit goes to Needs Review, not Offer Sent',
  completed.find((c) => c.field === 'Current Stage')?.to, 'Visit Completed — Needs Review');

console.log("\n=== \"how about the lead stage?\" — REI behind the tracker is REPORTED ===");
/*
 * Every other field now takes REI's answer. Current Stage cannot, and the reason is specific rather than
 * cautious: the tracker holds Contract Sent Date, Contract Signed Date and Transaction Handoff Status, and REI
 * has no equivalent. A lead the tracker has at Contract Signed while REI still says Offer Sent is REI missing
 * information, not the tracker being stale — and moving it back would erase the dates that prove it.
 *
 * Silence is not the alternative. One of the two systems is wrong and somebody has to say which.
 */
check('REI behind the tracker is reported',
  /Nothing was changed — moving it back would erase the contract dates/
    .test(stageBehindTracker('Contract Signed', '4 Offer Sent')), true);
check('...naming both positions',
  /"4 Offer Sent" \(Offer Sent\)[\s\S]*"Contract Signed"/.test(stageBehindTracker('Contract Signed', '4 Offer Sent')), true);
/* REI level or ahead is not this function's business — stageAdvance handles those. */
check('REI level with the tracker reports nothing', stageBehindTracker('Offer Sent', '4 Offer Sent'), '');
check('REI ahead reports nothing', stageBehindTracker('Offer Preparation', '4 Offer Sent'), '');
check('...and stageAdvance moves that one instead', stageAdvance('Offer Preparation', '4 Offer Sent'), 'Offer Sent');
/* An ambiguous REI stage has said nothing, so there is nothing to disagree about. */
check('"2 Follow Up" reports nothing', stageBehindTracker('Contract Signed', '2 Follow Up'), '');
check('a blank REI stage reports nothing', stageBehindTracker('Contract Signed', ''), '');
/* Off-pipeline on either side: a closed-out or nurture lead is where a person put it. */
check('a closed-out tracker stage reports nothing',
  stageBehindTracker('Lost / Closed Out', '4 Offer Sent'), '');
check('a nurture tracker stage reports nothing',
  stageBehindTracker('Long-Term Nurture', '4 Offer Sent'), '');
check('a blank tracker stage reports nothing — stageAdvance fills it',
  stageBehindTracker('', '4 Offer Sent'), '');
/* And it writes nothing, which is the whole point. */
check('no stage change is produced for a backwards REI stage',
  diffFromRei({ ...AMELIA_ROW, 'Current Stage': 'Contract Signed' }, FROM_REI)
    .some((c) => c.field === 'Current Stage'), false);
const RUNNER_STAGE = fs.readFileSync(new URL('../twin-visit-logger-sandbox/scripts/recheck-rei.mjs', import.meta.url), 'utf8');
check('the runner reports it in the summary',
  /where REI's stage is BEHIND the tracker/.test(RUNNER_STAGE), true);
check('...and logs it as an EXCEPTION so it survives the window closing',
  /stageConflicts\.push\(\{ row, reason: behind \}\)/.test(RUNNER_STAGE), true);
check('...and says what to do about it',
  /Either advance the stage in REI, or correct it on the dashboard/.test(RUNNER_STAGE), true);

console.log('\n=== Approved Offer Amount comes from REI, and a blank never clears it ===');
check('it is a REI-wins field', REI_WINS.includes('Approved Offer Amount'), true);
const RECHECK = fs.readFileSync(new URL('../twin-visit-logger-sandbox/src/rei/recheck.mjs', import.meta.url), 'utf8');
/*
 * The one protection that survives the change, and the one that actually prevents damage: a field REI did not
 * return is skipped. A missing field almost always means the page did not finish rendering, not that the seller
 * has no phone number and no offer.
 */
check('a blank from REI is skipped before anything is compared',
  /if \(!to\) continue;\s+\/\/ rule 2: a blank from REI decides nothing/.test(RECHECK), true);
/* And behaviourally, not just in the source: REI returning nothing must leave every cell as it was. */
check('...so a lead REI said nothing about is untouched',
  diffFromRei({ ...AMELIA_ROW, 'Assigned Visitor': 'Thea' }, {}), []);
// Money must reach the sheet as digits: "$930,000" as text in a numeric column is a value no formula adds.
check('the amount is written as digits, not a formatted string',
  /parseReiMoney\(scraped\.amountOffer\)/.test(RECHECK), true);
check('the scraper exposes the raw amount rather than re-parsing a sentence',
  /amountOffer: normalize\(amountOffer\)/.test(
    fs.readFileSync(new URL('../twin-visit-logger-sandbox/src/rei/scraper.mjs', import.meta.url), 'utf8')), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
