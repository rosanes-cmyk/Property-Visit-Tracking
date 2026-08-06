/**
 * Reading a gift order out of a REI note.
 *
 *   node tests/gift.test.mjs
 *
 * The client, looking at Rob Walker's record: "as you see in this rob walker doesnt have the new info, that
 * what i need should be update in there."
 *
 * REI held all of it — placed Aug 5 2026, a Gourmet Get-Together Gift Basket, $96.77, delivering Aug 6,
 * with a card from Juan apologising for a bad estimate given before the walkthrough. The tracker's entire
 * GIFT block was blank.
 *
 * Two separate faults produced that, and the first hid the second: Rob's stage is Contract Signed, which the
 * re-check skipped outright as "a finished lead is not going to change in REI in a way we care about". A
 * gift sent AFTER signing is exactly such a change.
 */
import { giftFromNotes } from '../twin-visit-logger-sandbox/src/rei/gift.mjs';
import { ACTIVE_STAGES, FILL_IF_BLANK, recheckSkipReason, reiFieldsFromScrape, diffFromRei }
  from '../twin-visit-logger-sandbox/src/rei/recheck.mjs';
import fs from 'node:fs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

/* Rob Walker's note, as REI's page actually yields it: ONE line, no newlines. */
const ROB = 'Aug 5, 2026 | 4:36PM Place an order for Rob Walker - Order Summary Order #104240205 '
  + 'Gourmet Get-Together Gift Basket:$69.99 Delivery Fee:$13.99 Same Day/Weekend/Holiday Delivery Fee:$3.99 '
  + 'Tax:$8.80 Item total:$96.77 Delivery Info Deliver on 08/06/2026 Rob Walker 492 Umland Drive Santa Rosa '
  + 'Santa Rosa, CA 95401 (650) 209-0828 Enclosed Card "Rob - I\'m sorry. We put a number in front of you '
  + 'before walking the property, and the estimate was wrong." - Juan, Twin Home Buyer Billing Info '
  + 'Juan Diaz 100 Palm Avenue San Carlos, CA 94070 Order Total: $96.77';

console.log("=== Rob Walker's gift ===");
const rob = giftFromNotes(ROB);
check('the status is a real dropdown value', rob.status, 'Sent');
check('...one the workbook actually offers',
  ['Not Reviewed', 'Recommended', 'Approved', 'Sent', 'Not Appropriate'].includes(rob.status), true);
/*
 * The DELIVERY date, because REI states it outright: ordered on the 5th for delivery on the 6th. A note's
 * own explicit date beats one inferred from when somebody typed it, and the order date is not lost — it
 * goes in the reason, so both are on the record.
 */
check('the delivery date is taken', rob.sentDate, '08/06/2026');
check('the item, total, order number and order date are recorded', rob.reason,
  'Gift ordered in REI — Gourmet Get-Together Gift Basket · $96.77 · order #104240205 · ordered 08/05/2026');

console.log('\n--- the item name is read backwards from the price ---');
/*
 * Reading forwards with a lazy match produced "Summary Order #104240205 Gourmet Get-Together Gift Basket",
 * because page text arrives as one line and the match began at the earliest legal character. So the price
 * is found first and the text before it cut at the last structural boundary.
 */
