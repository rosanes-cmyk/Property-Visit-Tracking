/**
 * Reading REI's Notes TAB, rather than the sidebar preview of it.
 *
 *   node tests/notes-tab.test.mjs
 *
 * The client, from a screenshot of the tab strip: "it should be checked in the notes tab, as you there
 * already, and the codes didn't check."
 *
 * He is right, and it explains a run that read as a success and was not one. The scraper opened a contact,
 * read what was on screen, and called anything over 60 characters a note. What that caught was the
 * right-hand "Notes (29)" SIDEBAR — a preview of each note, cut off by design. So Rob Walker's note came
 * through with "...Show More" welded to the end, and Marichu's and Jose's newest notes were never seen at
 * all, because they live on a tab nothing clicked. Re-running could not have fixed that.
 *
 * The text below is REI's, taken from the client's screenshots of Rob, Jose and Marichu.
 */
import { parseNotesPanel, readNotesTab, NOTES_KEPT } from '../twin-visit-logger-sandbox/src/rei/notes-tab.mjs';
import { latestReiNote } from '../twin-visit-logger-sandbox/src/rei/notes.mjs';
import fs from 'node:fs';
import path from 'node:path';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

/* Marichu Mangclimot's Notes tab, verbatim from the screenshot. */
const MARICHU = `All Notes
+
Created at
Created by
Search By Note Description...
Note by Theavil Marie
Aug 07 2026, 8:50 AM
Description:
EMAIL RECEIVED – August 7, 2026, 6:28 AM (inbound from Marichu)
To: Cherry + Juan (Juan on twice)
++ Confirms package received — thanked us for it
++ Meeting her siblings later today; will get back to us soon after
++ NEW QUESTION: deed is held in a trust — asked if we handle the deed transfer as well
++ Read: still engaged, moving toward sibling sign-off. No pushback, no new objection.
NEXT STEPS
++ Escalate trust/deed question to Juan + title before replying
++ Do not call today unless she initiates
Note's Comments
0
View Details
Note by Theavil Marie
Aug 06 2026, 2:35 PM
Description:
CALL SUMMARY – August 6, 2026
++ Contact Result: transferred for Cherry
Note's Comments
0
View Details`;

console.log('=== the newest note on the tab, which nothing was reading ===');
const notes = parseNotesPanel(MARICHU);
check('both notes are found', notes.length, 2);
check('the Aug 7 email is first', notes[0].at, 202608070850);
check('...and the Aug 6 call second', notes[1].at, 202608061435);
check('the author is carried', notes[0].author, 'Theavil Marie');
/* The substance: this is the sentence that never reached the tracker. */
check('the deed-in-trust question is in the body',
  /NEW QUESTION: deed is held in a trust — asked if we handle the deed transfer as well/.test(notes[0].body), true);
check('...and so are the next steps',
  /Escalate trust\/deed question to Juan \+ title before replying/.test(notes[0].body), true);

console.log('\n--- the tab\'s own controls are not part of a note ---');
for (const junk of ['All Notes', 'Created at', 'Created by', 'Search By Note Description', "Note's Comments",
  'View Details', 'Description:', 'Show More']) {
  check(`"${junk}" is dropped`, notes.some((n) => n.body.includes(junk)), false);
}
/* The bare "0" under Note's Comments is a comment COUNT, and read as text it looks like a note of its own. */
check('the comment count is dropped', notes.some((n) => /^0$/.test(n.body)), false);

console.log('\n=== "Note updated by" heads a note just as "Note by" does ===');
/*
 * Jose Anguiano's newest is written that way — an edited note. Missing this boundary would glue his call
 * summary onto whatever came before it.
 */
const JOSE = `Note updated by Theavil Marie
Aug 06 2026, 7:24 PM
Description:
CALL SUMMARY – August 6, 2026 (UPDATE — cousin's decision; timeline pushed to January)
++ Summary: The sale is being POSTPONED to the BEGINNING OF THE YEAR (~January). Reason: one of the relatives is going in for SURGERY.
++ Lead Temperature: WARM (long horizon)
Note's Comments
0
View Details`;
const jose = parseNotesPanel(JOSE);
check('an updated note is still one note', jose.length, 1);
check('...with its author', jose[0].author, 'Theavil Marie');
check('...and its date', jose[0].at, 202608061924);
check('the postponement is captured',
  /POSTPONED to the BEGINNING OF THE YEAR/.test(jose[0].body), true);

console.log('\n=== ordering, and what happens without a timestamp ===');
check('newest first regardless of page order',
  parseNotesPanel(['Note by A', 'Aug 01 2026, 9:00 AM', 'older one',
    'Note by B', 'Aug 09 2026, 9:00 AM', 'newer one'].join('\n')).map((n) => n.body),
  ['newer one', 'older one']);
