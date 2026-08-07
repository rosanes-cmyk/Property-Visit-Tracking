/**
 * Pull the PropertyRadar figures out of REI's free-text notes.
 *
 * I was wrong about this. The briefing printed Estimated Value, Assessed Value, Open Loans Balance,
 * Estimated Equity and Purchase Date as permanent blanks, on the finding that REI has no fields for
 * them — which is true, and beside the point. The team's VA pastes a "PropertyRadar Verification" note
 * onto the contact containing every one of those numbers. They were in REI the whole time, as prose.
 *
 * So they are parsed out and filled in. Pure: text in, values out, no browser.
 *
 * The parsing is deliberately token-based rather than line-based. REI's own DOM glues labels onto
 * values with no separator — that is documented in config/rei-selectors.json and it has already caused
 * one wrong conclusion in this project — so anchoring on line starts would find nothing on scraped
 * text. Instead: find the label, then take the first value-shaped token after it.
 */

import { stripNoteChrome } from '../rei/notes.mjs';

/** First token matching `token` within `window` characters after `label`. '' if absent. */
function after(text, label, token, window = 90) {
  const source = String(text || '');
  // Escape the label: several contain "(" or "/".
  const labelRe = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const found = labelRe.exec(source);
  if (!found) return '';
  const slice = source.slice(found.index + found[0].length, found.index + found[0].length + window);
  const hit = token.exec(slice);
  return hit ? hit[0].trim() : '';
}

const MONEY = () => /\$\s?[\d,]+(?:\.\d{1,2})?/;
const DATE = () => /\d{1,2}\/\d{1,2}\/\d{2,4}/;
const PERCENT = () => /\(?\s*\d{1,3}(?:\.\d+)?%\s*\)?/;

/**
 * Everything recognisable, as display-ready strings. Every key may be ''.
 *
 * Labels are matched in the wording PropertyRadar actually uses, including the singular
 * "Estimated Open Loan Balance" — the briefing's own line says "Loans", and matching only the plural
 * would have found nothing in a note that says "Loan".
 */
export function extractPropertyRadar(notesText) {
  const t = String(notesText || '');

  const equity = after(t, 'Estimated Equity', MONEY());
  const equityPct = after(t, 'Estimated Equity', PERCENT(), 40);
  const purchaseDate = after(t, 'Purchase Date', DATE());
  const purchaseAmount = after(t, 'Purchase Amount', MONEY());

  // Occupancy is prose, so it is matched against the values PropertyRadar actually reports rather than
  // "take the next 40 characters" — which would drag in the following label on glued text.
  const occupancyMatch = /(owner[\s-]?occupied|tenant[\s-]?occupied|vacant|absentee[\s\w]*)/i.exec(t);

  return {
    estimatedValue: after(t, 'Estimated Value', MONEY()),
    assessedValue: after(t, 'Assessed Value', MONEY()),
    openLoansBalance: after(t, 'Estimated Open Loan', MONEY()),
    // "$1,214,936 (81.48%)" — the percentage is what makes the number mean something, and the brackets
    // are how the team writes it. Stripping them produced "$1,214,936 81.48%", which reads as two
    // unrelated figures.
    estimatedEquity: equity && equityPct
      ? `${equity} (${equityPct.replace(/[()\s]/g, '')})`
      : equity,
    // The date is far more useful next to what was paid for it, which is how the team's own template
    // writes it: "07/21/2000 ($801,000)".
    purchaseDate: purchaseDate && purchaseAmount ? `${purchaseDate} (${purchaseAmount})` : purchaseDate,
    occupancy: occupancyMatch ? titleCase(occupancyMatch[1].trim()) : '',
    /*
     * {0,3} more words, each possibly a single initial: "David B Jackowitz" came back as just "David"
     * when every word had to be two characters or more.
     *
     * The separator is [ \t], NOT \s. \s matches a newline, so the match ran past the end of the line
     * and swallowed the start of the next label: "David B Jackowitz\nSeller".
     */
    vestedOwner: after(t, 'Vested Owner', /[A-Z][A-Za-z.'-]*(?:[ \t]+[A-Z][A-Za-z.'-]*){0,3}/, 60)
  };
}

