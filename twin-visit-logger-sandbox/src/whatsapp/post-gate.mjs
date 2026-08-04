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
 * ONE attempt at closing the REI task, then the visit is finished for good.
 *
 * The client's rule, in their words: task booked in REI becomes a calendar event, the calendar event becomes a
 * WhatsApp group, "and that's the finished, no loop". So a visit is visited once: group created, note posted,
 * REI task closed if it can be — and then never looked at again, whatever the outcome.
 *
 * It was 3, which meant a task the click could not confirm reopened a REI browser on the next run and the one
 * after. Bounded, but still a loop, and still three browser windows for one visit. If the single attempt does
 * not land, the run says so and the task stays open in REI — where a person will see it.
 */
export const MAX_TASK_ATTEMPTS = 1;

/**
 * Which calendar event IDs need nothing further.
 *
 * `groups` is the state file's map of eventId -> { name, notePosted?, ... }. A visit is done once its group
 * exists, its note is posted, and the REI task has had its one attempt — after which it is never looked at
 * again. That is the whole chain: booking, calendar event, group, note, task closed. Finished.
 */
export function eventsFinished(groups = {}, { requireNote = true, requireTaskClosed = false } = {}) {
  const done = new Set();
  for (const [eventId, entry] of Object.entries(groups || {})) {
    if (!entry) continue;
    /*
     * An open REI task keeps the visit unfinished.
     *
     * "Group created and note posted" was treated as the end of the story, so once those were recorded
     * the event was skipped before the task-closing step ever saw it — and the task could never be
     * closed on a later run. The three outcomes are separate and a visit is done only when all three are.
     *
     * ONE attempt, though — see MAX_TASK_ATTEMPTS. After it, the visit is finished whatever happened, because
     * reopening a REI browser over a task that could not be confirmed is a loop, and the client's rule is that
     * there is no loop.
     */
    if (requireTaskClosed && !entry.reiTaskClosed && (entry.reiTaskAttempts || 0) < MAX_TASK_ATTEMPTS) {
      continue;
    }
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
