/**
 * Which REI note is the LATEST, so the board can show what actually happened last.
 *
 * The client: "whatever happen in the rei notes and all will go to the dashboard right and add it there?"
 * It did not. REI's notes were read only to spot a cancellation or a dead-lead tag; the text itself was
 * never written anywhere, so Amelia Middel's card still read
 *
 *     "Auto-logged from REI task email · source: MLS/ Redfin · REI stage: 2 Follow Up"
 *
 * — the line written the day the row was created — while REI held a call summary and an email update from
 * that same morning saying the $930,000 terms had been sent and acknowledged.
 *
 * Pure and importless so the choosing rule is testable against real REI note text.
 */

// Same zone the rest of the project uses: "today" must not depend on the server's clock setting.
const ZONE = 'America/Los_Angeles';

const text = (v) => String(v == null ? '' : v).trim();

/*
 * The dates REI writes into its own notes: "EMAIL UPDATE – August 5, 2026", "CALL SUMMARY – August 5,
 * 2026", "2026-05-12: High motivation...", "4/2/2026 - Appointment canceled".
 *
 * All three forms appear in this client's data, so all three are read. A note with no date is not
 * discarded — it is simply outranked by any note that has one.
 */
const DATE_FORMS = [
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/gi,
  /\b(\d{4})-(\d{2})-(\d{2})\b/g,
  /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g
];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** The newest date mentioned in a note, as a sortable YYYYMMDD number, or 0 when it names none. */
export function noteDateKey(note) {
  const s = text(note);
  let best = 0;
  /*
   * EVERY date in the block, not the first one.
   *
   * Found by this suite: "booked Apr 2, 2026 · rescheduled August 5, 2026" scored as April, because a
   * non-global match returns only the first hit. A note that records a reschedule almost always names the
   * old date before the new one, so reading the first date would consistently pick the stale one.
   */
  for (let i = 0; i < DATE_FORMS.length; i += 1) {
    for (const m of s.matchAll(DATE_FORMS[i])) {
      let y, mo, d;
      if (i === 0) { y = +m[3]; mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1; d = +m[2]; }
      else if (i === 1) { y = +m[1]; mo = +m[2]; d = +m[3]; }
      else { y = +m[3]; mo = +m[1]; d = +m[2]; }
      if (!y || !mo || !d || mo > 12 || d > 31) continue;
      const key = y * 10000 + mo * 100 + d;
      if (key > best) best = key;
    }
  }
  return best;
}

/*
 * Blocks that are not a contact result, however recent they look.
 *
 * "The following files are uploaded: 1. Offer Summary 2. Buyer Indemnification Agreement…" is a document
 * checklist and would tell the team nothing about the seller. Putting it in Last Contact Result would push
 * out the call summary that matters.
 */
const NOT_A_CONTACT_RESULT = [
  /^the following files are uploaded/i,
  /^engagement insights/i,
  /^\s*$/
];

/**
 * Strip REI's own interface furniture out of a note.
 *
 * Rob Walker's gift note reached the tracker ending:
 *
 *   ...Next step: confirm with recipient that it arrived in good shape ...Show MoreAug 06, 2026Theavil Marie
 *
 * The client's screenshot of that same note, expanded, has all seven bullets — so nothing was missing and
 * nothing was cut off. What was wrong is the tail: "...Show More" is the expander's own label, and
 * "Aug 06, 2026Theavil Marie" is the byline REI prints under it. Both are page decoration that read, in a
 * spreadsheet cell, as if they were something the seller or the team had said.
 *
 * The WhatsApp briefing has stripped both since it was built. The tracker never did, which is why the same
 * note is clean in one place and littered in the other — so this is now the single copy and tidyReiNotes
 * calls it too.
 *
 * Conservative: only these two known, delimited shapes. Anything unrecognised is left exactly as REI wrote
 * it, because quietly eating somebody's notes is worse than an untidy cell.
 */
export function stripNoteChrome(note) {
  return String(note == null ? '' : note)
    // The expander's label, with or without the ellipsis REI glues to its front.
    .replace(/\.{2,}\s*Show\s*(?:More|Less)/gi, '')
    .replace(/Show\s*(?:More|Less)/gi, '')
    /*
     * "Aug 06, 2026Theavil Marie" — the byline REI prints under a note. The join is usually glued, which is
     * how it arrives from a text scrape, but a space there is the same byline and the same decoration, so
     * \s* rather than nothing.
     */
    .replace(/[A-Z][a-z]{2}\s+\d{1,2},\s*\d{4}\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\s*$/, '')
    /*
     * Line breaks are NOT collapsed here. The briefing's tidyReiNotes runs this mid-pipeline and then
     * splits on newlines to build its bullets — flattening the text at this point would leave it with one
     * unreadable paragraph. The tracker collapses its own block instead, where a cell holds one line.
     */
    .trim();
}

