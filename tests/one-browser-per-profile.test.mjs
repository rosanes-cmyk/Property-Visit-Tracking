/**
 * Nothing opens the REI profile without holding the run lock.
 *
 *   node tests/one-browser-per-profile.test.mjs
 *
 * THIS IS WHY REI KEPT SIGNING ITSELF OUT, and it took a week and four wrong theories to find. From the
 * client's own logs/rei-session.log, three OPEN lines on one profile:
 *
 *   2026-09-15T15:07:05  pid 7520    OPEN  ...\browser-data\rei-fresh  reiCookies=17
 *   2026-09-15T15:13:31  pid 126140  OPEN  ...\browser-data\rei-fresh  reiCookies=17
 *   2026-09-15T15:45:07  pid 139868  OPEN  ...\browser-data\rei-fresh  reiCookies=0
 *
 * Two Chromium processes in the same profile directory at once, and half an hour later the cookie jar is
 * empty. Chromium does not merge concurrent access to a profile: whichever instance closes LAST writes its
 * own in-memory state over the other's. So a run that opened before the login finished, and closed after it,
 * wrote a near-empty cookie store on top of a good session.
 *
 * WHAT MADE IT INVISIBLE: every close was clean. `CLOSE context closed`, `EXIT code=0 (context had closed
 * cleanly)`, `PREV the previous run closed Chromium cleanly (exit_type=Normal)` — the whole log is green.
 * Nothing crashed. My leading theory for days was that the process was being killed before it could flush
 * cookies, and the log says plainly that it was not. A guard that reports "clean" can still be describing a
 * disaster if it is only watching one of the two processes involved.
 *
 * THE GAP: every SCHEDULED job took the lock. Six hand-run scripts did not — and one of them is printed on
 * screen by the re-check itself as the thing to run next:
 *
 *   Settle one with:  node scripts/rei-task-doctor.mjs "https://my.reiblackbook.com/contacts/20284479"
 *
 * So the reliable way to lose the REI session was to follow the instructions the software gave you, while a
 * sweep happened to be running. That is not a user error.
 *
 * This enumerates every file that can open the profile and insists each one holds the lock first. A new
 * script that forgets is the same bug again, and nothing else would notice.
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

const ROOT = path.resolve('twin-visit-logger-sandbox');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/* Every file under scripts/ and src/ that can open the browser, found rather than listed. */
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]))
  .filter((f) => f.endsWith('.mjs'));

const openers = [...walk('scripts'), ...walk('src')]
  .filter((f) => /launchReiContext\s*\(/.test(code(read(f))));

console.log(`=== ${openers.length} file(s) can open the REI profile ===`);
check('the search found the openers rather than an empty list', openers.length >= 10, true);

/*
 * browser.mjs is the launcher itself, and run-once/poll take the lock in their own entry point before
 * calling into services. Both are named here so an exemption is a decision somebody wrote down, not a
 * silence — the original bug lived entirely in things nobody had listed.
 */
const LOCKED_BY_CALLER = {
  'src/rei/browser.mjs': 'the launcher itself; every caller takes the lock',
  'src/services/process.mjs': 'called only from run-once.mjs, which acquires the lock first'
};

for (const file of openers.sort()) {
  const src = code(read(file));
  const why = LOCKED_BY_CALLER[file];
  if (why) {
    check(`${file} is exempt (${why})`, /acquireLock/.test(src), false);
    continue;
  }
  check(`${file} takes the run lock`, /acquireLock(Waiting)?\s*\(/.test(src), true);
  /*
   * BEFORE the browser opens, not after. A lock taken afterwards leaves exactly the window this bug needs,
   * and would read as correct in review.
   */
  const lockAt = src.search(/acquireLock(Waiting)?\s*\(/);
  const openAt = src.search(/launchReiContext\s*\(/);
  check(`${file} ...takes it BEFORE opening the browser`, lockAt >= 0 && lockAt < openAt, true);
}

console.log('\n=== run-once really does hold it before the intake opens anything ===');
// The one exemption that rests on a caller: worth proving rather than trusting the comment above.
const RUNONCE = code(read('src/run-once.mjs'));
check('run-once acquires the lock', /const release = await acquireLock\(\)/.test(RUNONCE), true);
check('...before it calls processInbox',
  RUNONCE.search(/await acquireLock\(\)/) < RUNONCE.search(/processInbox\(/), true);

console.log('\n=== The hand-run tools WAIT rather than giving up ===');
/*
 * A hand-run tool that exits on a busy lock is a tool somebody re-runs immediately, and then keeps re-running
 * — which is how you end up with two of them open at once anyway. Waiting is what notes-doctor already did.
 */
for (const file of ['scripts/add-visit-from-rei.mjs', 'scripts/inspect-rei.mjs', 'scripts/rei-fields.mjs',
  'scripts/rei-task-doctor.mjs', 'scripts/scrape-dump.mjs', 'scripts/test-scrape.mjs',
  'scripts/notes-doctor.mjs']) {
  check(`${path.basename(file)} waits for the browser`, /acquireLockWaiting\('run'/.test(code(read(file))), true);
}

console.log('\n=== ...and release it however they end ===');
for (const file of ['scripts/add-visit-from-rei.mjs', 'scripts/rei-task-doctor.mjs', 'scripts/test-scrape.mjs']) {
  check(`${path.basename(file)} releases on exit`,
    /process\.on\('exit', \(\) => \{ releaseRei\(\); \}\)/.test(code(read(file))), true);
}

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
