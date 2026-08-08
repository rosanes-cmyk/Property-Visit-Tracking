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
import { fieldFromDescription, blockFromDescription, reiLinkFromDescription } from './plan.mjs';


import {
  extractPropertyRadar, hasAnyPropertyRadar, extractCallSummary, extractLogistics, mapsLink
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
  const given = (key) => v(key);

  /*
   * Values may arrive ALREADY EXTRACTED, or as raw notes to parse. The calendar description carries the
   * summary as labelled lines, so by the time this runs the work is usually done. Parsing raw notes is the
   * fallback for callers that still hold them, which is how add-visit-from-rei works.
   */
  const radarGiven = {
    estimatedValue: given('estimatedValue'),
    assessedValue: given('assessedValue'),
    openLoansBalance: given('openLoansBalance'),
    estimatedEquity: given('estimatedEquity'),
    purchaseDate: given('purchaseDate'),
    occupancy: given('occupancy'),
    vestedOwner: given('vestedOwner')
  };
  const radar = hasAnyPropertyRadar(radarGiven) ? radarGiven : extractPropertyRadar(visit.notes || '');

  const parsed = extractCallSummary(visit.notes || '');
  const call = {
    motivationLevel: given('motivationLevel') || parsed.motivationLevel,
    reasonForSelling: given('reasonForSelling') || parsed.reasonForSelling,
    propertyCondition: given('propertyCondition') || parsed.propertyCondition,
    knownIssues: given('knownIssues') || parsed.knownIssues,
    timeline: given('timeline') || parsed.timeline,
    priceExpectation: given('priceExpectation') || parsed.priceExpectation,
    nextStep: given('nextStep') || parsed.nextStep,
    contactResult: given('contactResult') || parsed.contactResult,
    story: given('callSummary') || parsed.summary
  };

  const trip = extractLogistics(visit.notes || '');
  const leaveOffice = given('leaveOffice') || trip.leaveOffice;
  const driveTime = given('driveTime') || trip.driveTime;
  const maps = given('mapsLink') || trip.mapsLink || mapsLink(v('propertyAddress'));

  /*
   * "Property Details" from the call summary usually opens with the address, which is already the heading.
   * Repeating it read as though it might be a DIFFERENT property.
   */
  let condition = call.propertyCondition;
  const address = v('propertyAddress');
  if (condition && address) {
    const head = address.split(',')[0].trim();
    if (head && condition.toLowerCase().startsWith(head.toLowerCase())) {
      condition = condition.replace(/^[^—–-]*[—–-]\s*/, '').trim() || condition;
    }
  }

  /*
   * SECTIONS, not one flat list of twenty labels.
   *
   * The client's verdict on the flat version was "it is so short, it should be understandable" — and both
   * halves of that are fair. The information was nearly all there; what was missing was any shape. Somebody
   * reading this on a phone outside a house needs to find one thing at a time: when to leave, who they are
   * meeting, what was said, what the numbers are, what to fill in. Headings do that; length alone does not.
   */
  const out = [NOTE_HEADING];
  if (address) out.push(`📍 ${address}`);

  const section = (title, lines) => {
    const real = lines.filter(Boolean);
    if (!real.length) return;
    out.push('', title, ...real);
  };

  section('━━ WHEN ━━', [
    appointmentText && `📅 ${appointmentText} — in-person property visit`,
    leaveOffice && `🚪 Leave office: ${leaveOffice}`,
    driveTime && `🚗 Drive: ${driveTime}`,
    maps && `🗺️ Directions: ${maps}`
  ]);

  section('━━ WHO ━━', [
    `🧑 Seller: ${v('sellerName') || TO_FILL_IN}`,
    `📞 Phone: ${v('phone') || TO_FILL_IN}`,
    v('email') && `✉️ Email: ${v('email')}`,
    // Who must actually sign. A trust or a second owner changes the whole conversation.
    radar.vestedOwner && `🧾 Owner of record: ${radar.vestedOwner}`,
    v('leadSource') && `📣 Lead source: ${v('leadSource')}`,
    v('contactStage') && `📂 Lead stage: ${v('contactStage')}`,
    v('assignedOwner') && `👤 Assigned: ${v('assignedOwner')}`,
    v('reiLink') && `🔗 REI contact: ${v('reiLink')}`
  ]);

  section('━━ WHAT THE SELLER SAID ━━', [
    call.contactResult && `☎️ Call: ${call.contactResult}`,
    call.story && clipText(call.story, 500),
    call.motivationLevel && `🌡️ Motivation: ${call.motivationLevel}`,
    call.reasonForSelling && `🤝 Reason for selling: ${call.reasonForSelling}`,
    call.timeline && `⏳ Timeline: ${call.timeline}`,
    call.priceExpectation && `💰 Price expectation: ${call.priceExpectation}`
  ]);

  const beds = v('beds'), baths = v('baths'), sqft = v('sqft');
  section('━━ THE NUMBERS ━━', [
    (beds || baths || sqft) && `🏘️ ${[beds && `${beds} bd`, baths && `${baths} ba`, sqft && `${sqft} sqft`]
      .filter(Boolean).join(' · ')}`,
    hasAnyPropertyRadar(radar) ? null : '(no PropertyRadar note on this contact yet)',
    `💵 Estimated value: ${radar.estimatedValue || TO_FILL_IN}`,
    `🏛️ Assessed value: ${radar.assessedValue || TO_FILL_IN}`,
    `🏦 Open loans: ${radar.openLoansBalance || TO_FILL_IN}`,
    `📈 Equity: ${radar.estimatedEquity || TO_FILL_IN}`,
    `🗓️ Bought: ${radar.purchaseDate || TO_FILL_IN}`
  ]);

  /*
   * The blanks live in their own section with an instruction above them, so they read as a job to do rather
   * than as missing information. Omitting them would say "there are no known issues", which is a different
   * claim from "nobody has written them down yet".
   */
  section('━━ FILL IN AT THE VISIT ━━', [
    `👥 Occupancy: ${radar.occupancy || TO_FILL_IN}`,
    `🔧 Condition: ${condition || TO_FILL_IN}`,
    `⚠️ Known issues: ${call.knownIssues || TO_FILL_IN}`,
    `🛠️ Repairs needed: ${TO_FILL_IN}`,
    `📸 Photos taken: ${TO_FILL_IN}`
  ]);

  /*
   * No "after the visit" section. The client asked for it gone, and it had earned that: it printed the whole
   * REI ACCOUNT UPDATE log — "Task: Created or confirmed... Workflow: None... Reason for Update... Updated
   * by: Genesis Joy Mangohig...Show More" — because a "Next Step:" label inside that log was matched and the
   * log is one long unbroken line, so the value ran to the end of it.
   *
   * What happens after the visit is decided at the visit, by the person reading this. It did not need a line
   * carrying somebody's audit trail into a group chat.
   */

  if (includeSellerWarning) {
    out.push('', '⚠️ THE SELLER IS IN THIS GROUP — do not post offer numbers, equity or motivation here.');
  }

  return out.join('\n');
}

