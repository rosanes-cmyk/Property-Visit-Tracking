/**
 * The decisions that guard posting into a real group chat.
 *
 *   node tests/whatsapp-post-gate.test.mjs
 *
 * These three functions are the difference between "the note went to the right group, once" and the
 * two failures that actually happened: a note that went nowhere because the header could not be read,
 * and a group left permanently noteless because the run recorded it as finished.
 */
import {
  firstLine, titlesMatch, noteAlreadyPresent, eventsFinished, plausibleTitle, NOTE_MARKER
} from '../twin-visit-logger-sandbox/src/whatsapp/post-gate.mjs';
import { buildInspectionNote } from '../twin-visit-logger-sandbox/src/whatsapp/note.mjs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

const NAME = '1390 Estudillo Ave, San Leandro, CA 94577';

console.log('=== firstLine: a conversation header is "subject\\nparticipants" ===');
check('takes the subject only', firstLine(`${NAME}\nYou, Juan, Matt, Cherry, Arly`), NAME);
check('collapses whitespace', firstLine('  1390   Estudillo  Ave  '), '1390 Estudillo Ave');
check('empty stays empty', firstLine(''), '');
check('undefined stays empty', firstLine(undefined), '');

console.log('\n=== plausibleTitle: WhatsApp furniture is not a chat name ===');
/*
 * This is the exact string that stopped a working run posting anything. Both groups were created
 * correctly with all four members, and then: the open conversation is "click here for group info".
 * The header's title ATTRIBUTE says that, so it must never be taken for the subject.
 */
check('"click here for group info" is rejected', plausibleTitle('click here for group info'), '');
check('"click here for contact info" too', plausibleTitle('Click here for contact info'), '');
check('"profile details" is rejected', plausibleTitle('Profile details'), '');
check('"online" is rejected', plausibleTitle('online'), '');
check('"typing…" is rejected', plausibleTitle('typing…'), '');
check('a member count is rejected', plausibleTitle('4 members'), '');
check('"last seen today at 9:41" is rejected', plausibleTitle('last seen today at 9:41'), '');

console.log('\n--- while real names come through untouched ---');
check('the group subject', plausibleTitle(NAME), NAME);
check('a header with the participant line under it',
  plausibleTitle(`${NAME}\nYou, Juan, Matt, Cherry, Arly`), NAME);
check('the test lead', plausibleTitle('Test, Test, Test, CA'), 'Test, Test, Test, CA');
check("a seller's name", plausibleTitle('Jon Box'), 'Jon Box');
check('an address that merely starts with a number', plausibleTitle('4 Members Way, Napa, CA'), '4 Members Way, Napa, CA');
check('empty stays empty', plausibleTitle(''), '');

console.log('\n=== titlesMatch: is the chat on screen the group we mean? ===');
check('exact match', titlesMatch(NAME, NAME), true);
check('whitespace differences do not matter', titlesMatch(`  ${NAME} `, NAME), true);
check('a header WhatsApp truncated is accepted', titlesMatch('1390 Estudillo Ave, San Lea…', NAME), true);
check('...with three dots too', titlesMatch('1390 Estudillo Ave, San Lea...', NAME), true);

console.log('\n--- and it refuses everything else ---');
// Each of these is a chat the warm-up could have left open. Posting into any of them sends the
// team's briefing to the wrong people.
check('a seller 1:1 chat', titlesMatch('Jon Box', NAME), false);
check('another visit group', titlesMatch('742 Evergreen Terrace, Springfield, CA 90210', NAME), false);
check('a short prefix is NOT enough', titlesMatch('1390', NAME), false);
check('an 11-char stem is still too short', titlesMatch('1390 Estudi', NAME), false);
check('nothing open at all', titlesMatch('', NAME), false);
check('no group name given', titlesMatch(NAME, ''), false);
check('the same address plus a date suffix is not this group',
  titlesMatch(`${NAME} - Aug 4`, NAME), false);
// A superstring must fail: the header being LONGER than the name means it is a different chat.
check('a longer header is not a match', titlesMatch(`${NAME} (old)`, NAME), false);

console.log('\n=== noteAlreadyPresent: re-running must not post twice ===');
const note = buildInspectionNote({ propertyAddress: NAME }, { appointmentText: 'Mon Aug 4, 2:00 PM' });
check('recognises a note this project built', noteAlreadyPresent(note), true);
check('recognises it inside a whole conversation transcript',
  noteAlreadyPresent(`Juan: on my way\n${note}\nMatt: 👍`), true);
check('an empty conversation has no note', noteAlreadyPresent(''), false);
check('ordinary chatter is not a note',
  noteAlreadyPresent('Matt: parked outside\nJuan: coming down'), false);
check('the marker is the note heading', note.startsWith(NOTE_MARKER), true);

console.log('\n=== eventsFinished: which events need nothing further ===');
const groups = {
  hasNote: { name: 'A', notePosted: true },
  noNote: { name: 'B' },
  explicitlyFalse: { name: 'C', notePosted: false },
  empty: null
};
check('with note posting ON, only the noted group is finished',
  [...eventsFinished(groups, { requireNote: true })], ['hasNote']);
// This is the bug that stranded the first real group: recorded, noteless, and skipped forever after.
check('a noteless group is NOT finished, so it comes round again',
  eventsFinished(groups, { requireNote: true }).has('noNote'), false);
check('with note posting OFF, having the group is enough',
  [...eventsFinished(groups, { requireNote: false })], ['hasNote', 'noNote', 'explicitlyFalse']);
check('a null entry never counts as finished',
  eventsFinished(groups, { requireNote: false }).has('empty'), false);
check('an empty state finishes nothing', [...eventsFinished({}, {})], []);
check('a missing state does not throw', [...eventsFinished(undefined, {})], []);
check('requireNote defaults to true — the safe direction',
  eventsFinished({ x: { name: 'X' } }).has('x'), false);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
