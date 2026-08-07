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
import { tabStripXPath, xpathLiteral } from '../twin-visit-logger-sandbox/src/rei/tasks.mjs';
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

console.log('\n=== a header split across two lines is still one header ===');
/*
 * "Note" is bold in REI's markup and the author is not, so whether innerText keeps them on one line depends
 * on how those elements are styled — and a screenshot cannot tell you which. The first live run of the
 * reader found ZERO notes on all three contacts, which is exactly what a missed boundary looks like, so
 * both shapes are accepted rather than betting on one.
 */
const SPLIT = parseNotesPanel(['Note', 'by Theavil Marie', 'Aug 07 2026, 8:50 AM', 'Description:',
  'EMAIL RECEIVED – August 7, 2026', 'Note', 'by Cherry Ann', 'Aug 06 2026, 2:35 PM', 'CALL SUMMARY'].join('\n'));
check('two notes are found', SPLIT.length, 2);
check('the author is read off the following line', SPLIT[0].author, 'Theavil Marie');
check('...for the second too', SPLIT[1].author, 'Cherry Ann');
check('the body is intact', SPLIT[0].body, 'EMAIL RECEIVED – August 7, 2026');
check('and the split header itself is not in the body', /^by /.test(SPLIT[0].body), false);
/*
 * The author line is taken ONLY when it immediately follows the header. A note whose text happens to start
 * "by the way..." two lines down must keep those words.
 */
const NOT_AUTHOR = parseNotesPanel(['Note by Theavil Marie', 'Aug 07 2026, 8:50 AM',
  'by the way, she called back'].join('\n'));
check('a "by ..." line inside a note stays in the body',
  NOT_AUTHOR[0].body, 'by the way, she called back');
check('...and does not overwrite the author', NOT_AUTHOR[0].author, 'Theavil Marie');
/* A bare "Note" with nothing usable after it must not swallow the note that follows. */
check('an updated split header works too',
  parseNotesPanel(['Note updated', 'by Theavil Marie', 'Aug 06 2026, 7:24 PM', 'CALL SUMMARY'].join('\n'))[0].author,
  'Theavil Marie');

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

console.log('\n=== the RIGHT "Notes" is clicked ===');
/*
 * REI's contact page carries the word "Notes" twice: the tab, and a field label on the About panel —
 * "Notes / The lead gave the name and number of his cousin". The text fallback takes .last(), so it clicked
 * the FIELD LABEL, reported `clicked an element whose text is exactly "Notes"`, and left the page on About.
 * The doctor printed the proof: the tab strip at lines 40-47 and a second "Notes" at line 55, with About's
 * own content following it.
 *
 * The tabs are siblings of each other and no About field label has "About" for a sibling, so "the element
 * next to About" identifies the strip — without depending on class names, which REI scrambles to css-0.
 */
const XP = tabStripXPath('Notes');
check('it is anchored to the tab strip, not to any element saying Notes', /"About"/.test(XP), true);
check('...as a sibling relationship', /following-sibling|preceding-sibling/.test(XP), true);
check('...in both directions', /following-sibling/.test(XP) && /preceding-sibling/.test(XP), true);
check('...matching the whole text, so "Notes (29)" cannot match',
  /normalize-space\(\.\)="Notes"/.test(XP), true);
check('it is an xpath locator', XP.startsWith('xpath='), true);
/* Quoting, so a label can never break out of the expression. */
check('a plain label is double-quoted', xpathLiteral('Notes'), '"Notes"');
check('a label with a quote falls back to single quotes', xpathLiteral('Say "hi"'), "'Say \"hi\"'");
check('one with both is built with concat', /^concat\(/.test(xpathLiteral(`he said "no" it's fine`)), true);

const TASKS = fs.readFileSync(path.resolve('twin-visit-logger-sandbox/src/rei/tasks.mjs'), 'utf8');
/* Order matters: the strip must be tried BEFORE the .last() text fallback that caused this. */
check('the strip is tried before the text fallback',
  TASKS.indexOf('tabStripXPath(name)') < TASKS.indexOf(".filter({ hasText: exact }).last()"), true);
check('...and it says which way it got in', /clicked "\$\{name\}" in the tab strip/.test(TASKS), true);

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