/**
 * The note to show as the last contact result, or '' when there is nothing worth showing.
 *
 * Picks the block naming the newest date. Ties and undated blocks fall back to page order, which puts
 * REI's main Notes field first — the one a person maintains by hand.
 *
 * `maxLength` clips it, because these are call transcripts and summaries: one of Amelia's runs to several
 * hundred characters, and a dashboard card has one line for it.
 */
export function latestReiNote(notes, { maxLength = 500 } = {}) {
  const blocks = (Array.isArray(notes) ? notes : String(notes || '').split(/\n{2,}/))
    .map((b) => text(b).replace(/\s+/g, ' '))
    .filter((b) => b && !NOT_A_CONTACT_RESULT.some((re) => re.test(b)));
  if (!blocks.length) return '';

  let best = blocks[0];
  let bestKey = noteDateKey(blocks[0]);
  for (const b of blocks.slice(1)) {
    const key = noteDateKey(b);
    // Strictly greater, so a tie keeps the earlier block and the choice stays stable run to run.
    if (key > bestKey) { best = b; bestKey = key; }
  }
  /*
   * Stripped AFTER the ranking, not before. The byline carries a date, and for a note whose body names no
   * other date that byline is the only thing placing it in time — removing it first would drop the block
   * to undated and could hand the cell to an older note.
   */
  const clean = stripNoteChrome(best).replace(/\s+/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 1)}…`;
}

/*
 * The Last Contact Result this project writes itself when it creates a row.
 *
 * Replacing it is safe in the way replacing a person's typing is not: nobody chose these words. Anything
 * else in that cell was put there by a human and is left exactly as it is.
 */
const AUTOMATION_CONTACT_RESULT = /^auto-logged from rei task email/i;

/** May REI's latest note replace what is in Last Contact Result? Only if blank or our own intake line. */
export function contactResultReplaceable(current) {
  const c = text(current);
  return !c || AUTOMATION_CONTACT_RESULT.test(c);
}

/**
 * The date of the newest REI note, as 'MM/DD/YYYY' — for Last Contact Date.
 *
 * The 3pm card told the client "Amelia Middel · $930,000 · sent date not recorded · no contact for 4 day(s)"
 * on a day REI held an email update AND a call summary from that same morning. "No contact for 4 days" was
 * simply false, and it is the kind of false that changes behaviour: it reads as a lead going cold when
 * somebody had spoken to her hours earlier.
 *
 * The count comes from the sheet's Days Since Last Activity, which is computed from Last Contact Date — a
 * column nothing was filling from REI. Syncing the note text without the date left the board showing the
 * right conversation and the wrong silence.
 */
export function latestReiNoteDate(notes, { now = new Date() } = {}) {
  const blocks = (Array.isArray(notes) ? notes : String(notes || '').split(/\n{2,}/))
    .map((b) => String(b || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  /*
   * A contact date can never be in the FUTURE, and notes are full of future dates.
   *
   * Caught by this project's own tests: Rob Walker's gift note reads "Deliver on 08/06/2026", and taking the
   * newest date in the text put a delivery still to happen into Last Contact Date. Due dates, follow-up
   * dates and delivery dates are all ahead of today and none of them is a conversation — so anything after
   * today is skipped, which for Rob leaves the note's own header stamp of Aug 5.
   */
  const todayKey = Number(new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now).replace(/-/g, ''));
  let best = 0;
  /*
   * Per DATE, not per block. noteDateKey returns the newest date in a block, so a block carrying both
   * "Aug 5" and "Deliver on 08/06" would return the 6th, be rejected as future, and lose the 5th with it.
   * Splitting on whitespace-separated date candidates keeps every date eligible on its own.
   */
  for (const b of blocks) {
    for (const piece of b.split(/(?=\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d)|(?=\b\d{1,2}\/\d{1,2}\/\d{4})|(?=\b\d{4}-\d{2}-\d{2})/i)) {
      const key = noteDateKey(piece);
      if (key > best && key <= todayKey) best = key;
    }
  }
  if (!best) return '';
  const y = Math.floor(best / 10000);
  const m = Math.floor((best % 10000) / 100);
  const d = best % 100;
  return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`;
}
