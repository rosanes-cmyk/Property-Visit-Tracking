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
  return best.length <= maxLength ? best : `${best.slice(0, maxLength - 1)}…`;
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
