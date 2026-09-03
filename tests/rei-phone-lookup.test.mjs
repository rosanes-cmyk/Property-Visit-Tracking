/**
 * A parked booking is found by phone — and a WRONG contact is never read.
 *
 *   node tests/rei-phone-lookup.test.mjs
 *
 * THE FAILURE. Three parked bookings, all findable in REI, none found:
 *
 *     Mario
 *       looking up REI by phone: 15104858266
 *       REI could not be read: Could not locate the REI contact (no direct contact link and no phone match)
 *
 * The client had Mario's REI record open at that moment: phone (510) 485-8266, property 917 26th Ave,
 * Oakland, appointment Sep 04 2026 10:00 AM, assigned to Juan. Everything the row needed, on screen.
 *
 * The tracker stores phones as bare digits WITH the country code — 15104858266 — and the search tried only
 * that. It looked like two attempts:
 *
 *     const digits = String(phone).replace(/\D/g, '');
 *     const attempts = [...new Set([String(phone).trim(), digits].filter(Boolean))];
 *
 * but when the stored value is already digits, both entries are the same string and the Set collapses them
 * to one. So REI was asked exactly once, for a form it does not hold.
 *
 * THE SECOND BUG, which was worse and had not fired yet. The search took the FIRST `a[href*="/contacts/"]`
 * on the page — and that page starts as the FULL contact list. A search that failed to filter would return
 * a stranger's contact, and the scrape would write their address, appointment time and owner onto this
 * booking. A parked row is a visible nothing; a wrong address sends a colleague to the wrong house.
 *
 * So: exactly one contact or none, and then the contact still has to PROVE it is the right person before
 * anything is read off it.
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

const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const SRC = read('twin-visit-logger-sandbox/src/rei/scraper.mjs');
const CODE = strip(SRC);

/* Lifted and RUN, not pattern-matched. The whole point is which strings REI actually gets asked for. */
function lift(name) {
  const start = SRC.indexOf(`export function ${name}(`);
  if (start < 0) throw new Error(`no exported ${name}`);
  const end = SRC.indexOf('\n}', start);
  return SRC.slice(start, end + 2).replace(/^export /, '');
}
const { phoneSearchTerms, phoneKey } = new Function(`
  ${lift('phoneSearchTerms')}
  ${lift('phoneKey')}
  return { phoneSearchTerms, phoneKey };
`)();

console.log('=== The number REI actually holds is asked for FIRST ===');
// Mario, the lead that failed. REI shows (510) 485-8266; the tracker holds 15104858266.
check('the 11-digit tracker form yields the 10-digit national form first',
  phoneSearchTerms('15104858266')[0], '5104858266');
check('...then the form REI displays',
  phoneSearchTerms('15104858266')[1], '(510) 485-8266');
check('...then the dashed form', phoneSearchTerms('15104858266')[2], '510-485-8266');
// Kept last rather than dropped: it is what the tracker holds, and a match on it would be worth knowing.
check('...and the original is still tried last',
  phoneSearchTerms('15104858266').includes('15104858266'), true);
check('the old code asked exactly once', [...new Set(['15104858266'.trim(), '15104858266'.replace(/\D/g, '')])].length, 1);
check('...and now asks four ways', phoneSearchTerms('15104858266').length, 4);

console.log('\n=== Every shape a stored phone arrives in ===');
for (const [given, wantFirst] of [
  ['15104858266', '5104858266'],
  ['(510) 485-8266', '5104858266'],
  ['5104858266', '5104858266'],
  ['+1 510-485-8266', '5104858266'],
  ['510.485.8266', '5104858266'],
  // The other two parked rows.
  ['19257838506', '9257838506'],
  ['17076883822', '7076883822']
]) check(`${given} searches ${wantFirst} first`, phoneSearchTerms(given)[0], wantFirst);
check('nothing is searched for an empty phone', phoneSearchTerms(''), []);
check('...or a phone with no digits in it', phoneSearchTerms('none on file'), []);
// A number that is not ten digits still gets tried rather than being silently dropped.
check('a short or foreign number is still attempted', phoneSearchTerms('4858266').length > 0, true);

console.log('\n=== The last-seven shortcut is deliberately absent ===');
/*
 * It would find more contacts, and that is precisely the problem: several people share the last seven
 * digits of a US number. The cost of a miss is a parked row somebody can see; the cost of a wrong match is
 * a stranger's address on a booking and a colleague at the wrong house.
 */
check('no bare 7-digit term is generated',
  phoneSearchTerms('15104858266').some((t) => t.replace(/\D/g, '').length === 7), false);