check('no order number leaks into the name', /#/.test(rob.reason.split('·')[0]), false);
check('no section heading leaks in', /Summary/.test(rob.reason), false);
check('the ORDER TOTAL is used, not the item price', /\$96\.77/.test(rob.reason), true);
check('...so fees and tax are included', /\$69\.99/.test(rob.reason), false);
// Multiline and one-line page text must give the identical answer.
const multiline = ROB.replace(/ (Order Summary|Delivery Info|Enclosed Card|Billing Info) /g, '\n$1\n');
check('multiline text parses identically', giftFromNotes(multiline).reason, rob.reason);
check('an array of note blocks works too', giftFromNotes([ROB]).reason, rob.reason);

console.log('\n=== Another real shape ===');
const flowers = giftFromNotes('Place an order for Peggy - Order #99881 Spring Flowers Bouquet:$54.00 '
  + 'Deliver on 09/02/2026 Order Total: $61.20');
// No date stamp in this note, so no "ordered" clause — the reason carries only what the note really says.
check('a different gift parses', flowers.reason,
  'Gift ordered in REI — Spring Flowers Bouquet · $61.20 · order #99881');
check('...with its own delivery date', flowers.sentDate, '09/02/2026');

console.log("\n=== Marlene Martin's gift: the same job, a different vendor's wording ===");
/*
 * Theavil Marie's note, verbatim from REI. This one is an Amazon shipment rather than REI's gift vendor, and
 * it broke three of the four rules written for Rob's: no "#" on the order number, "Total cost" instead of
 * "Order total", and a month-name delivery date with "Today," wedged in front of it. The gift reached the
 * sheet with no sent date, so the work queue reported it as unrecorded — for a gift that had already
 * shipped. The client: "for marlene that is already finished and done, it should notify the current day."
 */
const MARLENE = 'Theavil Marie Aug 04 2026, 9:36 AM Description Update fro August 4, 2026 '
  + "Marlene Martin's moving-supplies gift: Order number: 113-5603799-0573039 "
  + 'Status: Shipped; currently being processed at the carrier facility '
  + 'Estimated delivery: Today, August 4, 2026 Tracking ID: TBA333401788713 Total cost: $48.32 '
  + 'The shipment includes the moving bags, packing tape, bubble wrap, permanent markers, and removable '
  + 'labels. The order summary confirms that the shipment was processed on August 4, 2026.';
const marlene = giftFromNotes(MARLENE);
check('it is recognised as a gift at all', marlene.status, 'Sent');
check('the delivery date is read from the month name', marlene.sentDate, '08/04/2026');
check('the order number survives its hyphens', /order #113-5603799-0573039/.test(marlene.reason), true);
check('"Total cost" counts as the total', /\$48\.32/.test(marlene.reason), true);
check('the gift is named, with no price glued to it', /moving-supplies gift/.test(marlene.reason), true);
/*
 * "Total cost" is a LABEL. Reading backwards from its price landed on those two words, which passed every
 * length check and would have been written to the sheet as the name of the gift.
 */
check('the label is not mistaken for the product', /Total cost ·/.test(marlene.reason), false);
check('the whole reason reads as a record of the gift', marlene.reason,
  'Gift ordered in REI — moving-supplies gift · $48.32 · order #113-5603799-0573039 · ordered 08/04/2026');
// Newlines are how the note is really laid out on screen; one-line is how the scraper yields it.
check('the on-screen layout parses identically',
  giftFromNotes(MARLENE.replace(/ (Order number|Status|Estimated delivery|Tracking ID|Total cost):/g, '\n$1:')).sentDate,
  '08/04/2026');

console.log('\n--- a delivery FEE is not a delivery DATE ---');
/*
 * Rob's note contains "Delivery Fee:$13.99" and "Same Day/Weekend/Holiday Delivery Fee:$3.99" before it ever
 * reaches "Deliver on 08/06/2026". A price cannot reach across its own decimal point to be read as a date.
 */
check('Rob still gets his real delivery date', rob.sentDate, '08/06/2026');
check('a note with only fees yields no date',
  giftFromNotes('Place an order - Order #7 Gift Basket:$20.00 Delivery Fee:$5.99 Order Total: $25.99').sentDate,
  undefined);

console.log('\n=== What must NOT be read as a gift ===');
/*
 * Two markers are required together. An order number alone is not a gift — this team's notes carry offer,
 * contract and escrow numbers. A gift word alone is not one either.
 */
for (const note of [
  'Spoke to seller about the offer, wants 495k',
  'Order #55512 for the title company',
  'No gift for this one, not appropriate',
  'we will deliver the offer Tuesday',
  'Gift basket idea — ask Cherry whether to send one',
  'EMAIL UPDATE – August 5, 2026 ++ Contact Result: acknowledged the offer terms',
  'Conduct scheduled visit & log outcome',
  ''
]) {
  check(`"${note.slice(0, 46) || '(empty)'}" is not a gift order`, giftFromNotes(note), {});
}
check('null is safe', giftFromNotes(null), {});

console.log('\n=== The gift block is COMPLETE, not half-filled ===');
/*
 * The client's objection to the first version: "this is not complete, also gift approval owner is missing …
 * and then gift approve by cheeryy since that is already automatic once it noted there is approved."
 *
 * He is right that it was incomplete, and right about why. Gift Status said 'Sent' while the approval columns
 * sat empty — a gift that had gone out but that the sheet showed as never approved. A gift order sitting in
 * REI IS the sign-off; it is not a decision being guessed at, it is a decision that already happened and
 * left this trace.
 */
check('the approval date is the ORDER date', rob.approvalDate, '08/05/2026');
check('...distinct from the delivery date', rob.sentDate, '08/06/2026');
check('...and both are real, not one reused', rob.approvalDate !== rob.sentDate, true);
check('approved by Cherry, as the standing arrangement', rob.approvedBy, 'Cherry');
check('the order date is also kept in the reason, so nothing is lost',
  /ordered 08\/05\/2026/.test(rob.reason), true);
// Every value written to a dropdown column must be one the dropdown holds.
for (const [field, value] of [['Gift Approval Owner', rob.approvalOwner], ['Gift Approved By', rob.approvedBy]]) {
  check(`${field} = "${value}" is a legal dropdown value`, ['Cherry', 'Juan'].includes(value), true);
}

console.log('\n--- Juan takes the owner column when the note names him ---');
/*
 * On Rob's order Juan is both the billing name and the card signature, so he owns it. Where the note names
 * nobody from the dropdown it falls to Cherry — never to anybody else, because these are dropdowns and a
 * value outside one fails the whole row write.
 */
check('Juan is picked up from the note', rob.approvalOwner, 'Juan');
check('...and Cherry takes it when he is absent',
  giftFromNotes('Place an order for Peggy - Order #99881 Spring Flowers Bouquet:$54.00 '
    + 'Deliver on 09/02/2026 Order Total: $61.20').approvalOwner, 'Cherry');
/*
 * Theavil Marie actually placed Rob's order and is in NEITHER dropdown. She cannot be written to those
 * columns at all, which is why the person who placed it belongs in the reason text instead.
 */
check('a name outside the dropdown never reaches the owner column',
  giftFromNotes('Theavil Marie placed an order - Order #12345 Gift Basket:$40.00 Order Total: $44.00').approvalOwner,
  'Cherry');

console.log('\n=== All six gift columns reach the sheet ===');
const ROB_EMPTY = {
  'Seller Name': 'Rob Walker', 'Property Address': '492 Umland Drive, Santa Rosa, CA 95401',
  'REI BlackBook Link': 'https://my.reiblackbook.com/contacts/20487447',
  'Current Stage': 'Contract Signed', 'Visit Status': 'Completed', 'Last Contact Result': '',
  'Gift Status': '', 'Gift Sent Date': '', 'Gift Recommendation Reason': '',
  'Gift Approval Owner': '', 'Gift Approved By': '', 'Gift Approval Date': ''
};
const full = diffFromRei(ROB_EMPTY, reiFieldsFromScrape({ notes: [ROB] }));
const got = (f) => full.find((c) => c.field === f)?.to;
check('Gift Status', got('Gift Status'), 'Sent');
check('Gift Sent Date', got('Gift Sent Date'), '08/06/2026');
check('Gift Approval Owner', got('Gift Approval Owner'), 'Juan');
check('Gift Approved By', got('Gift Approved By'), 'Cherry');
check('Gift Approval Date', got('Gift Approval Date'), '08/05/2026');
check('Gift Recommendation Reason', /Gourmet Get-Together/.test(got('Gift Recommendation Reason')), true);
check('all six are fills, never overwrites',
  ['Gift Status', 'Gift Sent Date', 'Gift Recommendation Reason', 'Gift Approval Owner',
    'Gift Approved By', 'Gift Approval Date'].every((f) => FILL_IF_BLANK.includes(f)), true);
// An approval somebody entered by hand still wins.
check('a hand-set approver is never replaced',
  diffFromRei({ ...ROB_EMPTY, 'Gift Approved By': 'Juan' }, reiFieldsFromScrape({ notes: [ROB] }))
    .some((c) => c.field === 'Gift Approved By'), false);

console.log('\n=== And a gift reaches Chat ===');
/*
 * The client asked outright: "is this will show in the web hook chat notif?" It did not — the alert fired
 * only on a status change or a moved visit. A gift going out is follow-up Cherry tracks a whole section of
 * the 3pm queue for, and Rob's was an apology basket for a bad estimate. Nobody should learn about that
 * from a spreadsheet the following week.
 */
const RUNNER_G = fs.readFileSync(new URL('../twin-visit-logger-sandbox/scripts/recheck-rei.mjs', import.meta.url), 'utf8');
check('a gift triggers a notification', /const giftChange = changes\.find\(\(c\) => c\.field === 'Gift Status'\)/.test(RUNNER_G), true);
check('...saying a GIFT is recorded', /a GIFT is recorded in REI/.test(RUNNER_G), true);
check('...with the delivery date', /delivering \$\{sent\.to\}/.test(RUNNER_G), true);
/*
 * Ranked below a cancellation and above a moved date: one message per lead, most consequential first. A
 * cancelled visit still outranks a gift, because somebody may otherwise drive to the property.
 */
check('a cancellation still takes precedence',
  RUNNER_G.indexOf('if (statusChange) {') < RUNNER_G.indexOf('} else if (giftChange) {'), true);
check('...and a gift outranks a moved date',
  RUNNER_G.indexOf('} else if (giftChange) {') < RUNNER_G.indexOf('} else if (movedChange) {'), true);

console.log('\n=== Who approved it is NOT guessed ===');
/*
 * Rob's card is signed "Juan" and the billing name is Juan Diaz — but who PAID and who APPROVED are
 * different facts, and the note was added by a third person entirely (Theavil Marie). Those two columns
 * stay for a human, the same rule the dead-lead tags follow.
 */
/*
 * These WERE withheld, on the grounds that who paid and who approved are different facts. The client
 * overruled it, and correctly: a gift order in REI is itself the approval, so recording it describes what
 * happened rather than inventing it. What is still never invented is a NAME — only Cherry or Juan can land
 * in those columns, whoever the note mentions.
 */
check('the approver is always one of the two the dropdown allows',
  ['Cherry', 'Juan'].includes(rob.approvedBy) && ['Cherry', 'Juan'].includes(rob.approvalOwner), true);
check('the person who actually placed it is recorded in the reason, not a dropdown',
  /order #104240205/.test(rob.reason), true);

console.log('\n=== Rob is now re-checkable at all ===');
/*
 * This was the fault that hid the other. Contract Signed was excluded as "a finished lead is not going to
 * change in REI in a way we care about" — and a gift sent after signing is precisely such a change. Gifts
 * are follow-up, and follow-up happens after the deal closes.
 */
const ROB_ROW = {
  'Seller Name': 'Rob Walker', 'Property Address': '492 Umland Drive, Santa Rosa, CA 95401',
  'REI BlackBook Link': 'https://my.reiblackbook.com/contacts/20487447',
  'Current Stage': 'Contract Signed', 'Visit Status': 'Completed',
  'Gift Status': '', 'Gift Sent Date': '', 'Gift Recommendation Reason': '',
  'Last Contact Result': '', 'Last Contact Date': ''
};
check('Contract Signed is re-checkable', recheckSkipReason(ROB_ROW), '');
check('...and is in ACTIVE_STAGES', ACTIVE_STAGES.includes('Contract Signed'), true);
/*
 * Lost / Closed Out and Long-Term Nurture stay OUT. Gifts plausibly go to those too, but that is a guess
 * and 206 more rows of browser traffic; Rob is evidence.
 */
check('Lost / Closed Out is still skipped',
  recheckSkipReason({ ...ROB_ROW, 'Current Stage': 'Lost / Closed Out' }), 'stage "Lost / Closed Out" is not active');
check('Long-Term Nurture is still skipped',
  recheckSkipReason({ ...ROB_ROW, 'Current Stage': 'Long-Term Nurture' }), 'stage "Long-Term Nurture" is not active');

console.log('\n--- and the gift reaches the sheet, fill-only ---');
const fields = reiFieldsFromScrape({ notes: [ROB] });
const changes = diffFromRei(ROB_ROW, fields);
const by = (f) => changes.find((c) => c.field === f);
check('Gift Status lands', by('Gift Status')?.to, 'Sent');
check('Gift Sent Date lands', by('Gift Sent Date')?.to, '08/06/2026');
check('Gift Recommendation Reason lands', /Gourmet Get-Together/.test(by('Gift Recommendation Reason')?.to || ''), true);
check('all three are marked as fills, not overwrites',
  ['Gift Status', 'Gift Sent Date', 'Gift Recommendation Reason'].every((f) => by(f)?.filledBlank), true);
// A gift somebody recorded by hand is never rewritten.
/*
 * A gift the team recorded themselves, in ALL six columns. Every one must survive: the whole point of
 * fill-only is that REI fills gaps and never argues with somebody who was there.
 */
const RECORDED = { ...ROB_ROW, 'Gift Status': 'Approved', 'Gift Sent Date': '08/01/2026',
  'Gift Recommendation Reason': 'Cherry approved after the walkthrough',
  'Gift Approval Owner': 'Cherry', 'Gift Approved By': 'Juan', 'Gift Approval Date': '07/30/2026' };
check('a hand-recorded gift is untouched in every column',
  diffFromRei(RECORDED, fields).some((c) => c.field.startsWith('Gift')), false);
// Idempotent: once applied, the same scrape must produce nothing on the next pass.
check('a second run changes nothing',
  diffFromRei({ ...ROB_ROW, 'Gift Status': 'Sent', 'Gift Sent Date': '08/06/2026',
    'Gift Recommendation Reason': by('Gift Recommendation Reason').to,
    'Gift Approval Owner': 'Juan', 'Gift Approved By': 'Cherry', 'Gift Approval Date': '08/05/2026',
    'Last Contact Date': by('Last Contact Date')?.to || '',
    'Last Contact Result': by('Last Contact Result')?.to || '' }, fields), []);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
