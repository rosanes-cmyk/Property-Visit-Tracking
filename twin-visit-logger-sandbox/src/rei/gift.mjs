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

/*
 * The date the order was PLACED, from the note's own header — "Aug 5, 2026 | 4:36PM".
 *
 * Distinct from the delivery date, and both matter: the client wants the gift block complete, and "approved
 * on the 5th, delivered on the 6th" is the real sequence. A month-name form is tried first because that is
 * how REI stamps a note header, while "08/06/2026" inside the body is the DELIVERY date and must not be
 * mistaken for it.
 */
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const NOTE_HEADER_DATE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/i;

/** 'MM/DD/YYYY' for the date the order was placed, or '' when the note carries no such stamp. */
function orderedOn(raw) {
  const m = raw.match(NOTE_HEADER_DATE);
  if (!m) return '';
  const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
  if (!month) return '';
  return `${String(month).padStart(2, '0')}/${String(Number(m[2])).padStart(2, '0')}/${m[3]}`;
}

/*
 * Who owns and signs off a gift.
 *
 * The client's instruction: "gift approve by cheeryy since that is already automatic once it noted there is
 * approved" — a gift order existing in REI IS the approval, and Cherry is the approver. Both columns are
 * dropdowns limited to Cherry and Juan, so no other name can be written to them however the note reads.
 *
 * If the note names Juan as the one who placed it, he takes the owner column instead — he is on this order's
 * billing and card. Otherwise it falls to Cherry, which is the standing arrangement.
 */
const APPROVERS = ['Cherry', 'Juan'];

/**
 * What a note says about a gift: { status, sentDate, reason } — or {} when it says nothing about one.
 *
 * `status` is an exact value of the workbook's Gift Status dropdown ('Sent'). A value outside a dropdown
 * fails the whole row write rather than just its own cell, which this project has already been bitten by
 * twice — Lead Source on G379 and "Thea, Cherry" on an owner.
 *
 * Approval is included now, at the client's instruction: "gift approve by cheeryy since that is already
 * automatic once it noted there is approved". A gift order sitting in REI IS the sign-off, so recording it
 * is not a guess about a decision — the decision already happened and left this trace.
 *
 * The actual person who placed the order is kept in the reason text rather than squeezed into a dropdown
 * that only accepts Cherry and Juan. Rob's was placed by Theavil Marie, who is in neither list, and a value
 * outside a dropdown fails the whole row write.
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
  const placed = orderedOn(raw);
  if (placed) bits.push(`ordered ${placed}`);
  /*
   * The reason line carries the gift facts and nothing else. The note also holds the seller's home address
   * and phone number, and there is no reason for either to be copied into a second place.
   */
  if (bits.length) out.reason = `Gift ordered in REI — ${bits.join(' · ')}`;

  /*
   * The order date doubles as the approval date. The gift was signed off at the moment somebody placed it;
   * there is no separate approval step in REI to read, and leaving the column blank while claiming the gift
   * is approved would be the incomplete half the client objected to.
   */
  const placedOn = orderedOn(raw);
  if (placedOn) out.approvalDate = placedOn;

  /*
   * Juan takes the owner column when the note names him — on Rob's order he is both the billing name and the
   * card signature. Otherwise Cherry, which is the standing arrangement. Never anybody else: these are
   * dropdowns.
   */
  const named = APPROVERS.find((who) => new RegExp(`\\b${who}\\b`, 'i').test(raw));
  out.approvalOwner = named || 'Cherry';
  out.approvedBy = 'Cherry';

  return out;
}
