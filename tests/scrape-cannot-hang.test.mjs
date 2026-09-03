/**
 * One slow contact cannot hold up every booking behind it.
 *
 *   node tests/scrape-cannot-hang.test.mjs
 *
 * THE FAILURE. Three parked bookings. The first, William/Linda Tifer, went through perfectly — matched on
 * "925-783-8506", address read, row 399 filled, calendar event set. The second printed:
 *
 *     --- Mario
 *       looking up REI by phone: 15104858266
 *         REI matched on "5104858266"
 *       About panel settled with 43 field(s)
 *       Expanded 8 truncated note(s)
 *
 * and then nothing, for fifteen minutes. Jessica Lee, third in the queue, was never looked at.
 *
 * THE CAUSE, in expandTruncatedText. It clicked with `{ timeout: 3000 }`, and
 * `page.getByText(/^Show More$/i)` matches EVERY element with that text — including ones inside collapsed
 * or off-screen cards, which Playwright discovers are unclickable only by waiting the whole timeout.
 * Mario's contact carries 22 associated contacts. So a round could spend 12 x 3s, twelve rounds nearly
 * seven minutes, and the function is called FOUR times per lead: once by the scraper and once per
 * readNotesTab attempt, each with its own independent allowance. Half an hour on one contact.
 *
 * The existing cap could not catch it: MAX_EXPANDS counts CLICKS, and the cost here is per failed click.
 *
 * Everything below the About panel is enrichment — the address, the appointment and the calendar event are
 * already read by the time the expanders run. So the trade is explicit: lose the tail of a note rather than
 * lose the queue.
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

const EXPAND = read('twin-visit-logger-sandbox/src/rei/expand.mjs');
const NOTES = read('twin-visit-logger-sandbox/src/rei/notes-tab.mjs');
const FILL = read('twin-visit-logger-sandbox/scripts/fill-pending-rei.mjs');

console.log('=== The expander has a wall clock, not just a click cap ===');
check('a budget exists', /export const EXPAND_BUDGET_MS = /.test(EXPAND), true);
check('...checked before each round', /if \(outOfTime\(\)\) \{ out\.ranOut = true; return out; \}/.test(strip(EXPAND)), true);
/*
 * Inside the inner loop too, and that is the one that mattered: the outer round cap was never the problem,
 * because a single round could spend 12 x 3s on one candidate's matches.
 */
const inner = strip(EXPAND).slice(strip(EXPAND).indexOf('for (let n = 0; n < count'));
check('...and inside the click loop, which is where the time went',
  /if \(outOfTime\(\)\) \{ out\.ranOut = true; return out; \}/.test(inner), true);
check('...and it is a real slice, not an empty one', inner.length > 300, true);
check('running out is reported, not silent', /ranOut/.test(EXPAND), true);

console.log('\n=== A click no longer costs three seconds to fail ===');
check('visibility is checked first, which answers immediately',
  /if \(!\(await one\.isVisible\(\)\.catch\(\(\) => false\)\)\) \{ out\.skipped \+= 1; continue; \}/.test(strip(EXPAND)), true);
check('the click timeout is well under the old 3s',
  Number((EXPAND.match(/const CLICK_TIMEOUT_MS = (\d+);/) || [])[1]) <= 1500, true);
check('the old 3000ms click is gone', /click\(\{ timeout: 3000 \}\)/.test(strip(EXPAND)), false);
/*
 * `clicked` was incremented unconditionally, right beside the catch that recorded the failure — so
 * "Expanded 8 truncated note(s)" counted eight ATTEMPTS, several of which may have been 3-second timeouts.
 * Both leads reporting exactly 8 was the clue that the number meant something other than notes.
 */
check('a failed click no longer counts as an expansion',
  /if \(ok\) out\.clicked \+= 1; else out\.skipped \+= 1;/.test(strip(EXPAND)), true);

