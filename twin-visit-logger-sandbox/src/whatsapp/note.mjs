/**
 * Build the PROPERTY INSPECTION note posted into a visit group.
 *
 * Pure: data in, text out. No browser, no network, no dependencies — so the exact wording that
 * reaches a real group chat is unit-testable.
 *
 * It is a SUMMARY, not a copy of REI. Pasting the notes field in produced thousands of characters of
 * engagement counters, call-summary bullets and comp verdicts; the client's answer on seeing it was "this
 * was only needed in there... no other long notes". So every fact is a labelled line, read out of those
 * same notes, and the REI link carries anyone who wants the rest.
 *
 * Two kinds of line, and the split is deliberate:
 *   - Facts that can be read from REI are filled in.
 *   - The five lines someone must fill at the property are printed with a visible blank. Silently
 *     omitting them would read as "there are no known issues", which is a very different statement from
 *     "nobody has written the known issues down yet".
 *
 * Covered by tests/whatsapp-note.test.mjs.
 */

import {
  extractPropertyRadar, hasAnyPropertyRadar, extractCallSummary
} from './propertyradar.mjs';

/** Lines nobody can fill from REI. Confirmed absent — see _notAvailableInRei in the selector config. */
export const TO_FILL_IN = '_______';

/**
 * How a note is recognised again later — which is what stops a second run posting a duplicate.
 *
 * PLAIN TEXT, no emoji, and that is the whole point. WhatsApp Web replaces every emoji in a message
 * with an <img> element, and innerText does not include an image's alt text. So a marker of
 * "🏠 PROPERTY INSPECTION" could never match what is on screen: the rendered text reads
 * " PROPERTY INSPECTION". The check failed every time, the note was posted again every two minutes,
 * and the group got three copies of it.
 *
 * The heading still shows the emoji to a human. Only the part used for MATCHING is emoji-free.
 */
export const NOTE_MARKER = 'PROPERTY INSPECTION';

/** The heading as it appears in the message. */
export const NOTE_HEADING = `🏠 ${NOTE_MARKER}`;

function line(icon, label, value) {
  return `${icon} ${label}: ${value || TO_FILL_IN}`;
}

/**
 * `visit` is the scraped record; `appointmentText` is the already-formatted local date/time.
 * Anything missing becomes a visible blank rather than a silently dropped line.
 */
