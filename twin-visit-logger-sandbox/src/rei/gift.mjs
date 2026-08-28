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

import { noteDateKey } from './notes.mjs';

const text = (v) => String(v == null ? '' : v).trim();

/*
 * Two markers required, not one.
 *
 * An order number alone is not a gift — this team's notes carry offer numbers, contract references and
 * escrow numbers. A gift or delivery word alone is not one either: "no gift for this one" and "we will
 * deliver the offer Tuesday" both contain it. Demanding an ORDER and a GIFT-ish word together is what keeps
 * this from firing on ordinary deal correspondence.
 */
/*
 * "Order ID" belongs here, and its absence lost a real gift.
 *
 * Sheng Luo's note, written by Theavil Marie and pasted by the client:
 *
 *   GIFT DELIVERED - Moving Supplies Confirmed Aug 12, 2026 2:03PM
 *   * Order ID: 20871989699423792
 *   * Items: 5x large moving boxes w/ handles, packing tape ... - $41.13, AmEx
 *
 * A gift that was ordered, delivered, photo-confirmed and paid for on AmEx. giftFromNotes returned {} — an
 * empty object, no status, no date, nothing — because this pattern accepts `order #`, `order number`,
 * `order no.` and `order summary`, and the note says `Order ID`. The GIFT_MARKER matched three times over;
 * one missing word in the other half threw the whole thing away.
 *
 * That is the failure mode this pair of markers is most exposed to: requiring TWO signals makes false
 * positives rare and false NEGATIVES silent. Nothing anywhere reported a gift being skipped — the lead
 * simply never appeared in the Gift Follow-Up section, which looks identical to having no gift.
 *
 * `id` is added to the same numbered-order alternative rather than loosening the marker generally: an order
 * ID is exactly as strong a signal as an order number, and every vendor writes one or the other.
 */
const ORDER_MARKER = /\border\s*#\s*\d+|\border\s*(?:number|no\.?|id)\s*:?\s*\d|\border\s+summary\b|\bplace an order\b/i;
const GIFT_MARKER = /\bgift\b|\bbasket\b|\bdeliver on\b|\bflowers?\b|\bhamper\b/i;

/*
 * The delivery date, in either of the two shapes the team's own notes use.
 *
 * REI's gift vendor writes "Delivery Info Deliver on 08/06/2026". Theavil Marie, ordering Marlene Martin's
 * moving supplies through Amazon, writes "Estimated delivery: Today, August 4, 2026" — a month name, and a
 * "Today," in the way. Only the first shape was handled, so Marlene's gift reached the sheet with no sent
 * date and the work queue reported it as "marked Sent but no Gift Sent Date recorded" for a gift that had
 * already shipped. The client's answer was short: "for marlene that is already finished and done."
 *
 * Up to 60 non-period characters are allowed between the word and the date. It was 24, which covered
 * ": Today, " and " on " but not a note that puts the ADDRESS in between:
 *
 *   * Home Depot order delivered to 2824 Garden Creek Cir, Pleasanton - Aug 12, 2026
 *
 * That is 38 characters, so Sheng Luo's gift was written to the sheet as Sent with NO Gift Sent Date —
 * exactly the incomplete half the client objected to over Marlene ("marked Sent but no Gift Sent Date
 * recorded" for a gift that had already shipped).
 *
 * Widening is safe because the class excludes periods AND newlines: the match still cannot leave the line,
 * and "Delivery Fee:$13.99" still cannot reach across its own decimal point to steal a later date.
 */
const MONTH_NAME = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
const DELIVER_SLASH = /\bdeliver(?:y|ed|ery)?\b[^.\n]{0,60}?(\d{1,2}\/\d{1,2}\/\d{4})/i;
const DELIVER_NAMED = new RegExp(
  `\\bdeliver(?:y|ed|ery)?\\b[^.\\n]{0,60}?\\b${MONTH_NAME}\\s+(\\d{1,2}),?\\s+(\\d{4})`, 'i');

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

/*
 * A label is not a product name.
 *
 * Reading backwards from "Total cost: $48.32" in Marlene's note lands on the words "Total cost" themselves,
 * which passed every length check and would have been written to the sheet as the gift. These are the field
 * labels that appear immediately before a price in the notes seen so far.
 */
