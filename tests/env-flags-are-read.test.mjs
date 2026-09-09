/**
 * A .env flag means what the file says, not what the whitespace says.
 *
 *   node tests/env-flags-are-read.test.mjs
 *
 * THE BUG, and it cost days of the client's time and two wrong theories of mine.
 *
 * Their .env said `CHAT_VISIT_BRIEFING=true`. They checked it with findstr and showed me the output. The
 * very next run printed:
 *
 *     Chat briefing: OFF - set CHAT_VISIT_BRIEFING=true in .env to have bookings post to Chat
 *
 * `bool()` lowercased the value and compared it against ['1','true','yes','on'] — without trimming. A
 * trailing space or a stray carriage return makes the value 'true ' or 'true\r', neither of which is in
 * that list, so the flag read FALSE while the file plainly said true. Hand-editing a .env in Notepad on
 * Windows is exactly how that happens, and nothing anywhere could report it: the flag was simply off.
 *
 * THE TELL was in the same file. `chatAlerts` is the one setting that already called .trim(), and it read
 * correctly (`on`) in the same run where CHAT_VISIT_BRIEFING did not. Same file, same edit, one parsed and
 * one did not — that difference is the bug, and it was in the parser, not in their .env.
 *
 * It governs every boolean in the project — WHATSAPP_ENABLED, REI_COMPLETE_TASKS, AUTOMATION_PAUSED,
 * ADD_MISSING_COLUMNS — so any of them could have been silently reading the opposite of the file.
 */
import fs from 'node:fs';
import path from 'node:path';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

const CFG = fs.readFileSync(path.resolve('twin-visit-logger-sandbox/src/config.mjs'), 'utf8');

/*
 * Lifted and RUN. The whole question is what a given string parses to, which source-matching cannot answer:
 * a `.trim()` sitting in the file proves nothing about whether 'true\r' comes back true.
 */
const bool = new Function(
  CFG.slice(CFG.indexOf('const bool = (value'), CFG.indexOf('const int = (value')) + '; return bool;'
)();

console.log('=== The shapes a hand-edited .env on Windows actually produces ===');
// The exact value that read as OFF on the client's machine.
check("'true ' (trailing space) is true", bool('true ', false), true);
check("'true\\r' (CRLF leftover) is true", bool('true\r', false), true);
check("' true' (leading space) is true", bool(' true', false), true);
check("'true\\t' (tab) is true", bool('true\t', false), true);
check("'true' is still true", bool('true', false), true);
check("'TRUE' is true", bool('TRUE', false), true);
check("'True ' is true", bool('True ', false), true);

console.log('\n=== ...and the other spellings the .env.example offers ===');
for (const yes of ['1', 'yes', 'on', 'YES ', 'On\r']) {
  check(`${JSON.stringify(yes)} is true`, bool(yes, false), true);
}
for (const no of ['0', 'false', 'no', 'off', 'FALSE ', 'off\r']) {
  check(`${JSON.stringify(no)} is false`, bool(no, true), false);
}

console.log('\n=== Absent means the default, and the default is honoured either way ===');
check('undefined falls back to false', bool(undefined, false), false);
check('undefined falls back to TRUE when that is the default', bool(undefined, true), true);
check("'' falls back", bool('', true), true);
check("'   ' falls back too", bool('   ', true), true);

console.log('\n=== A value nobody can read is REPORTED, not silently treated as off ===');
/*
 * "off" and "I could not read what you wrote" are different answers, and only one of them is the user's
 * fault. Falling back silently is what made the original bug invisible: the flag was just off, with no
 * hint that the file said otherwise.
 */
{
  const warnings = [];
  const orig = console.warn;
  console.warn = (m) => warnings.push(String(m));
  const got = bool('ture', false);          // the typo somebody will actually make
  console.warn = orig;
  check('an unreadable value falls back', got, false);
  check('...and says so on screen', warnings.length, 1);
  check('...quoting what was written', /could not read "ture" as yes\/no/.test(warnings[0] || ''), true);
  check('...and listing what is valid', /true\/false, yes\/no, on\/off, 1\/0/.test(warnings[0] || ''), true);
}
{
  // A recognised value must NOT warn, or the warning becomes noise on every run.
  const warnings = [];
  const orig = console.warn;
  console.warn = (m) => warnings.push(String(m));
  bool('true ', false); bool('off', true); bool(undefined, false); bool('', true);
  console.warn = orig;
  check('a value it understands warns about nothing', warnings.length, 0);
}

console.log('\n=== The parser trims; the one setting that hand-rolled it still works ===');
check('bool() trims before comparing', /String\(value\)\.trim\(\)\.toLowerCase\(\)/.test(CFG), true);
/*
 * chatAlerts predates this and does its own trim inline. Left alone deliberately: it is correct, it is the
 * setting that proved the bug, and rewriting working code while fixing something else is how a one-line
 * fix turns into a regression hunt.
 */
check('chatAlerts still trims for itself',
  /\(process\.env\.CHAT_ALERTS \|\| 'on'\)\.trim\(\)\.toLowerCase\(\) !== 'off'/.test(CFG), true);

console.log('\n=== Every flag that matters goes through it ===');
// Named individually: these are the switches whose silent inversion would be worst.
for (const [env, key] of [
  ['CHAT_VISIT_BRIEFING', 'chatVisitBriefing'],
  ['WHATSAPP_ENABLED', 'whatsappEnabled'],
  ['REI_COMPLETE_TASKS', 'reiCompleteTasks']
]) {
  check(`${env} is parsed by bool()`,
    new RegExp(`${key}: bool\\(process\\.env\\.${env}`).test(CFG), true);
}

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
