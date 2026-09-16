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
export const NOTE_HEADING = `🏡 ${NOTE_MARKER}`;

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

  // An empty title means "no heading, just a blank line" — section 1 sits directly under the heading.
  const section = (title, lines) => {
    const real = lines.filter(Boolean);
    if (!real.length) return;
    out.push('', ...(title ? [title] : []), ...real);
  };

  /*
   * SECTION 1 — WHO, WHERE, WHEN. Everything needed to arrive at the right door, at the right time,
   * knowing who is opening it.
   *
   * County rides with the address because that is how the client wrote the template: "Property: Full
   * address + county/area". It is what tells a visitor whether this is an hour away or five minutes.
   */
  const county = v('county');
  section('', [
    `📍 Property: ${address || TO_FILL_IN}${county ? ` (${county} County)` : ''}`,
    // "Full name + important situation" — the one-line read of the person, not the whole call summary.
    `👤 Seller: ${[v('sellerName') || TO_FILL_IN, shortText(call.story, 160)].filter(Boolean).join(' — ')}`,
    `📞 Phone: ${v('phone') || TO_FILL_IN}`,
    `📧 Email: ${v('email') || TO_FILL_IN}`,
    `🔗 REI BlackBook: ${v('reiLink') || TO_FILL_IN}`,
    // Who must actually sign. A trust or a second owner changes the whole conversation.
    radar.vestedOwner && `🧾 Owner of record: ${radar.vestedOwner}`,
    '',
    `📅 Appointment: ${appointmentText || TO_FILL_IN}`,
    /*
     * The drive plan is NOT in the client's template, and it is kept anyway. It was asked for earlier and
     * it is the only part of this note that is time-critical: "leave at 1:15" stops a visit being late in
     * a way that no amount of seller background does. It sits under the appointment because that is what
     * it is about. One word from the client removes it.
     */
    leaveOffice && `🚪 Leave office: ${leaveOffice}`,
    driveTime && `🚗 Drive: ${driveTime}`,
    maps && `🗺️ Directions: ${maps}`,
    /*
     * "Walkthrough By" is filled from Assigned Owner, which is the only who-is-going value that survives
     * the trip through the calendar description. The tracker's own Assigned Visitor column never reaches
     * here. Named honestly rather than silently: if the owner is not the visitor, this line is wrong, and
     * whoever reads it can see what it came from.
     */
    `👷 Walkthrough By: ${v('assignedOwner') || TO_FILL_IN}`,
    /*
     * Commitments has no field anywhere — not in REI, not in the tracker. It prints as a blank on purpose.
     * "We promised nothing" and "nobody wrote down what we promised" are different statements, and the
     * second is the one that gets a visitor caught out at the door.
     */
    `📱 Commitments: ${v('commitments') || TO_FILL_IN}`,
    '',
    `LEAD SOURCE: ${v('leadSource') || TO_FILL_IN}`,
    v('contactStage') && `📂 Lead stage: ${v('contactStage')}`
  ]);

  const beds = v('beds'), baths = v('baths'), sqft = v('sqft');
  section('🏠 PROPERTY DETAILS', [
    hasAnyPropertyRadar(radar) ? null : '(no PropertyRadar note on this contact yet)',
    `Property Type: ${v('propertyType') || TO_FILL_IN}`,
    `Estimated Value: ${radar.estimatedValue || TO_FILL_IN}`,
    `Beds/Baths: ${beds || baths ? [beds, baths].filter(Boolean).join(' / ') : TO_FILL_IN}`,
    `Square Footage: ${sqft || TO_FILL_IN}`,
    `Lot Size: ${v('lotSize') || TO_FILL_IN}`,
    `Garage/Other Structures: ${v('garage') || TO_FILL_IN}`,
    `Estimated Loan Balance: ${radar.openLoansBalance || TO_FILL_IN}`,
    `Estimated Equity: ${radar.estimatedEquity || TO_FILL_IN}`,
    // Kept from the old section: what was paid and when is what makes the equity figure mean anything.
    radar.assessedValue && `Assessed Value: ${radar.assessedValue}`,
    radar.purchaseDate && `Bought: ${radar.purchaseDate}`,
    '',
    '⚠️ Seller Corrections: if PropertyRadar or public records say one thing and the homeowner tells you'
      + ' something different, WRITE IT DOWN.'
  ]);

  /*
   * SECTION 3, and the client's own heading for it is "THE MOST IMPORTANT PART". The blanks matter more
   * here than anywhere: omitting an empty Reason for Selling would read as "they have no reason", which is
   * a claim, and a wrong one. A visible blank reads as a question still to ask.
   */
  section('🔥 SELLER MOTIVATION', [
    `Motivation Level: ${motivationWithColour(call.motivationLevel)}`,
    /*
     * "Explain the actual story. Don't just write 'wants to sell.'"
     *
     * Falls back to the call summary when REI holds no Reason for Selling label. The old template printed
     * that summary as a section of its own; this one has nowhere else for it, and dropping it would throw
     * away the single most useful paragraph on the page to satisfy a layout.
     */
    `Reason for Selling: ${call.reasonForSelling || clipText(call.story, 500) || TO_FILL_IN}`,
    `Timeline: ${call.timeline || TO_FILL_IN}`,
    `Occupancy: ${radar.occupancy || TO_FILL_IN}`,
    `Property Condition: ${condition || TO_FILL_IN}`,
    `Price Expectation: ${call.priceExpectation || TO_FILL_IN}`,
    call.contactResult && `Last call: ${call.contactResult}`,
    /*
     * "Animals, family circumstances, access, previous conversations, appointments, promises we made, or
     * anything Juan should know before walking through the door."
     */
    `Important Notes: ${call.knownIssues || TO_FILL_IN}`
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

/**
 * The client's own scale: 🔴 High / 🟡 Medium / 🟢 Low.
 *
 * REI's wording is not that tidy — "HOT", "WARM", "Lead Temperature: COLD", "High motivation" all appear —
 * so the colour is matched on meaning, and anything unrecognised is printed AS WRITTEN with no dot. A
 * value the code does not understand is still information; replacing it with a wrong colour is not.
 */
export function motivationWithColour(level) {
  const text = String(level || '').trim();
  if (!text) return `🔴 High / 🟡 Medium / 🟢 Low — ${TO_FILL_IN}`;

  /*
   * THE GRADE IS WHAT COMES BEFORE THE DASH. extractCallSummary builds this line as "Warm — Not urgent,
   * exploring options": the VA's temperature, then their reason. Scanning the whole string for keywords
   * read "urgent" inside "Not urgent" and printed a seller who is in no hurry as 🔴 High — the most
   * expensive wrong answer this line can give, because it decides how hard somebody pushes at the door.
   *
   * So the explicit grade is tried first and the reason only as a fallback, and "not urgent" is read for
   * what it says.
   */
  const grade = text.split(/[—–-]/)[0].trim();
  const NOT_URGENT = /\bnot\s+urgent\b|\bno\s+urgency\b|\bno\s+rush\b/i;
  for (const source of [grade, text]) {
    if (!source) continue;
    if (/\b(high|hot|very motivated|urgent)\b/i.test(source) && !NOT_URGENT.test(source)) {
      return `🔴 High (${text})`;
    }
    if (/\b(medium|mid|warm|moderate)\b/i.test(source)) return `🟡 Medium (${text})`;
    if (/\b(low|cold|not motivated)\b/i.test(source) || NOT_URGENT.test(source)) return `🟢 Low (${text})`;
  }
  // Wording the code does not recognise is still information. A wrong colour on it would not be.
  return text;
}

/** A short inline extract: no "full notes on the link" tail, because it sits mid-sentence. */
function shortText(text, max) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length <= max ? value : `${value.slice(0, max).trimEnd()}…`;
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
    /*
     * Email was written into the description and printed by the note builder, and never passed between
     * the two — the same break as Beds/Baths/SqFt, found the same way. The client's template asks for it
     * by name, and a visitor who cannot email the seller from outside the house has lost a way to reach
     * them. This is the one message allowed to carry contact details at all.
     */
    email: from('Email'),
    reiLink: reiLinkFromDescription(description),
    leadSource: from('Lead Source'),
    contactStage: from('Contact Stage'),
    assignedOwner: from('Assigned Owner'),

    leaveOffice: from('Leave Office'),
    driveTime: from('Drive Time'),
    mapsLink: from('Maps'),

    propertyType: from('Property Type'),
    beds: from('Beds'),
    baths: from('Baths'),
    sqft: from('Square Footage'),
    lotSize: from('Lot Size'),
    garage: from('Garage'),
    yearBuilt: from('Year Built'),
    county: from('County'),

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