const NOT_A_NAME = /^(?:total|order|item|sub|grand|tax|shipping|delivery|tracking|status|price|cost|amount)\b/i;

/** The gift's name, or '' when the text before the price yields nothing usable. */
function itemName(raw) {
  const price = raw.match(FIRST_PRICE);
  if (!price) return '';
  const before = raw.slice(0, price.index).replace(ITEM_BOUNDARY, '');
  // A name, not a sentence: letters, digits and the punctuation a product name really uses.
  const name = before.replace(/[^A-Za-z0-9'&\- ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (NOT_A_NAME.test(name)) return '';
  return name.length >= 4 && name.length <= 70 ? name : '';
}

/*
 * The other way these notes name a gift: "Marlene Martin's moving-supplies gift:".
 *
 * There is no price glued to the item in that format, so the backwards-from-the-price rule has nothing to
 * work from. The phrase must END in "gift" right before its colon, which is what keeps it off Rob's "Gourmet
 * Get-Together Gift Basket:$69.99" — that one ends in "Basket" and is already read correctly by price.
 */
const NAMED_GIFT = /(?:^|\n|:|'s)\s*([A-Za-z][A-Za-z0-9&\- ]{2,40}?\s+gift)\s*:/i;

const ORDER_TOTAL = /\border\s*total\s*:?\s*\$\s*([\d,]+\.\d{2})/i;
const ITEM_TOTAL = /\bitem\s*total\s*:?\s*\$\s*([\d,]+\.\d{2})/i;
/* Amazon's wording for the same thing. Last, so a REI order total still wins where both appear. */
const TOTAL_COST = /\btotal\s*cost\s*:?\s*\$\s*([\d,]+\.\d{2})/i;
/* "Order #104240205" and "Order number: 113-5603799-0573039" are both order numbers. */
/* `id` here too, or the reason line loses the one reference that lets somebody find the order again. */
const ORDER_NUMBER = /\border\s*(?:#|number|no\.?|id)\s*:?\s*(\d[\d-]{3,})/i;

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

/** 'MM/DD/YYYY' from a month name, day and year, or '' when the month is not a real one. */
function fromNamedMonth(name, day, year) {
  const month = MONTHS.indexOf(String(name).slice(0, 3).toLowerCase()) + 1;
  if (!month) return '';
  return `${String(month).padStart(2, '0')}/${String(Number(day)).padStart(2, '0')}/${year}`;
}

/** 'MM/DD/YYYY' for the day the gift is delivered or shipped, or '' when the note gives no date. */
function deliveredOn(raw) {
  const slash = raw.match(DELIVER_SLASH);
  if (slash) return slash[1];
  const named = raw.match(DELIVER_NAMED);
  return named ? fromNamedMonth(named[1], named[2], named[3]) : '';
}

/**
 * 'MM/DD/YYYY' for the date the order was placed, or '' when the note carries no such stamp.
 *
 * Searched from the first GIFT-ish word onward, not from the top of the blob. Every note on a contact is
 * joined together newest first, so on Sheng Luo the first month-name date in the text belonged to a CALL
 * SUMMARY from the 13th — and the gift, ordered and delivered on the 12th, was written to the sheet as
 * "ordered 08/13/2026" with a Gift Approval Date to match. A day out, on a record whose whole purpose is to
 * say what was done and when.
 *
 * Not a complete solution — a later unrelated note could still sit between the gift word and its date — but
 * strictly better than the first date anywhere on the contact, and it fixes the shape these notes actually
 * take, where the gift word and its date are in the same paragraph.
 */
function orderedOn(raw) {
  /*
   * From the gift word first, then the whole text as a fallback — because the two note shapes put the date
   * on opposite sides of it, and scoping alone broke the other one.
   *
   * Theavil Marie's own notes lead with the gift ("GIFT DELIVERED - ... Aug 12, 2026"), so the date to want
   * is AFTER the marker. REI's vendor notes lead with the note header ("Aug 5, 2026 | 4:36PM ... Order
   * Summary ... Gift Basket"), so it is BEFORE. Scoping to the marker fixed Sheng Luo and gave Rob Walker no
   * approval date at all, which the tests caught before this shipped.
   *
   * The scoped read wins when it finds anything, because that is the case where an unrelated later note can
   * otherwise steal the date — Sheng's gift was recorded as ordered on the 13th, the day of a call summary,
   * when it was ordered and delivered on the 12th.
   */
  const at = raw.search(GIFT_MARKER);
  if (at >= 0) {
    const scoped = raw.slice(at).match(NOTE_HEADER_DATE);
    if (scoped) return fromNamedMonth(scoped[1], scoped[2], scoped[3]);
  }
  const m = raw.match(NOTE_HEADER_DATE);
  return m ? fromNamedMonth(m[1], m[2], m[3]) : '';
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

  /*
   * The DELIVERY date, because it is the one the note states outright. The order was placed on the 5th for
   * delivery on the 6th, and a note's own explicit date beats a date inferred from when somebody typed it.
   * The order date is not lost — it goes into the reason below, so both are on the record.
   */
  const when = deliveredOn(raw);
  if (when) out.sentDate = when;

  const bits = [];
  const item = itemName(raw) || (raw.match(NAMED_GIFT) || [])[1] || '';
  if (item) bits.push(item.trim());
  const total = raw.match(ORDER_TOTAL) || raw.match(ITEM_TOTAL) || raw.match(TOTAL_COST);
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

/*
 * The date a gift was CONFIRMED RECEIVED, from REI's own words.
 *
 * Marichu Mangclimot's note of 7 August: "EMAIL RECEIVED – August 7, 2026 … ++ Confirms package received —
 * thanked us for it." REI holds the proof of delivery, and the card was still asking Cherry to record a Gift
 * Sent Date. The client, showing the note: "for marichu there already a record about the received."
 *
 * Separate from giftFromNotes on purpose. That one needs an ORDER marker — an order number, a vendor, a
 * total — because it is reconstructing what the gift WAS. A seller writing "thank you, it arrived" carries
 * none of that and is still proof it arrived.
 *
 * The date is the note's own. Sentence-level negation, not blanket: Rob Walker's delivery note also contains
 * "Tracking page had not updated", and rejecting the whole note for one negative word would have thrown away
 * the confirmation sitting two lines above it.
 */
const RECEIPT = [
  /confirms?\s+(?:the\s+)?(?:package|gift|basket|delivery)\s+(?:was\s+)?received/i,
  /(?:package|gift|basket)\s+(?:was\s+)?received/i,
  /delivery\s+confirmation\s+(?:email\s+)?received/i,
  /confirmed\s+receipt/i,
  /received\s+by\s*:/i,
  /(?:gift|basket)\s+(?:basket\s+)?delivered/i
];

/*
 * Negation is checked in the WORDS IMMEDIATELY BEFORE the phrase, not anywhere near it.
 *
 * Rob Walker's note reads "Delivery confirmation email received 4:31 PM PT … Tracking page had not updated
 * — email confirmed ahead of it", with no full stop between them. A sentence-level check threw the whole
 * confirmation away over a "not" that was about the tracking page. "not received" negates; "received …
 * tracking not updated" does not.
 */
const NOT_RECEIVED = /\b(?:not|never|no|hasn'?t|haven'?t|await(?:ing)?|pending|expecting)\s+(?:\w+\s+){0,2}$/i;

/** 'MM/DD/YYYY' when a note confirms the gift arrived, or '' when none does. */
export function giftReceiptDate(notes) {
  const blocks = Array.isArray(notes) ? notes : String(notes || '').split(/\n{2,}/);
  for (const block of blocks) {
    const text = String(block || '');
    const confirmed = RECEIPT.some((re) => {
      const hit = re.exec(text);
      return hit && !NOT_RECEIVED.test(text.slice(Math.max(0, hit.index - 40), hit.index));
    });
    if (!confirmed) continue;
    const key = noteDateKey(text);
    if (!key) continue;
    const y = Math.floor(key / 10000);
    const m = Math.floor(key / 100) % 100;
    const d = key % 100;
    return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`;
  }
  return '';
}
