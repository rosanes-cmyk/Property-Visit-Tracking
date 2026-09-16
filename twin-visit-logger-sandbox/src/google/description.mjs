/**
 * The calendar event's description — briefing on top, labelled fields underneath.
 *
 * SEPARATE FROM calendar.mjs, and not for tidiness. This function is pure — a visit object in, text out —
 * but it lived in a module that imports googleapis, so no test could ever RUN it. Every test that touched
 * it read the file as a STRING and matched regexes against the source.
 *
 * That is how "Beds/Baths" stayed broken. The scraper filled them, the briefing printed them, and nothing
 * wrote them into this description in between, so the line was blank in every briefing ever sent. No
 * regex over source text can catch a missing line; only rendering the thing and looking at it can. Now it
 * can be imported and rendered, which is what tests/calendar-description.test.mjs does.
 *
 * calendar.mjs re-exports buildDescription, so every existing caller is unchanged.
 */
import {
  extractPropertyRadar, extractBuilding, extractCallSummary, extractLogistics, mapsLink
} from '../whatsapp/propertyradar.mjs';
import { briefingFromDescription } from '../whatsapp/note.mjs';
import { DETAILS_HEADING } from '../whatsapp/plan.mjs';

const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const clip = (value, maxLength) => {
  const text = String(value || '');
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}\n[Truncated]`;
};

/** A task REI has marked cancelled. Exported because calendar.mjs branches on the same answer. */
export function isCancelled(status) {
  return normalize(status).toLowerCase().includes('cancel');
}

/**
 * The event description: the PROPERTY INSPECTION briefing, then the labelled fields underneath.
 *
 * It used to paste REI's Notes and Activity fields in verbatim — thousands of characters of engagement
 * counters, nine-bullet call summaries, account-update logs and comp verdicts. Nobody reads that on a
 * phone before a drive, and the client's answer on seeing it was to summarise.
 *
 * THE BRIEFING GOES ON THE EVENT TOO, at the client's instruction — "that should be added as well for the
 * calendar". It is the same text Chat gets, built by the same function from the same fields, so the two
 * cannot drift apart. And the calendar is where a visitor actually looks: the event is already open on
 * their phone when the reminder fires, half an hour before they leave.
 *
 * The labelled block stays below it, under DETAILS_HEADING, because every other step reads those labels
 * back. plan.mjs explains why the two must not share one namespace — a decorated motivation grade read
 * back and re-decorated, and a "_______" blank read as an answer.
 */
export function buildDescription(visit, { appointmentText = '' } = {}) {
  const radar = extractPropertyRadar(visit.notes || '');
  const built = extractBuilding(visit.notes || '');
  const call = extractCallSummary(visit.notes || '');
  const trip = extractLogistics(visit.notes || '');

  // Only lines with a value, except the identifying fields, which say "Not found" so their absence is
  // visible rather than silent.
  const some = (label, value) => (String(value || '').trim() ? `${label}: ${String(value).trim()}` : '');

  const details = [
    `Seller: ${visit.sellerName || 'Not found'}`,
    `Phone: ${visit.phone || 'Not found'}`,
    `Email: ${visit.email || 'Not found'}`,
    `Property: ${visit.propertyAddress || 'Not found'}`,
    // High, and never last: other steps read this back, and it must survive any truncation.
    `REI BlackBook: ${visit.reiLink || 'Not found'}`,
    // The VA's own link when they wrote one — it is the route their drive-time estimate came from.
    some('Maps', extractLogistics(visit.notes || '').mapsLink || mapsLink(visit.propertyAddress)),
    `Assigned Owner: ${visit.assignedOwner || 'Not found'}`,
    `Current Stage: ${isCancelled(visit.taskStatus) ? 'Cancelled' : 'Visit Scheduled'}`,
    `Task Status: ${visit.taskStatus || 'Not found'}`,
    `Contact Stage: ${visit.contactStage || 'Not found'}`,
    `Lead Source: ${visit.leadSource || 'Not found'}`,
    '',
    // The two facts that decide whether the visitor is late.
    some('Leave Office', trip.leaveOffice),
    some('Drive Time', trip.driveTime),
    '',
    /*
     * THE BUILDING ITSELF, and Beds/Baths/SqFt were the bug that made this block necessary.
     *
     * The scraper reads them off REI's own text chips ("4 Beds", "2.0 Baths", "2,448 SqFt") and
     * buildInspectionNote prints them — but nothing ever wrote them HERE, and the briefing is assembled
     * from this description. So the line existed at both ends with nothing in the middle, and every
     * briefing ever sent showed a blank where the house should be. Nobody reported it, because a missing
     * line looks exactly like a house REI holds no chips for.
     *
     * REI's chips win over the PropertyRadar prose when both exist: the chips are structured fields and
     * "6/3 3,200sf" is a VA's shorthand parsed out of a sentence.
     */
    some('Property Type', built.propertyType),
    some('Beds', visit.beds || built.beds),
    some('Baths', visit.baths || built.baths),
    some('Square Footage', visit.sqft || built.sqft),
    some('Lot Size', built.lotSize),
    some('Garage', built.garage),
    some('Year Built', built.yearBuilt),
    some('County', built.county),
    some('Estimated Value', radar.estimatedValue),
    some('Assessed Value', radar.assessedValue),
    some('Estimated Open Loans Balance', radar.openLoansBalance),
    some('Estimated Equity', radar.estimatedEquity),
    some('Purchase Date', radar.purchaseDate),
    some('Occupancy', radar.occupancy),
    some('Vested Owner', radar.vestedOwner),
    '',
    some('Motivation Level', call.motivationLevel),
    some('Reason for Selling', call.reasonForSelling),
    some('Property Condition', call.propertyCondition),
    some('Known Issues', call.knownIssues),
    some('Timeline', call.timeline),
    some('Price Expectation', call.priceExpectation),
    some('Call Summary', clip(call.summary, 700)),
    some('Next Step', call.nextStep),
    '',
    `Next Action: ${visit.nextAction || 'Not found'}`
  ].filter((entry) => entry !== '' || true)
    // Collapse the runs of blank lines left by omitted values, so an empty section does not leave a gap.
    .join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '');

  /*
   * The briefing is built FROM the labelled block, by the same function Chat uses, rather than assembled a
   * second time from the same fields. Two builders reading one source is how the Chat copy ended up
   * missing the drive plan, every PropertyRadar figure, motivation, condition, timeline and price — about
   * half the briefing, with nothing on screen to show it was gone.
   */
  const briefing = briefingFromDescription(details, {
    address: visit.propertyAddress,
    appointmentText
  });

  /*
   * Google truncates a description past about 8,000 characters, and it truncates the END — which is where
   * the labelled fields are. So the DETAILS block is given the room it needs first and the briefing takes
   * what is left, never the other way round: a shortened briefing is a worse read, but a shortened DETAILS
   * block silently loses the REI link every later step navigates by.
   */
  const room = 7800 - details.length - DETAILS_HEADING.length - 4;
  const head = room > 400 ? `${briefing.slice(0, room)}\n\n` : '';
  return `${head}${DETAILS_HEADING}\n${details}`;
}
