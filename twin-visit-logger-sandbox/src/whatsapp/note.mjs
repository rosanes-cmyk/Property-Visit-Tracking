/**
 * Build the PROPERTY INSPECTION note posted into a visit group.
 *
 * Pure: data in, text out. No browser, no network, no dependencies — so the exact wording that
 * reaches a real group chat is unit-testable.
 *
 * Two halves, and the split is deliberate:
 *   - Facts REI actually holds are filled in.
 *   - Lines REI does NOT hold are printed with a blank and a marker, so the gap is obvious to whoever
 *     opens the group. Silently omitting them would read as "there are no known issues", which is a
 *     very different statement from "nobody has written the known issues down yet".
 *
 * Covered by tests/whatsapp-note.test.mjs.
 */

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
 * Trim to a length, and SAY SO when something was cut.
 *
 * A note that stops mid-sentence with no marker reads as the whole story. Whoever is standing at the
 * property needs to know there is more of it in REI.
 */
function clip_(text, max) {
  const value = String(text || '');
  if (value.length <= max) return value;
  return `${value.slice(0, max).trimEnd()}\n… (truncated — the rest is on the REI contact)`;
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
    line('📅', 'Appointment', appointmentText),
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
   * REI does not hold any of this — it comes from PropertyRadar and from the team's own judgement.
   * Printed as blanks on purpose: an absent "Known Issues" line reads as "there are none".
   */
  const toFill = [
    '',
    `📊 Lead Summary  (not in REI — from PropertyRadar)`,
    `💵 Estimated Value - ${TO_FILL_IN}`,
    `🏛️ Assessed Value - ${TO_FILL_IN}`,
    `🏦 Estimated Open Loans Balance - ${TO_FILL_IN}`,
    `📈 Estimated Equity - ${TO_FILL_IN}`,
    `🗓️ Purchase Date - ${TO_FILL_IN}`,
    '',
    line('🌡️', 'Motivation Level', ''),
    line('🤝', 'Reason for Selling', ''),
    line('👥', 'Occupancy', ''),
    line('🔧', 'Property Condition', ''),
    line('⚠️', 'Known Issues', '')
  ];

  /*
   * Everything REI actually wrote, carried across verbatim rather than paraphrased.
   *
   * These are the lines the team asked for and were not getting: REI's Notes and its Activity history
   * live in the calendar event as multi-line BLOCKS, and only the one-line "Next Action" was being
   * read. Multi-line values keep their line breaks — the appointment history in there is a list, and
   * flattening it to one paragraph makes it unreadable.
   */
  const multiline = (key) => {
    const raw = visit[key];
    return raw === undefined || raw === null ? '' : String(raw).replace(/[ \t]+$/gm, '').trim();
  };
  const notes = multiline('notes');
  const activity = multiline('latestActivity');
  const nextAction = v('nextAction');

  const tail = [];
  if (notes) tail.push('', '📝 REI Notes:', clip_(notes, 3500));
  if (activity) tail.push('', '🕑 REI Activity:', clip_(activity, 1200));
  if (nextAction) tail.push('', `➡️ Next Action: ${nextAction}`);

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