export function buildInspectionNote(visit = {}, { appointmentText = '', includeSellerWarning = false } = {}) {
  const v = (key) => {
    const raw = visit[key];
    return raw === undefined || raw === null ? '' : String(raw).replace(/\s+/g, ' ').trim();
  };

  const facts = [
    NOTE_HEADING,
    line('📍', 'Property', v('propertyAddress')),
    line('🧑', 'Seller', v('sellerName')),
    line('📞', 'Phone', v('phone')),
    line('🔗', 'Rei Blackbook Link', v('reiLink')),
    line('📅', 'Appointment', appointmentText && `${appointmentText} (In-Person Property Visit)`),
    line('📣', 'Lead Source', v('leadSource'))
  ];

  // Only shown when REI actually had them; a blank "4 Beds" line would be noise.
  const beds = v('beds'), baths = v('baths'), sqft = v('sqft');
  if (beds || baths || sqft) {
    facts.push(`🏘️ Property: ${[beds && `${beds} bd`, baths && `${baths} ba`, sqft && `${sqft} sqft`]
      .filter(Boolean).join(' · ')}`);
  }

  const stage = v('contactStage'), owner = v('assignedOwner');
  if (stage) facts.push(`📂 Lead Stage: ${stage}`);
  if (owner) facts.push(`👤 Assigned: ${owner}`);

  /*
   * The PropertyRadar figures — filled in when the team's VA has pasted a "PropertyRadar Verification"
   * note onto the REI contact, blank when nobody has.
   *
   * These five printed as PERMANENT blanks for most of this project, on my conclusion that REI has no
   * fields for them. That was true and beside the point: the numbers were on the contact all along, in
   * a note, written out in prose. "Not in REI" was the wrong test — the right one is "can it be read
   * from what REI holds", and it could.
   *
   * Where PropertyRadar is absent they stay blank, because a blank says "nobody has looked this up"
   * and an omitted line says nothing at all.
   */
  // Parsed from the RAW notes: tidyReiNotes removes the PropertyRadar block once its numbers are
  // showing as their own lines, so reading it after tidying would find nothing.
  const radar = extractPropertyRadar(visit.notes || '');
  const toFill = [
    '',
    hasAnyPropertyRadar(radar)
      ? '📊 Lead Summary:'
      : '📊 Lead Summary:  (no PropertyRadar note on this contact yet)',
    `💵 Estimated Value - ${radar.estimatedValue || TO_FILL_IN}`,
    `🏛️ Assessed Value - ${radar.assessedValue || TO_FILL_IN}`,
    `🏦 Estimated Open Loans Balance - ${radar.openLoansBalance || TO_FILL_IN}`,
    `📈 Estimated Equity - ${radar.estimatedEquity || TO_FILL_IN}`,
    `🗓️ Purchase Date - ${radar.purchaseDate || TO_FILL_IN}`
  ];

  /*
   * The five judgement lines, taken from where the VA already wrote them.
   *
   * These printed as blanks while the answers sat a few lines further down the same notes: the call
   * summary carries "Seller Motivation", "Lead Temperature", "Objections/Concerns" and "Property
   * Details" as labelled facts. Occupancy comes from PropertyRadar. Nothing here is inferred or
   * reworded — each line is the VA's own text or a blank, because paraphrasing a motivation read puts
   * words in the mouth of whoever spoke to the seller.
   */
  const summary = extractCallSummary(visit.notes || '');

  /*
   * "Property Details" in the call summary usually opens with the address, which is already the first
   * line of this message. Repeating it there cost a line and read as though it might be a DIFFERENT
   * property. Only a leading duplicate is removed; anything else the VA wrote stays.
   */
  let condition = summary.propertyCondition;
  const address = v('propertyAddress');
  if (condition && address) {
    const head = address.split(',')[0].trim();
    if (head && condition.toLowerCase().startsWith(head.toLowerCase())) {
      condition = condition.replace(/^[^—–-]*[—–-]\s*/, '').trim() || condition;
    }
  }

  toFill.push(
    '',
    line('🌡️', 'Motivation Level', summary.motivationLevel),
    line('🤝', 'Reason for Selling', summary.reasonForSelling),
    line('👥', 'Occupancy', radar.occupancy),
    line('🔧', 'Property Condition', condition),
    line('⚠️', 'Known Issues', summary.knownIssues)
  );

  /*
   * Three more facts from the call summary, shown ONLY when the VA wrote them.
   *
   * Dropping the notes dump entirely lost these, and they matter: how much time there is, whether a price
   * has been named, and what is expected after the visit. They are single lines, and an absent one is
   * omitted rather than shown blank — unlike the five above, nobody is expected to fill these in at the
   * door, so an empty label would be clutter rather than a prompt.
   */
  /*
   * What the seller actually said, in the VA's words, first of the three.
   *
   * The five lines above are grades and labels; this is the story, and it is what tells the person walking
   * up to the door why they are there. Cut to 450 characters with a marker — Juan reads this on a phone on
   * the way to a property, and the full version is one tap away on the REI link above.
   */
  if (summary.summary) {
    const story = summary.summary.length > 450
      ? `${summary.summary.slice(0, 450).trimEnd()}… (full notes on the REI link)`
      : summary.summary;
    toFill.push('', `📞 The call: ${story}`);
  }
  if (summary.timeline) toFill.push(`⏳ Timeline: ${summary.timeline}`);
  if (summary.priceExpectation) toFill.push(`💰 Price Expectation: ${summary.priceExpectation}`);
  if (summary.nextStep) toFill.push(`➡️ Next Step: ${summary.nextStep}`);

  /*
   * No raw notes dump.
   *
   * Pasting REI's whole notes field in produced a message thousands of characters long — engagement
   * counters, a nine-bullet call summary, a comp verdict — and the client's answer on seeing it was
   * "this was only needed in there... no other long notes". Everything worth carrying is now a labelled
   * line above, read out of those same notes. The REI link is in the message for anyone who wants the
   * rest, and it is one tap away.
   */
  const tail = [];

  const warning = includeSellerWarning
    ? ['', '⚠️ THE SELLER IS IN THIS GROUP — do not post offer numbers, equity or motivation here.']
    : [];

  return [...facts, ...toFill, ...tail, ...warning].join('\n');
}

/**
 * Is this text safe to post into a group that contains the seller?
 *
 * Used as a last check before posting. It looks for the things that must never reach the person being
 * negotiated with, whoever assembled the text and however it was assembled.
 */
export function containsSellerSensitive(text) {
  const t = String(text || '');
  const hits = [];
  if (/estimated equity|open loans? balance|assessed value|estimated value|\bARV\b|after repair value/i.test(t)) {
    hits.push('valuation / equity figures');
  }
  /*
   * "motivation level" alone was written against the blank template. Real REI notes say "Seller
   * Motivation:", "Lead Temperature: WARM", "Objections/Concerns" — a full internal read of the person
   * being negotiated with, and none of it matched. The note grew from a skeleton to 3,500 characters of
   * call summaries and comps; a detector aimed only at the skeleton is a detector that passes anything.
   */
  if (/motivation level|seller motivation|lead temperature|objections?\s*\/?\s*concerns/i.test(t)) {
    hits.push('motivation assessment');
  }
  if (/\bwe(?:'| a)?re passing|dead lead|lost deal|walk away/i.test(t)) hits.push('internal disposition');
  if (/seller floor|our max|approved offer|offer within the ran|preliminary offer|comp run|\bcomps?\b/i.test(t)) {
    hits.push('offer limits / comps');
  }
  if (/price expectation|target price|asking price wasn'?t given/i.test(t)) hits.push('price strategy');
  return hits;
}