/** Trim long free text and say so, rather than stopping mid-sentence as if that were the whole story. */
function clipText(text, max) {
  const value = String(text || '').trim();
  return value.length <= max
    ? value
    : `${value.slice(0, max).trimEnd()}… (full notes on the REI link above)`;
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

/**
 * The briefing for one visit, built from the CALENDAR EVENT DESCRIPTION.
 *
 * One builder, two callers, so the two deliveries cannot say different things:
 *
 *   - the WhatsApp watcher, which reads the description off Juan's calendar
 *   - the intake, which posts the briefing to Google Chat and holds the description it is about to
 *     write to that same event
 *
 * This lived in watch.mjs, and the Chat copy was assembled separately from the raw REI fields. The
 * client spotted the result: *"the exact that you are pasting in the whats app that should be as well
 * in the gc."* They were right — the Chat version carried the address, seller, stage and notes, and
 * silently dropped the drive plan, every PropertyRadar figure, motivation, condition, timeline, price
 * expectation and the call summary. About half the briefing, missing with nothing to show it was.
 *
 * The description is a SUMMARY written once by the calendar module, so nothing is re-parsed here.
 * block('Notes') stays only as a fallback for events written before that change.
 */
export function briefingFromDescription(description, { address, appointmentText = '', includeSellerWarning = false } = {}) {
  const from = (label) => fieldFromDescription(description, label);
  const block = (heading) => blockFromDescription(description, heading);

  return buildInspectionNote({
    propertyAddress: address,
    sellerName: from('Seller'),
    phone: from('Phone'),
    reiLink: reiLinkFromDescription(description),
    leadSource: from('Lead Source'),
    contactStage: from('Contact Stage'),
    assignedOwner: from('Assigned Owner'),

    leaveOffice: from('Leave Office'),
    driveTime: from('Drive Time'),
    mapsLink: from('Maps'),

    estimatedValue: from('Estimated Value'),
    assessedValue: from('Assessed Value'),
    openLoansBalance: from('Estimated Open Loans Balance'),
    estimatedEquity: from('Estimated Equity'),
    purchaseDate: from('Purchase Date'),
    occupancy: from('Occupancy'),
    vestedOwner: from('Vested Owner'),

    motivationLevel: from('Motivation Level'),
    reasonForSelling: from('Reason for Selling'),
    propertyCondition: from('Property Condition'),
    knownIssues: from('Known Issues'),
    timeline: from('Timeline'),
    priceExpectation: from('Price Expectation'),
    callSummary: from('Call Summary'),
    nextStep: from('Next Step'),

    notes: block('Notes'),
    nextAction: from('Next Action')
  }, { appointmentText, includeSellerWarning });
}
