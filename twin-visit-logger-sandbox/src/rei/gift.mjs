/**
 * Read a gift order out of a REI note.
 *
 * The client, looking at Rob Walker's card: "as you see in this rob walker doesnt have the new info, that
 * what i need should be update in there."
 *
 * REI held the whole thing — placed Aug 5 2026 by Theavil Marie, a Gourmet Get-Together Gift Basket,
 * $96.77, delivering Aug 6, with a card from Juan apologising for a bad estimate before the walkthrough.
 * The tracker's entire GIFT block was empty: Gift Status, Gift Sent Date, Gift Recommendation Reason, all
 * blank.
 *
 * Gifts matter to this workbook specifically. Cherry's 3pm work queue has a whole section for them — "Also
 * we want to track sending gifts to them as part of follow up" — and it can only ever be as good as the
 * gift columns, which nothing was filling.
 *
 * Pure and importless, like the other decision modules, so the parsing is tested against the real note.
 */

const text = (v) => String(v == null ? '' : v).trim();

/*
 * Two markers required, not one.
 *
 * An order number alone is not a gift — this team's notes carry offer numbers, contract references and
 * escrow numbers. A gift or delivery word alone is not one either: "no gift for this one" and "we will
 * deliver the offer Tuesday" both contain it. Demanding an ORDER and a GIFT-ish word together is what keeps
 * this from firing on ordinary deal correspondence.
 */
const ORDER_MARKER = /\border\s*#\s*\d+|\border\s+summary\b|\bplace an order\b/i;
const GIFT_MARKER = /\bgift\b|\bbasket\b|\bdeliver on\b|\bflowers?\b|\bhamper\b/i;

/** 'MM/dd/yyyy' or 'M/d/yyyy' out of "Deliver on 08/06/2026". */
const DELIVER_ON = /\bdeliver(?:y|ed)?\s+(?:on|date:?)\s*(\d{1,2}\/\d{1,2}\/\d{4})/i;

/*
 * The item name, taken by looking BACKWARDS from the first price.
 *
 * REI's vendor writes "Gourmet Get-Together Gift Basket:$69.99" — a name glued to a price with a colon —
 * and the first such price is the item, the ones after it being fees and tax.
 *
 * Reading forwards with a lazy match got this wrong: page text arrives as ONE line with no newlines, so the
 * match began at the earliest legal character and produced "Summary Order #104240205 Gourmet Get-Together
 * Gift Basket". So the price is found first, then the text before it is cut at the last structural boundary
 * — an order number, a section heading — and what remains is the name.
 */
const FIRST_PRICE = /:\s*\$\s*([\d,]+\.\d{2})/;
const ITEM_BOUNDARY = /.*(?:#\s*\d+|\bOrder Summary\b|\bSummary\b|\bInfo\b|\n|\|)/s;

/** The gift's name, or '' when the text before the price yields nothing usable. */
function itemName(raw) {
  const price = raw.match(FIRST_PRICE);
  if (!price) return '';
  const before = raw.slice(0, price.index).replace(ITEM_BOUNDARY, '');
  // A name, not a sentence: letters, digits and the punctuation a product name really uses.
  const name = before.replace(/[^A-Za-z0-9'&\- ]/g, ' ').replace(/\s+/g, ' ').trim();
  return name.length >= 4 && name.length <= 70 ? name : '';
}
const ORDER_TOTAL = /\border\s*total\s*:?\s*\$\s*([\d,]+\.\d{2})/i;
const ITEM_TOTAL = /\bitem\s*total\s*:?\s*\$\s*([\d,]+\.\d{2})/i;
const ORDER_NUMBER = /\border\s*#\s*(\d+)/i;

/**
 * What a note says about a gift: { status, sentDate, reason } — or {} when it says nothing about one.
 *
 * `status` is an exact value of the workbook's Gift Status dropdown ('Sent'). A value outside a dropdown
 * fails the whole row write rather than just its own cell, which this project has already been bitten by
 * twice — Lead Source on G379 and "Thea, Cherry" on an owner.
 *
 * Deliberately NOT returned: Gift Approved By and Gift Approval Owner. Rob's card is signed "Juan" and the
 * billing name is Juan Diaz, but who PAID and who APPROVED are different facts, and the note was actually
 * added by a third person. Those two columns stay for a human — the same rule the dead-lead tags follow.
 */
export function giftFromNotes(notes) {
  const raw = Array.isArray(notes) ? notes.join('\n\n') : String(notes || '');
  if (!ORDER_MARKER.test(raw) || !GIFT_MARKER.test(raw)) return {};

  const out = { status: 'Sent' };

  const when = raw.match(DELIVER_ON);
  /*
   * The DELIVERY date, because it is the one REI states outright. The order was placed on the 5th for
   * delivery on the 6th, and a note's own explicit date beats a date inferred from when somebody typed it.
   * The order date is not lost — it goes into the reason below, so both are on the record.
   */
  if (when) out.sentDate = when[1];

  const bits = [];
  const item = itemName(raw);
  if (item) bits.push(item);
  const total = raw.match(ORDER_TOTAL) || raw.match(ITEM_TOTAL);
  if (total) bits.push(`$${total[1]}`);
  const number = raw.match(ORDER_NUMBER);
  if (number) bits.push(`order #${number[1]}`);
  /*
   * The reason line carries the gift facts and nothing else. The note also holds the seller's home address
   * and phone number, and there is no reason for either to be copied into a second place.
   */
  if (bits.length) out.reason = `Gift ordered in REI — ${bits.join(' · ')}`;

  return out;
}
