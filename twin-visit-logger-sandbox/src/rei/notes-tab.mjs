/**
 * Read REI's Notes TAB, not the sidebar preview of it.
 *
 * The client, looking at a screenshot of the tab strip: "it should be checked in the notes tab, as you
 * there already, and the codes didn't check."
 *
 * He is right, and it explains a run that looked fine and was not. The scraper opened a contact, read the
 * fields on screen, and treated anything over 60 characters as a note. What that actually caught was the
 * right-hand "Notes (29)" sidebar — a PREVIEW of each note, cut off with "Show More". So:
 *
 *   - Rob Walker's note came through, and came through with "...Show More" welded to the end, because the
 *     preview is truncated by design.
 *   - Marichu Mangclimot's newest note — an email received 8:50 AM on Aug 7, asking whether we handle the
 *     deed transfer, with four next steps — was never seen at all. It is on the Notes tab.
 *   - Jose Anguiano's Aug 6 call summary, with the sale postponed to January and the reason, likewise.
 *
 * Re-running could never have fixed those two. The page holding them was never opened. This is the same
 * shape of fault as the Tasks panel — the tab existed, was named exactly what it appeared to be named, and
 * nothing clicked it.
 *
 * The parser here is pure and importless so it is tested against REI's real note text without a browser.
 */

const text = (v) => String(v == null ? '' : v);

/*
 * Where one note ends and the next begins.
 *
 * "Note by Theavil Marie" heads a new note; "Note updated by Theavil Marie" heads one that has been edited
 * — Jose's newest is written that way. Both are the same boundary.
 */
const NOTE_HEAD = /^\s*Note(?:\s+updated)?\s+by\s+(.+?)\s*$/i;

/*
 * The same header when the page splits it across lines.
 *
 * "Note" is bold in REI's markup and the author is not, so whether innerText keeps them on one line depends
 * on how those elements are styled — and a screenshot cannot tell you which. The first live run found zero
 * notes on all three contacts, which is what a missed boundary looks like. Both shapes are accepted rather
 * than betting on one:
 *
 *   Note by Theavil Marie          <- one line
 *   Note                           <- two lines
 *   by Theavil Marie
 */
const NOTE_HEAD_BARE = /^\s*Note(?:\s+updated)?\s*$/i;
const NOTE_AUTHOR_ONLY = /^\s*by\s+(.+?)\s*$/i;