check('...and the reason is written down', /last-seven form is deliberately NOT here/.test(SRC), true);

console.log('\n=== phoneKey identifies a person regardless of formatting ===');
const forms = ['15104858266', '(510) 485-8266', '510.485.8266', '+15104858266', '510-485-8266'];
check('every form of one number gives one key', [...new Set(forms.map(phoneKey))].length, 1);
check('...and that key is the last ten digits', phoneKey('15104858266'), '5104858266');
check('a different person gives a different key',
  phoneKey('15104858266') === phoneKey('19257838506'), false);
check('an empty phone has no key', phoneKey(''), '');

console.log('\n=== Exactly one contact, or none ===');
/*
 * The regression that had not fired yet. `a[href*="/contacts/"]` .find(...) took the first link on a page
 * that STARTS as the full contact list, so a search that did not filter returned a stranger.
 */
check('the old first-link-wins read is gone',
  /\.find\(\(a\) => \/\\\/contacts\\\/\\d\+\/\.test/.test(CODE), false);
check('distinct contact ids are counted', /const ids = new Set\(\);/.test(CODE), true);
// Counted by ID, because REI renders several anchors per row all pointing at the same contact.
check('...by id, not by anchor', /\/\\\/contacts\\\/\(\\d\+\)\//.test(CODE), true);
check('one match is accepted', /if \(found\.length === 1\) \{/.test(CODE), true);
check('several matches are refused, and it moves on to the next form',
  /if \(found\.length > 1\) \{/.test(CODE), true);
check('...saying so on screen', /too many to be sure, trying the next form/.test(SRC), true);
check('the term that worked is logged, so REI\'s real format becomes known',
  /REI matched on "\$\{term\}"/.test(SRC), true);

console.log('\n=== A found contact must PROVE it is the right person ===');
/*
 * Strict is not the same as verified. REI's search could match on a note, a second number, an address; the
 * page could be a stale render. Each ends with a stranger's details on this booking.
 */
check('a contact reached by search is remembered as such', /let foundByPhone = '';/.test(CODE), true);
check('...and only then verified', /if \(foundByPhone\) \{/.test(CODE), true);
check('the page phone is compared by last-ten digits',
  /const want = phoneKey\(foundByPhone\);[\s\S]{0,80}const got = phoneKey\(phone\);/.test(CODE), true);
check('a mismatch refuses and reads nothing', /a different person\. Nothing was read from it/.test(SRC), true);
check('...naming both numbers so it can be checked', /whose phone is \$\{phone\}/.test(SRC), true);
check('...and linking the page', /Page: \$\{contactPageUrl\(page\.url\(\)\)\}/.test(SRC), true);
/*
 * No phone on the page is NOT treated as a match. The About panel may simply not have painted it — which
 * this scraper has been caught by before — so it is refused with its own message rather than waved through.
 */
check('a contact with no phone is refused too', /shows no `\s*\n\s*\+ `phone number/.test(SRC), true);
check('...with a different message, because it is a different problem',
  /no way to confirm it is the right person/.test(SRC), true);
// A DIRECT REI link is trusted as before: somebody chose that contact, so there is nothing to second-guess.
check('a direct contact link is not put through the phone check',
  CODE.indexOf('let foundByPhone') < CODE.indexOf('if (foundByPhone)'), true);
check('...and foundByPhone is only set on the search path',
  /targetUrl = await findContactUrlByPhone\(page, emailFallback\.phone\);\s*\n\s*if \(targetUrl\) foundByPhone = emailFallback\.phone;/.test(CODE), true);

console.log('\n=== The failure message says what to do about it ===');
/*
 * "no direct contact link and no phone match" told nobody anything actionable. The row it describes CAN be
 * fixed by hand in ten seconds — paste the REI link — and nothing said so.
 */
check('it lists what was actually searched for',
  /Searched '\s*\n\s*\+ phoneSearchTerms\(emailFallback\.phone\)\.map/.test(CODE), true);
check('...and says the link column is the fix',
  /copy its contact link into the /.test(CODE), true);
/*
 * Against CODE, not SRC. My first version of this read the raw file — where the comment explaining the fix
 * QUOTES the old message verbatim — so it failed on correct code. That is the seventh time in this project
 * an assertion has been decided by prose rather than by code, and the third where a check that something
 * was REMOVED tripped on the note explaining the removal. A negative assertion has to read stripped source.
 */
check('the old dead-end wording is gone',
  /no direct contact link and no phone match/.test(CODE), false);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
