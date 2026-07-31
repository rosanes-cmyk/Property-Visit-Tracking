/**
 * ProfitDial from-number matching tests.
 *
 *   node tests/profitdial-number.test.mjs
 *
 * These cover the only part of the ProfitDial work that can be proven without a live REI page: the
 * digit-for-digit comparison and the phone-shape guard that stops a mis-resolved selector from
 * clicking a non-number control (a "Call" or "Send" button).
 *
 * The functions are imported from the real module, so the test cannot drift from shipped code.
 */
import { digitsOf, sameNumber, looksLikePhone } from '../twin-visit-logger-sandbox/src/rei/profitdial.mjs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)} but got ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

const TARGET = '(510) 916-3995';

console.log('=== digitsOf ===');
check('strips formatting', digitsOf(TARGET), '5109163995');
check('keeps a country code', digitsOf('+1 (510) 916-3995'), '15109163995');
check('null is empty', digitsOf(null), '');

console.log('\n=== sameNumber: the same number in any format matches ===');
check('identical', sameNumber(TARGET, TARGET), true);
check('dotted form', sameNumber('510.916.3995', TARGET), true);
check('bare digits', sameNumber('5109163995', TARGET), true);
check('E.164', sameNumber('+15109163995', TARGET), true);
check('country code on one side only', sameNumber('1 (510) 916-3995', '5109163995'), true);
check('padded label text is still compared on digits', sameNumber(' (510) 916-3995 ', TARGET), true);

console.log('\n=== sameNumber: a different number must NOT match ===');
check('one digit off', sameNumber('(510) 916-3996', TARGET), false);
check('different area code', sameNumber('(707) 916-3995', TARGET), false);
check('transposed digits', sameNumber('(510) 916-3959', TARGET), false);

console.log('\n=== sameNumber: partials never pass (this is the trap the guard exists for) ===');
check('suffix only', sameNumber('3995', TARGET), false);
check('area code only', sameNumber('510', TARGET), false);
check('empty string', sameNumber('', TARGET), false);
check('null', sameNumber(null, TARGET), false);
check('no digits at all', sameNumber('Select a number', TARGET), false);
check('nothing read from the page', sameNumber('', ''), false);

console.log('\n=== looksLikePhone: only a bare number is clickable ===');
check('formatted number', looksLikePhone(TARGET), true);
check('E.164', looksLikePhone('+15109163995'), true);
check('a Send button is not a number', looksLikePhone('Send'), false);
check('a Call button carrying a number is rejected', looksLikePhone('Call (510) 916-3995'), false);
check('a labelled option is rejected', looksLikePhone('From: (510) 916-3995'), false);
check('empty', looksLikePhone(''), false);
check('too few digits', looksLikePhone('916-3995'), false);
check('too many digits', looksLikePhone('1234567890123456'), false);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
