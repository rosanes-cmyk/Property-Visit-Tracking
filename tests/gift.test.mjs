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
check('the item, total and order number are recorded', rob.reason,
  'Gift ordered in REI — Gourmet Get-Together Gift Basket · $96.77 · order #104240205');

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
check('a different gift parses', flowers.reason,
  'Gift ordered in REI — Spring Flowers Bouquet · $61.20 · order #99881');
check('...with its own delivery date', flowers.sentDate, '09/02/2026');

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

console.log('\n=== Who approved it is NOT guessed ===');
/*
 * Rob's card is signed "Juan" and the billing name is Juan Diaz — but who PAID and who APPROVED are
 * different facts, and the note was added by a third person entirely (Theavil Marie). Those two columns
 * stay for a human, the same rule the dead-lead tags follow.
 */
check('Gift Approved By is not returned', rob.approvedBy, undefined);
check('Gift Approval Owner is not returned', rob.approvalOwner, undefined);
check('...and neither is fillable from REI', FILL_IF_BLANK.includes('Gift Approved By'), false);
check('...nor the approval owner', FILL_IF_BLANK.includes('Gift Approval Owner'), false);

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
  'Gift Status': '', 'Gift Sent Date': '', 'Gift Recommendation Reason': '', 'Last Contact Result': ''
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
const RECORDED = { ...ROB_ROW, 'Gift Status': 'Approved', 'Gift Sent Date': '08/01/2026',
  'Gift Recommendation Reason': 'Cherry approved after the walkthrough' };
check('a hand-recorded gift is untouched',
  diffFromRei(RECORDED, fields).some((c) => c.field.startsWith('Gift')), false);
check('a second run changes nothing',
  diffFromRei({ ...ROB_ROW, 'Gift Status': 'Sent', 'Gift Sent Date': '08/06/2026',
    'Gift Recommendation Reason': by('Gift Recommendation Reason').to,
    'Last Contact Result': by('Last Contact Result')?.to || '' }, fields), []);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
