/**
 * Which REI controls the scraper is allowed to click to reveal a truncated note.
 *
 *   node tests/expand.test.mjs
 *
 * This is the only place the automation clicks anything on a contact page outside the one narrow
 * task-completion exception, so the decision gets its own suite. REI is read-only for this project: never
 * edit a contact, change a stage, delete anything, send a text or an email, or click a destructive control.
 *
 * A disclosure toggle mutates nothing — it shows text the logged-in user can already reveal by clicking. The
 * guard is that an element's ENTIRE trimmed text must be one of a handful of exact phrases, checked against
 * an allowlist AND a denylist, so two independent checks have to both be wrong before anything is clicked.
 *
 * The reason it exists at all: Rob Walker's gift reached the sheet with the basket's name and order number
 * and without its price, order date or delivery date. All three are later in the same note, behind "Show
 * More". The parser was right; the scraper was reading half a note.
 */
import { isSafeExpander, MAX_EXPANDS } from '../twin-visit-logger-sandbox/src/rei/expand.mjs';
import fs from 'node:fs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

console.log('=== what IS a safe expander ===');
for (const label of [
  'Show more', 'show More', 'SHOW MORE', 'Show all', 'Show full',
  'See more', 'See all', 'Read more', 'View more', 'More', '...', '…',
  '  Show more  ', 'Show\nmore'
]) {
  check(`"${label.replace(/\n/g, '\\n')}" is clickable`, isSafeExpander(label), true);
}

console.log('\n=== what is NOT, and must never be clicked ===');
/*
 * The destructive controls named in the project's own safety rules, plus the ones REI actually puts on a
 * contact page next to a note. Any of these being clicked once is a data change in the client's CRM.
 */
for (const label of [
  'Delete', 'Delete note', 'Remove', 'Archive', 'Discard', 'Cancel', 'Cancel appointment',
  'Edit', 'Save', 'Send', 'Send text', 'Send email', 'Add note', 'New task', 'Create task',
  'Assign', 'Mark complete', 'Complete', 'Merge', 'Convert to deal', 'Call', 'Text', 'Email',
  'Schedule', 'Book appointment', 'Export', 'Import', 'Share', 'Invite'
]) {
  check(`"${label}" is refused`, isSafeExpander(label), false);
}

console.log('\n--- a menu is not a disclosure toggle ---');
/*
 * "Show more options" reveals a MENU, and what is in that menu is unknown — on a CRM contact page it is
 * exactly where Delete lives. The labels are anchored at both ends for this reason.
 */
for (const label of [
  'Show more options', 'Show more actions', 'More options', 'More actions', 'More...',
  'Show more and delete', 'show more contacts', 'View more details'
]) {
  check(`"${label}" is refused`, isSafeExpander(label), false);
}

console.log('\n--- the denylist catches what the allowlist would let through ---');
/*
 * Belt and braces. If REI ever ships a control whose entire text is one of the allowed phrases and which
 * destroys something, the words above are the second line of defence. These cases are unreachable today,
 * which is the point of asserting them.
 */
check('"Delete more" — allowlist shape, forbidden verb', isSafeExpander('Delete more'), false);
check('"Send all" — allowlist shape, forbidden verb', isSafeExpander('Send all'), false);
check('"Remove all" — allowlist shape, forbidden verb', isSafeExpander('Remove all'), false);

console.log('\n--- nothing, and nonsense ---');
for (const label of ['', '   ', null, undefined, 0, false, {}, [], 'Show', 'more more more more']) {
  check(`${JSON.stringify(label)} is refused`, isSafeExpander(label), false);
}
/* A long label is refused outright: no disclosure toggle needs twelve characters. */
check('a long label is refused before any pattern runs',
  isSafeExpander('Show more of this note please'), false);

console.log('\n=== the click budget is bounded ===');
/*
 * A contact with many notes has many of these, and expanding one can reveal another. Without a cap a
 * pathological page turns one scrape into an unbounded click loop against the client's CRM.
 */
check('there is a cap at all', typeof MAX_EXPANDS, 'number');
check('...and it is small', MAX_EXPANDS <= 20 && MAX_EXPANDS >= 1, true);

console.log('\n=== the module stays clickable-only ===');
/*
 * Read the shipped source and assert it cannot do anything but click and read. A future edit that adds a
 * fill, a type or a press to this file fails here rather than in the client's CRM.
 */
const SRC = fs.readFileSync('twin-visit-logger-sandbox/src/rei/expand.mjs', 'utf8');
for (const forbidden of ['.fill(', '.type(', '.press(', '.selectOption(', '.setChecked(', '.check(',
  '.uncheck(', '.dragTo(', '.goto(', 'request.', '.evaluate((']) {
  check(`the module never calls ${forbidden}`, SRC.includes(forbidden), false);
}
check('it does click', SRC.includes('.click('), true);
/* The guard must be applied to every candidate, not merely defined. */
check('isSafeExpander gates the click', /candidates\.find\([\s\S]{0,140}?isSafeExpander/.test(SRC), true);
check('failures are swallowed, never thrown at the caller', /catch\s*{/.test(SRC), true);

console.log('\n=== the scraper actually runs it, before reading the page ===');
/*
 * The expansion is worthless if it happens after the text is read. This pins the ORDER: the call must appear
 * before the body innerText that every field is parsed out of.
 */
const SCRAPER = fs.readFileSync('twin-visit-logger-sandbox/src/rei/scraper.mjs', 'utf8');
check('the scraper imports it', /import \{ expandTruncatedText \}/.test(SCRAPER), true);
check('...and calls it', /await expandTruncatedText\(page\)/.test(SCRAPER), true);
check('...before reading the page text',
  SCRAPER.indexOf('await expandTruncatedText(page)') < SCRAPER.indexOf("locator('body').innerText()"), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
