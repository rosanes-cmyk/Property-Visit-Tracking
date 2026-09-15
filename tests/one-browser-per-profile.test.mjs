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
import os from 'node:os';
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

console.log('\n=== A lock is stale when its OWNER IS GONE, not when the file is old ===');
/*
 * THE REST OF THE LOGOUT, caught in the act by the client's session log — two pids, the same seconds, the
 * same profile:
 *
 *   21:19:55  pid 3384   AUTH  REI accepted the session
 *   21:20:21  pid 39700  AUTH  REI showed a login page
 *   21:20:59  pid 3384   AUTH  REI accepted the session
 *
 * One process with a good session, one without, both alive, both in the same browser-data directory. The
 * lock DID hold — for thirty minutes. Then removeStaleLock deleted it because the FILE was old, while the
 * process that owned it was still running with the browser open. A sign-in window left open, or any run
 * over half an hour, had its lock taken and a second Chromium launched on top of it.
 *
 * Run, not read: "does a live owner keep its lock past the window" is a question about behaviour.
 */
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockage-'));
  const cwd = process.cwd();
  process.chdir(dir);
  const L = await import(path.join(ROOT, 'src/utils/lock.mjs'));
  const lockFile = path.join(dir, 'data/run.lock');

  // A lock held by THIS process, backdated well past the staleness window.
  const release = await L.acquireLock('run');
  check('the lock was taken', typeof release, 'function');
  const old = new Date(Date.now() - 90 * 60 * 1000);
  fs.utimesSync(lockFile, old, old);
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, startedAt: old.toISOString() }));
  fs.utimesSync(lockFile, old, old);

  const stolen = await L.acquireLock('run');
  check('a LIVE owner keeps its lock, however old the file is', stolen, null);
  check('...and the lock file is still there', fs.existsSync(lockFile), true);

  /*
   * The case the age rule exists for: a run that died holding it. That must still self-heal, or one crash
   * blocks every later run for ever.
   */
  const deadPid = 2 ** 22;   // above any real pid on Windows or Linux; nothing is running as this
  fs.writeFileSync(lockFile, JSON.stringify({ pid: deadPid, startedAt: old.toISOString() }));
  fs.utimesSync(lockFile, old, old);
  const afterDead = await L.acquireLock('run');
  check('a DEAD owner past the window is cleared', typeof afterDead, 'function');
  if (afterDead) await afterDead();

  // An unreadable lock falls back to the age rule rather than blocking for ever.
  fs.writeFileSync(lockFile, 'not json');
  fs.utimesSync(lockFile, old, old);
  const afterJunk = await L.acquireLock('run');
  check('an unreadable lock past the window is cleared', typeof afterJunk, 'function');
  if (afterJunk) await afterJunk();

  process.chdir(cwd);
  fs.rmSync(dir, { recursive: true, force: true });
}
const LOCKSRC = code(read('src/utils/lock.mjs'));
check('both conditions, not either', /Date\.now\(\) - stat\.mtimeMs <= STALE_AFTER_MS\) return;/.test(LOCKSRC), true);
check('...the owner is read back from the lock file', /JSON\.parse\(await fs\.readFile\(LOCK_PATH, 'utf8'\)\)\?\.pid/.test(LOCKSRC), true);
check('...using heartbeat\'s pidAlive rather than a second copy',
  /import \{ pidAlive \} from '\.\/heartbeat\.mjs'/.test(LOCKSRC), true);
check('a run that stands down says why', /still held by process/.test(read('src/utils/lock.mjs')), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
