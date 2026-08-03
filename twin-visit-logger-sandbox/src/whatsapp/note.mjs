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
    '🏠 PROPERTY INSPECTION',
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

  // REI's free-text Notes often carries the equity percentage and the appointment history; worth
  // carrying across verbatim rather than paraphrasing it.
  const notes = v('notes');
  const tail = notes ? ['', `📝 From REI: ${notes.slice(0, 600)}`] : [];

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
  if (/estimated equity|open loans? balance|assessed value|estimated value/i.test(t)) hits.push('valuation / equity figures');
  if (/motivation level/i.test(t)) hits.push('motivation assessment');
  if (/\bwe(?:'| a)?re passing|dead lead|lost deal/i.test(t)) hits.push('internal disposition');
  if (/seller floor|our max|approved offer/i.test(t)) hits.push('offer limits');
  return hits;
}