function titleCase(text) {
  return text.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

/** True if anything at all was found — used to decide whether to say where the numbers came from. */
export function hasAnyPropertyRadar(values) {
  return Object.values(values || {}).some((v) => String(v || '').trim());
}

/**
 * Strip REI's UI furniture out of a notes blob, and drop what the briefing already shows properly.
 *
 * The raw notes arrive as a wall: engagement counters glued together ("Latest Engagement InsightsText
 * RecievedAug 03, 2026, 11:32 AMCall Outgoing..."), a "Show More" link, a trailing author byline, and —
 * now that the figures are parsed into their own clean lines above — a full duplicate of the
 * PropertyRadar note. All of it costs the reader attention and tells them nothing.
 *
 * Conservative on purpose. It removes only blocks with a known, delimited shape. Anything unrecognised
 * is left exactly as REI wrote it, because a briefing that quietly eats somebody's notes is worse than
 * an ugly one.
 */
export function tidyReiNotes(text) {
  let t = String(text || '');

  // 1. The PropertyRadar note: well delimited, and its numbers are already shown as their own lines.
  t = t.replace(/PropertyRadar Verification[\s\S]*?Source:\s*PropertyRadar/gi, '');

  // 2. The engagement-counter strip REI puts above the notes. Ends at the RVM counter.
  t = t.replace(/Latest Engagement Insights[\s\S]*?RVM-*/gi, '');

  /*
   * 3. Expander links, and the byline REI appends after them — one shared copy with the tracker.
   *
   * These regexes lived here only, so the same note came out clean in the briefing and littered with
   * "...Show MoreAug 06, 2026Theavil Marie" in the tracker's Last Contact Result. stripNoteChrome is now
   * the single definition and both paths call it.
   */
  t = stripNoteChrome(t);

  /*
   * 4. Put a line break before the headings REI glues to the previous value. Only these three, matched
   *    only where a letter runs straight into them — a general "split before any capital" would shred
   *    ordinary prose.
   */
  t = t.replace(/([a-z.%)])(Notes|Next Step|CALL SUMMARY)\b/g, '$1\n\n$2');

  /*
   * 5. The same headings glued to the value AFTER them: "NotesDavid confirmed ownership",
   *    "Next StepJuan to visit". A colon and a space is what the VA meant to type, and it is what makes
   *    the line readable.
   */
  t = t.replace(/(^|\n)(Notes|Next Step)(?=[A-Z])/g, '$1$2: ');

  /*
   * 6. "++" is how the call summary separates its fields, and left inline it turns nine labelled facts
   *    into one unreadable paragraph — which is how "Seller Motivation" and "Lead Temperature" ended up
   *    buried mid-sentence. As bullets, the summary is skimmable at the door of the property, which is
   *    the only place this message is ever read.
   */
  t = t.replace(/\s*\+\+\s*/g, '\n• ');

  return t.replace(/\n{3,}/g, '\n\n').replace(/•\s*$/gm, '').trim();
}

/**
 * Read one labelled field out of the VA's call summary.
 *
 * The summary is a list of labelled facts separated by "++" or newlines — "Seller Motivation: Not
 * urgent...", "Lead Temperature: WARM...", "Objections/Concerns: ...". Those are exactly the judgement
 * lines the briefing was printing as blanks while the answers sat in the notes a few lines below.
 *
 * Stops at "++", a newline, or a bullet, so one field never swallows the next.
 */
