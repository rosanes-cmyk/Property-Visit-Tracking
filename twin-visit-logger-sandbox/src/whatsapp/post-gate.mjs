/**
 * The decisions that guard posting a note — pure, so they can be tested without a browser.
 *
 * Posting is the only thing this project does that other people see, so every judgement about
 * WHETHER to post lives here in plain functions rather than tangled into Playwright code:
 *
 *   - titlesMatch: is the conversation on screen really the group we mean? This is what stops a note
 *     landing in a seller's 1:1 chat that the warm-up left open.
 *   - noteAlreadyPresent: has this group already got the note? Re-running must not post twice.
 *   - eventsFinished: which calendar events are genuinely done. An event with a group but no note is
 *     NOT done, and must come back round again — otherwise the group created before note-posting
 *     worked would stay noteless forever.
 */
import { NOTE_MARKER } from './note.mjs';

/** First line of a block of text. A conversation header reads "<subject>\n<participants>". */
export function firstLine(text) {
  return String(text || '').split('\n')[0].replace(/\s+/g, ' ').trim();
}

/**
 * WhatsApp's own chrome, not a chat name.
 *
 * The conversation header wraps its subject in an element whose title attribute reads "click here for
 * group info" — so reading the first title attribute in the header returns THAT, not the group name.
 * A run created both groups correctly and then refused to post twice over, reporting: the open
 * conversation is "click here for group info". These are the strings that must never be mistaken for
 * a chat title.
 */
const CHROME_TITLES = [
  /^click here/i,          // "click here for group info" / "...for contact info"
  /^profile details$/i,
  /^(group|contact) info$/i,
  /^online$/i,
  /^typing/i,
  /^last seen/i,
  /^\d+ members?$/i
];

/** A header value that is a real chat name, or '' if it is WhatsApp's furniture. */
export function plausibleTitle(value) {
  const text = firstLine(value);
  if (!text) return '';
  return CHROME_TITLES.some((re) => re.test(text)) ? '' : text;
}

/**
 * Is the header on screen the group we asked for?
 *
 * Exact match after whitespace normalisation, plus one deliberate concession: WhatsApp truncates a
 * long subject in the conversation header with an ellipsis, and these subjects are full street
 * addresses. A truncated stem is accepted only when it is a real prefix of the group name AND long
 * enough to be unmistakable — "1390 Estudillo Ave, San Lea…" identifies this group, "Juan" does not.
 */
export function titlesMatch(header, name) {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const h = norm(header);
  const n = norm(name);
  if (!h || !n) return false;
  if (h === n) return true;
  const stem = h.replace(/[…….]+$/, '').trim();
  return stem.length >= 12 && n.startsWith(stem);
}

/** Re-exported so callers get the marker and the matcher from one place. */
export { NOTE_MARKER };

/** Has this conversation already got the note? Checked against the visible message text. */
export function noteAlreadyPresent(conversationText) {
  return String(conversationText || '').includes(NOTE_MARKER);
}

/**
 * Which calendar event IDs need nothing further.
 *
 * `groups` is the state file's map of eventId -> { name, notePosted?, ... }. With note posting on, a
 * group whose note never went out is unfinished and gets picked up again on the next run: that is
 * what makes the noteless group already sitting in WhatsApp self-heal instead of needing to be
 * deleted and rebuilt by hand.
 */
export function eventsFinished(groups = {}, { requireNote = true } = {}) {
  const done = new Set();
  for (const [eventId, entry] of Object.entries(groups || {})) {
    if (!entry) continue;
    /*
     * noteAttemptedAt counts as done, not just notePosted.
     *
     * It is written BEFORE the message is typed, so a note whose delivery cannot be confirmed is never
     * tried again. That asymmetry is deliberate: this posts into a group of real colleagues, and three
     * copies of the same briefing two minutes apart is a worse failure than one note that needs a human
     * to check it. When an attempt cannot be verified the run says so loudly instead of retrying.
     */
    if (requireNote && !entry.notePosted && !entry.noteAttemptedAt) continue;
    done.add(eventId);
  }
  return done;
}