/* AM/PM matters: 12:30 PM is after 9:00 AM, and 12:15 AM is before both. */
check('the clock is read properly',
  parseNotesPanel(['Note by A', 'Aug 01 2026, 9:00 AM', 'morning',
    'Note by B', 'Aug 01 2026, 12:30 PM', 'lunchtime',
    'Note by C', 'Aug 01 2026, 12:15 AM', 'small hours'].join('\n')).map((n) => n.body),
  ['lunchtime', 'morning', 'small hours']);
/*
 * An undated note keeps REI's own position rather than being pushed to the end: the tab is already sorted
 * newest first, so page order is real information, not a fallback to nothing.
 */
check('undated notes keep REI\'s order',
  parseNotesPanel(['Note by A', 'first', 'Note by B', 'second'].join('\n')).map((n) => n.body),
  ['first', 'second']);
check('an empty note is dropped rather than returned blank',
  parseNotesPanel(['Note by A', 'Aug 01 2026, 9:00 AM', "Note's Comments", '0'].join('\n')), []);
check('a tab with no notes yields none', parseNotesPanel('All Notes\n+\nCreated at'), []);
check('empty text yields none', parseNotesPanel(''), []);
check('null yields none', parseNotesPanel(null), []);

console.log('\n=== only the newest few are carried ===');
/*
 * Rob has 29 notes and Marichu 15. Only the newest few can answer "what happened last", and handing every
 * one to each downstream parser would be several thousand characters for nothing.
 */
const many = Array.from({ length: 20 }, (_, i) =>
  `Note by A\nAug ${String(i + 1).padStart(2, '0')} 2026, 9:00 AM\nnote number ${i + 1}`).join('\n');
check('the cap is a named constant', typeof NOTES_KEPT, 'number');
check('...and small', NOTES_KEPT <= 12 && NOTES_KEPT >= 1, true);
const fake = {
  locator: () => ({ innerText: async () => many })
};
const readAll = await readNotesTab(fake, {
  openPanel: async () => ({ opened: true, how: 'clicked link "Notes"' }),
  expandTruncatedText: async () => ({ clicked: 3 })
});
check('the tab is opened before reading', readAll.how, 'clicked link "Notes"');
check('...expanders are clicked on it', readAll.expanded, 3);
check('...and the list is capped', readAll.notes.length, NOTES_KEPT);
check('the newest survives the cap', readAll.notes[0].body, 'note number 20');

console.log('\n--- a tab that will not open loses nothing ---');
/*
 * The contact-page fallback is why this returns empty rather than throwing. A contact whose Notes tab is
 * missing must keep the preview text the scraper has always read, not end up with no note at all.
 */
const noTab = await readNotesTab(fake, {
  openPanel: async () => ({ opened: false, how: 'no Notes tab found' }),
  expandTruncatedText: async () => ({ clicked: 0 })
});
check('nothing is returned', noTab.notes, []);
check('...and it says why', noTab.how, 'no Notes tab found');
const threw = await readNotesTab(fake, {
  openPanel: async () => { throw new Error('page closed'); },
  expandTruncatedText: async () => ({ clicked: 0 })
});
check('a thrown error is caught, not passed to the caller', threw.notes, []);

console.log('\n=== it reaches Last Contact Result ===');
/*
 * The point of all of it. latestReiNote picks the block naming the newest date and strips REI's furniture;
 * feeding it the TAB's notes rather than the sidebar's previews is what changes the answer.
 */
check('Marichu\'s cell would now carry the deed question',
  /deed is held in a trust/.test(latestReiNote(notes.map((n) => n.body))), true);
check('...and not the older call summary',
  /transferred for Cherry/.test(latestReiNote(notes.map((n) => n.body))), false);

console.log('\n=== the scraper actually opens the tab ===');
const SCRAPER = fs.readFileSync(path.resolve('twin-visit-logger-sandbox/src/rei/scraper.mjs'), 'utf8');
check('it imports the reader', /import \{ readNotesTab \} from '\.\/notes-tab\.mjs';/.test(SCRAPER), true);
check('...and calls it', /await readNotesTab\(page, \{ openPanel, expandTruncatedText \}\)/.test(SCRAPER), true);
/* The fallback must stay, or a contact with no Notes tab goes from an imperfect note to none. */
check('the contact-page reading is kept as a fallback',
  /notesTab\.notes\.length \? notesTab\.notes\.map\(\(n\) => n\.body\) : longTextItems\(pairs\)/.test(SCRAPER), true);
/* READ ONLY. This file must never gain a way to write to REI. */
const TAB = fs.readFileSync(path.resolve('twin-visit-logger-sandbox/src/rei/notes-tab.mjs'), 'utf8');
for (const forbidden of ['.fill(', '.type(', '.press(', '.selectOption(', '.check(', '.goto(', '.click(']) {
  check(`the reader never calls ${forbidden}`, TAB.includes(forbidden), false);
}

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