export function labelledValue(text, label) {
  const source = String(text || '');
  const re = new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*([^\\n•]*?)(?=\\+\\+|\\n|•|$)`, 'i');
  const found = re.exec(source);
  if (!found) return '';
  const value = found[1].replace(/\s+/g, ' ').trim().replace(/[.;]+$/, '');

  // "Not specified" / "N/A" are the VA saying there is no answer. A blank says the same thing without
  // dressing it up as information.
  if (/^(not specified|n\/?a|none|unknown|tbd)$/i.test(value)) return '';

  /*
   * Reject a value that has clearly swallowed a whole REI log.
   *
   * The account-update note contains its own "Next Step:" label and arrives as one unbroken line, so there
   * was no newline to stop at and the match ran to the end — putting "Task: Created or confirmed...
   * Workflow: None... Reason for Update... Updated by: Genesis Joy Mangohig...Show More" into a group chat
   * as if it were the next step.
   *
   * Two signals, either is enough: it carries the log's own furniture, or it is far too long to be one
   * labelled fact. A blank is the right answer — better than a paragraph of audit trail.
   */
  if (/updated by|reason for update|show more|workflow:\s*none/i.test(value)) return '';
  if (value.length > 300) return '';

  return value;
}

/**
 * The five judgement lines, read from the call summary where the VA has written them.
 *
 * Nothing is inferred or reworded — each line is either the VA's own text or blank. Paraphrasing a
 * motivation read would put words in the mouth of whoever spoke to the seller.
 */
export function extractCallSummary(notesText) {
  const t = String(notesText || '');
  const temperature = labelledValue(t, 'Lead Temperature');
  const motivation = labelledValue(t, 'Seller Motivation');

  /*
   * The narrative: what the seller actually said.
   *
   * Anchored to the start of a field ("++", a bullet, or a line start) rather than matched loosely, so
   * "Lead Summary:" and the "CALL SUMMARY –" heading cannot be mistaken for it. This is the one paragraph
   * that gives the visitor the story instead of a grade, so getting the wrong text here would be worse
   * than having none.
   */
  const narrative = (/(?:^|[+•\n])\s*Summary\s*:\s*([^\n•]*?)(?=\+\+|\n|•|$)/i.exec(t) || [])[1] || '';

  return {
    /*
     * "Warm — Not urgent, exploring options": the GRADE, then why.
     *
     * Only the grade is taken from Lead Temperature, not its whole sentence. Joining both in full gave
     * "WARM — engaged seller — Not urgent — exploring options due to the repair needs" — four clauses and
     * three dashes for one idea.
     */
    motivationLevel: (() => {
      const grade = titleCase(temperature.split(/[—–-]/)[0].trim());
      if (grade && motivation) return `${grade} — ${motivation}`;
      return motivation || temperature;
    })(),
    reasonForSelling: labelledValue(t, 'Reason for Selling') || labelledValue(t, 'Reason for Sale'),
    propertyCondition: labelledValue(t, 'Property Condition') || labelledValue(t, 'Property Details'),
    knownIssues: labelledValue(t, 'Objections/Concerns') || labelledValue(t, 'Objections')
      || labelledValue(t, 'Known Issues'),
    timeline: labelledValue(t, 'Timeline'),
    priceExpectation: labelledValue(t, 'Price Expectation'),
    // What happens after the visit. The VA writes it, and it is the one line that tells the visitor what
    // is expected of them rather than about the property.
    nextStep: labelledValue(t, 'Next Step'),
    summary: narrative.replace(/\s+/g, ' ').trim(),
    contactResult: labelledValue(t, 'Contact Result')
  };
}

/**
 * The travel plan, when someone has written one into the notes.
 *
 * "Leave Office: 8:15 AM" and "Drive Time: ~1 hr 45 mins (via US-101 N; confirm morning-of)" are the two
 * facts that decide whether a visitor is late, and they were being read by nobody. They belong on the
 * calendar event above all — that is what pops up on a phone before the drive.
 */
export function extractLogistics(notesText) {
  const t = String(notesText || '');
  const rawDrive = labelledValue(t, 'Drive Time') || labelledValue(t, 'Travel Time')
    || labelledValue(t, 'ETA');

  /*
   * The VA writes their own Maps link inside the Drive Time line — "~56 mins
   * (https://maps.app.goo.gl/tfL4u5Uam65aB28j9)". That link beats one generated from the address: it is
   * the route they actually checked, which is where the "~56 mins" came from.
   *
   * It is lifted OUT of the drive-time text so the URL is not printed twice, once inline and again on the
   * directions line.
   */
  const link = (rawDrive.match(/https?:\/\/[^\s)>\]]+/) || [''])[0];
  const driveTime = link
    ? rawDrive.replace(link, '').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim()
    : rawDrive;

  return {
    leaveOffice: labelledValue(t, 'Leave Office') || labelledValue(t, 'Leave by')
      || labelledValue(t, 'Depart'),
    driveTime,
    mapsLink: link
  };
}

/**
 * How many minutes before the appointment the visitor must leave — the number Google Calendar needs.
 *
 * Calendar reminders are expressed as "minutes before the event starts", so "Leave Office: 10:00 AM" for an
 * 11:00 AM visit becomes 60. Returns 0 when it cannot be worked out, and a caller treats 0 as "no reminder"
 * rather than "remind at the start", because a leave-now alert that fires as the visit begins is worse than
 * none.
 *
 * `parseTimeOnDate` is injected so this stays pure and testable without a timezone library.
 */
export function minutesBeforeStart(leaveOfficeText, startMillis, parseTimeOnDate) {
  const text = String(leaveOfficeText || '').trim();
  if (!text || !startMillis || typeof parseTimeOnDate !== 'function') return 0;

  const leaveMillis = parseTimeOnDate(text);
  if (!leaveMillis) return 0;

  const minutes = Math.round((startMillis - leaveMillis) / 60000);
  // Must be before the visit, and within a day of it. A negative or absurd value means the time was
  // misread, and guessing at it would put someone on the road at the wrong hour.
  return minutes > 0 && minutes <= 1440 ? minutes : 0;
}

/**
 * A Google Maps DIRECTIONS link for an address.
 *
 * Directions, not a pin: nobody standing in an office needs to be shown where a house is on a map, they
 * need the route. The link opens the native app on a phone.
 */
export function mapsLink(address) {
  const text = String(address || '').trim();
  if (!text) return '';
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(text)}`;
}
