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

/*
 * REI's real wording, taken off a live note.
 *
 * Rob Walker's gift note reached the sheet ending "...arrived in good shape ...Show More" — the ellipsis and
 * the label are ONE element, and the anchored match failed on the leading dots, so the note was never
 * expanded and everything past that point was lost.
 */
for (const label of ['...Show More', '…Show more', '... Show more', '...See all', '…More']) {
  check(`"${label}" — REI's own wording — is clickable`, isSafeExpander(label), true);
}
/* Stripping the dots must not disarm the denylist, or "...Delete" would become clickable. */
for (const label of ['...Delete', '…Remove', '...Send all', '…Mark complete']) {
  check(`"${label}" is still refused`, isSafeExpander(label), false);
}
/*
 * LEADING only. A trailing "..." is the opposite convention — "More...", "Show more..." are the desktop
 * idiom for "opens a dialog", and on a CRM contact page that dialog is where Delete lives. "More..." is
 * already refused below alongside "More options"; stripping both ends would have quietly allowed it.
 */
check('"Show more..." is refused — trailing dots mean a dialog', isSafeExpander('Show more...'), false);
check('a bare "..." still survives the stripping', isSafeExpander('...'), true);
check('...and a bare "…" too', isSafeExpander('…'), true);

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
/*
 * The candidate list must not be narrowed back to buttons and roles.
 *
 * That is the bug this file was fixed for: REI's control is on an element the role-based lookup could not
 * see, so Rob Walker's note came back ending "...Show More" and everything past it was lost. tasks.mjs had
 * the identical bug with the Tasks tab, which is an <a>. What an element IS matters less than what it SAYS.
 */
const SELECTOR = (SRC.match(/page\.\$\$eval\(\s*\n?\s*'([^']+)'/) || [])[1] || '';
for (const tag of ['button', 'a', 'span', 'div', 'p', 'li', '[role]']) {
  check(`${tag} elements are candidates`, SELECTOR.split(',').map((s) => s.trim()).includes(tag), true);
}
/* textContent, not innerText — innerText forces a layout pass per element and the list is now the page. */
check('the scan is cheap', /textContent \|\| ''/.test(SRC), true);
check('...and long text can never look like a label', /c\.text\.length <= 16/.test(SRC), true);
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