/* "Aug 06 2026, 4:37 PM" — the timestamp REI prints on the right of each note's header. */
const NOTE_STAMP = /^\s*([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s*$/i;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/*
 * The tab's own furniture, dropped so it cannot end up in a note body. Every one of these is a control or a
 * label on the Notes tab itself, matched as a WHOLE line so a note that happens to contain the word
 * "Description" mid-sentence keeps it.
 */
const CHROME = [
  /^all notes$/i, /^\+$/, /^created at$/i, /^created by$/i,
  /^search by note description\.*$/i, /^description:$/i,
  /^note'?s comments$/i, /^view details$/i, /^\d+$/, /^show (more|less)$/i
];

/** The parsed timestamp as a sortable number, or 0. */
function stampKey(line) {
  const m = NOTE_STAMP.exec(line);
  if (!m) return 0;
  const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
  if (!month) return 0;
  let hour = Number(m[4]) % 12;
  if (/pm/i.test(m[6])) hour += 12;
  /*
   * Built from components rather than handed to `new Date`, and kept as a number rather than a Date.
   * `new Date("August 01 2026")` builds midnight in the MACHINE's zone, which put a task a day early once
   * already. Nothing here needs a real instant — only "which note is newer".
   */
  return ((Number(m[3]) * 100 + month) * 100 + Number(m[2])) * 10000 + hour * 100 + Number(m[5]);
}

/**
 * Split the Notes tab's visible text into notes, newest first.
 *
 * Returns [{ author, at, body }] where `at` is a sortable number (0 when REI printed no timestamp) and
 * `body` is the note itself with the tab's controls removed.
 *
 * Order is by timestamp, then by page order for ties — REI already lists newest first, so an undated note
 * keeps the position REI gave it rather than being pushed to the end.
 */
export function parseNotesPanel(panelText) {
  const lines = text(panelText).split('\n').map((l) => l.replace(/\s+$/, ''));
  const notes = [];
  let current = null;

  for (const line of lines) {
    const head = NOTE_HEAD.exec(line);
    if (head) {
      if (current) notes.push(current);
      current = { author: head[1].trim(), at: 0, body: [] };
      continue;
    }
    if (NOTE_HEAD_BARE.test(line)) {
      if (current) notes.push(current);
      current = { author: '', at: 0, body: [], awaitingAuthor: true };
      continue;
    }
    if (!current) continue;                       // anything above the first note is the tab's header

    /* The author line of a split header, taken only when the very next line is one. */
    if (current.awaitingAuthor) {
      current.awaitingAuthor = false;
      const who = NOTE_AUTHOR_ONLY.exec(line);
      if (who) { current.author = who[1].trim(); continue; }
    }

    if (!current.at) {
      const key = stampKey(line);
      if (key) { current.at = key; continue; }    // the header timestamp, not part of the body
    }
    const trimmed = line.trim();
    if (!trimmed || CHROME.some((re) => re.test(trimmed))) continue;
    current.body.push(trimmed);
  }
  if (current) notes.push(current);

  return notes
    .map((n, i) => ({ author: n.author, at: n.at, body: n.body.join(' ').replace(/\s+/g, ' ').trim(), i }))
    .filter((n) => n.body)
    /* Stable: equal timestamps keep REI's own order, which is already newest first. */
    .sort((a, b) => (b.at - a.at) || (a.i - b.i))
    .map(({ author, at, body }) => ({ author, at, body }));
}

/*
 * How many notes are carried out of the tab.
 *
 * Rob has 29 and Marichu 15; only the newest few can matter to "what happened last", and the whole list
 * would be several thousand characters handed to every downstream parser for nothing.
 */
export const NOTES_KEPT = 8;

/**
 * Open the Notes tab and return its notes, newest first. Never throws — an empty array means the tab could
 * not be opened or held nothing, and the caller falls back to what was on the contact page.
 *
 * READ ONLY. It clicks the tab and safe "Show More" expanders, and nothing else.
 */
export async function readNotesTab(page, { openPanel, expandTruncatedText, labels = ['Notes'], keep = NOTES_KEPT } = {}) {
  try {
    const opened = await openPanel(page, labels);
    if (!opened || !opened.opened) return { notes: [], how: opened?.how || 'no Notes tab found' };

    /*
     * Read until the notes are actually there, up to three times.
     *
     * notes-doctor pulled 15 notes off Jose Anguiano's tab, and the scraper — same code, same click, same
     * reported `how` — got none on the very next run. The click is not the variable; what is left is time.
     * The doctor reads a page that has just loaded and settled, while the scraper arrives ten seconds and a
     * lot of DOM churn later, and REI renders the tab's contents after the click returns.
     *
     * So this stops trusting "the click succeeded" and checks for the notes themselves, which is the thing
     * that actually matters. Expanders are re-run each attempt because every note carries its own Show More
     * and none of them exist until the tab has painted.
     */
    let notes = [];
    let attempts = 0;
    let chars = 0;
    let clicked = 0;
    for (; attempts < 3 && !notes.length; attempts += 1) {
      if (attempts) await page.waitForTimeout(1500);
      const expanded = await expandTruncatedText(page);
      clicked += expanded?.clicked || 0;
      const body = await page.locator('body').innerText().catch(() => '');
      chars = body.length;
      notes = parseNotesPanel(body).slice(0, keep);
    }

    /*
     * The failure message carries evidence, because the last one did not. "Notes tab gave nothing" with
     * nothing else said sends the next person back to the browser to find out what "nothing" meant.
     */
    const how = notes.length
      ? `${opened.how}${attempts > 1 ? `, on attempt ${attempts}` : ''}`
      : `${opened.how} — but after ${attempts} attempt(s) the page held ${chars} characters and no note headers`;
    return { notes, how, expanded: clicked, attempts };
  } catch {
    return { notes: [], how: 'the Notes tab could not be read' };
  }
}