console.log('\n=== The budget is RUN, not just declared ===');
{
  /*
   * Lifted and executed against a fake page whose clicks never resolve — the exact shape of the hang. A
   * source check cannot tell a budget that works from one that is declared and never consulted.
   */
  const src = EXPAND.slice(EXPAND.indexOf('export async function expandTruncatedText'));
  const body = src.slice(0, src.indexOf('\n}\n') + 3).replace(/^export /, '');
  const expandTruncatedText = new Function(`
    const EXPAND_BUDGET_MS = 400;
    const CLICK_TIMEOUT_MS = 1200;
    const MAX_EXPANDS = 12;
    const isSafeExpander = () => true;
    ${body}
    return expandTruncatedText;
  `)();

  /*
   * The fake HONOURS the timeout it is given, exactly as Playwright does — it rejects after it rather than
   * resolving late. My first version ignored it and slept 60s, so the test itself hung for two minutes and
   * proved nothing: with a click that never returns, no budget between clicks can help, and that is not a
   * shape Playwright produces. A fake that is more hostile than reality tests a fiction.
   *
   * 50 matching elements, all visible, none clickable: Mario's page with its 22 associated contacts.
   */
  let clicksAttempted = 0;
  const hangingPage = {
    $$eval: async () => [{ i: 0, text: 'Show More' }],
    getByText: () => ({
      count: async () => 50,
      nth: () => ({
        isVisible: async () => true,
        click: ({ timeout }) => new Promise((_, reject) => {
          clicksAttempted += 1;
          setTimeout(() => reject(new Error('Timeout exceeded')), timeout);
        })
      })
    }),
    waitForTimeout: async () => {}
  };

  const started = Date.now();
  const out = await expandTruncatedText(hangingPage, {});
  const took = Date.now() - started;
  check('a page of unclickable expanders still returns', typeof out, 'object');
  // 400ms budget, 1200ms per doomed click: one click can overrun it, twelve rounds of twelve cannot.
  check('...within a second or two, not minutes', took < 4000, true);
  check('...and says it ran out of time', out.ranOut, true);
  check('nothing is reported as expanded, because nothing was', out.clicked, 0);
  check('every doomed click is counted as skipped', out.skipped >= 1, true);
  /*
   * The number that matters. Unbounded, this page is 12 rounds x 12 clicks = 144 doomed clicks at 1.2s
   * each — nearly three minutes, and that is AFTER the timeout was shortened from 3s. The budget stops it
   * within a handful.
   */
  check('it gives up after a handful of clicks, not 144', clicksAttempted <= 5, true);
}

console.log('\n=== Three notes attempts share ONE budget ===');
/*
 * Each attempt reloads, re-clicks the tab and re-runs every expander. Three independent allowances multiply
 * straight back into the hang this exists to stop.
 */
check('the notes read has its own budget', /export const NOTES_BUDGET_MS = /.test(NOTES), true);
check('...one deadline for the whole read', /const deadline = Date\.now\(\) \+ budgetMs;/.test(strip(NOTES)), true);
check('...and the expanders are handed that same deadline',
  /expandTruncatedText\(page, \{ deadline \}\)/.test(strip(NOTES)), true);
check('a retry that cannot be afforded is not attempted',
  /if \(attempts && outOfTime\(\)\) break;/.test(strip(NOTES)), true);
check('running out of budget is said in the failure message',
  /ran out of its \$\{Math\.round\(budgetMs \/ 1000\)\}s budget/.test(NOTES), true);
// Generous enough not to cut short a tab that is genuinely slow, short enough that it cannot cost a morning.
check('the notes budget is between 20s and 90s',
  (() => { const n = Number((NOTES.match(/NOTES_BUDGET_MS = ([\d_]+);/) || [])[1].replace(/_/g, ''));
    return n >= 20_000 && n <= 90_000; })(), true);

console.log('\n=== And a backstop, because the next unbounded step is one I have not thought of ===');
check('the per-lead budget exists', /const LEAD_BUDGET_MS = /.test(FILL), true);
check('...and wraps the scrape at BOTH call sites',
  (strip(FILL).match(/withLeadBudget\(/g) || []).length, 3);   // the definition plus two call sites
check('the timer is always cleared, so a fast lead leaves nothing pending',
  /\.finally\(\(\) => clearTimeout\(timer\)\)/.test(FILL), true);
check('the message says the row stays parked and the run carries on',
  /The row stays parked and the next run will try it again/.test(FILL), true);
/*
 * Four minutes: a slow REI page legitimately takes 60-90 seconds with the notes tab and its retries. Too
 * tight and it cuts short work that was succeeding, which would be a worse bug than the one it fixes.
 */
check('the lead budget is minutes, not seconds',
  (() => { const m = FILL.match(/const LEAD_BUDGET_MS = (\d+) \* 60 \* 1000;/);
    return m && Number(m[1]) >= 3 && Number(m[1]) <= 10; })(), true);
/*
 * The abandoned page is deliberately NOT force-closed. Racing a promise stops us WAITING for it, not the
 * work itself, and tearing a page out from under a running scrape turns a stall into a crash that loses the
 * leads already finished. The context close cleans it up.
 */
check('the abandoned scrape is left to the context close, and that is written down',
  /left to the context close/.test(FILL), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
