/**
 * Auto-update, through the client's own Google Drive.
 *
 *   node tests/updates.test.mjs
 *
 * Asked for directly: "can we have this app auto update button if ther bug or issue in the app and it will
 * get the the update and just installed it."
 *
 * An updater is the most dangerous thing in this project, for two reasons that pull in opposite directions.
 * It can leave the machine with NO working app — the one outcome that is worse than never updating. And it is
 * a code-execution path: whoever can write to that Drive folder runs code on the PC, as the Windows user,
 * with the Google token and the REI session right there.
 *
 * So the shape matters more than the plumbing: verify before installing, keep the previous version, refuse
 * while a job is running, and never install silently.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  compareVersions, versionFromName, installedVersion, checkForUpdate, downloadUpdate, UPDATE_FOLDER
} from '../twin-visit-logger-sandbox/src/google/updates.mjs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}
const read = (p) => fs.readFileSync(path.resolve('twin-visit-logger-sandbox', p), 'utf8');

console.log('=== comparing versions ===');
check('1.1.0 is newer than 1.0.9', compareVersions('1.1.0', '1.0.9') > 0, true);
check('1.10.0 is newer than 1.9.0', compareVersions('1.10.0', '1.9.0') > 0, true);
check('equal is equal', compareVersions('2.0.0', '2.0.0'), 0);
check('a leading v is ignored', compareVersions('v1.2.0', '1.2.0'), 0);
check('missing parts count as zero', compareVersions('1.2', '1.2.0'), 0);
check('1.2.1 beats 1.2', compareVersions('1.2.1', '1.2') > 0, true);
/* Rubbish must not read as newer than everything, or one stray file would offer a permanent "update". */
check('nonsense is not newer than a real version', compareVersions('banana', '1.0.0') > 0, false);

console.log('\n=== the version comes from the FILE NAME ===');
/*
 * Not from a separate manifest, on purpose. Two files that must agree is one more thing that can disagree —
 * a manifest saying 1.5 beside a zip that is still 1.4 has no symptom until somebody wonders why the update
 * did nothing.
 */
check('a plain name parses', versionFromName('TwinVisitLogger-1.4.2.zip'), '1.4.2');
check('a v prefix parses', versionFromName('TwinVisitLogger-v2.0.0.zip'), '2.0.0');
check('an underscore parses', versionFromName('TwinVisitLogger_1.1.0.zip'), '1.1.0');
check('case does not matter', versionFromName('twinvisitlogger-1.0.1.ZIP'), '1.0.1');
check('two parts are allowed', versionFromName('TwinVisitLogger-2.1.zip'), '2.1');
/* Everything else is ignored rather than guessed at — the folder will collect other files. */
check('an unrelated zip is ignored', versionFromName('backup-of-stuff.zip'), '');
check('a versionless name is ignored', versionFromName('TwinVisitLogger.zip'), '');
check('a document is ignored', versionFromName('TwinVisitLogger-1.0.0.docx'), '');

console.log('\n=== looking for an update ===');
/**
 * A Drive stub. `files.list` answers the folder query and then the contents query, in that order, which is
 * the sequence the real code makes.
 */
function stubDrive({ folder = { id: 'F1', name: UPDATE_FOLDER }, files = [], throws = null } = {}) {
  let call = 0;
  return {
    files: {
      list: async () => {
        if (throws) throw new Error(throws);
        call += 1;
        if (call === 1) return { data: { files: folder ? [folder] : [] } };
        return { data: { files } };
      },
      get: async () => ({ data: Buffer.alloc(0) })
    }
  };
}
const pkgFile = (v, extra = {}) => ({ id: `id-${v}`, name: `TwinVisitLogger-${v}.zip`, size: '1000', ...extra });

{
  const r = await checkForUpdate(stubDrive({ files: [pkgFile('9.9.9')] }), { root: 'twin-visit-logger-sandbox' });
  check('a newer package is offered', r.available, true);
  check('...with its version', r.version, '9.9.9');
}
{
  const r = await checkForUpdate(stubDrive({ files: [pkgFile('0.0.1')] }), { root: 'twin-visit-logger-sandbox' });
  check('an older package is not offered', r.available, false);
  check('...and says why', r.reason, 'already up to date');
}
{
  /*
   * The NEWEST wins, not the most recently uploaded. Re-uploading an old package — a rollback done by hand —
   * would otherwise be offered as an upgrade.
   */
  const files = [pkgFile('1.0.1'), pkgFile('9.9.9'), pkgFile('2.0.0')];
  const r = await checkForUpdate(stubDrive({ files }), { root: 'twin-visit-logger-sandbox' });
  check('the newest of several wins', r.version, '9.9.9');
}
{
  const r = await checkForUpdate(stubDrive({ folder: null }), { root: 'twin-visit-logger-sandbox' });
  check('no Drive folder is not an error', [r.available, !!r.error], [false, false]);
  check('...and it says what is missing', /no update folder/.test(r.reason), true);
}
{
  const r = await checkForUpdate(stubDrive({ files: [{ id: 'x', name: 'notes.txt' }] }),
    { root: 'twin-visit-logger-sandbox' });
  check('a folder with nothing recognisable is not an error', r.available, false);
  check('...and it says what a package should be called', /TwinVisitLogger-1\.2\.3\.zip/.test(r.reason), true);
}
{
  /*
   * A network failure must NOT throw. An update check that can fail loudly ends up wired into the dashboard,
   * and turns a missing Drive folder or one bad minute into a red banner on a system working perfectly.
   */
  const r = await checkForUpdate(stubDrive({ throws: 'socket hang up' }), { root: 'twin-visit-logger-sandbox' });
  check('a network failure is reported, not thrown', [r.available, r.error], [false, 'socket hang up']);
}
check('the installed version is read from package.json',
  await installedVersion('twin-visit-logger-sandbox'), JSON.parse(read('package.json')).version);
check('a folder with no package.json reads as 0.0.0', await installedVersion('/nonexistent'), '0.0.0');

console.log('\n=== nothing is installed that was not verified ===');
/*
 * THE failure that matters. A truncated download installed over a working app leaves no app at all — the one
 * outcome an updater must never produce. Two independent checks, because they catch different things: the md5
 * catches truncation and corruption, the zip signature catches a file that is the right length and still
 * rubbish (and covers Drive files that carry no md5 at all).
 */
const SCRATCH = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'upd-'));
/* A minimal but structurally real zip: an empty archive is just its end-of-central-directory record. */
const EMPTY_ZIP = Buffer.from('504b0506000000000000000000000000000000000000', 'hex');
function driveServing(buf) {
  return { files: { get: async () => ({ data: buf }) } };
}
{
  const md5 = crypto.createHash('md5').update(EMPTY_ZIP).digest('hex');
  const got = await downloadUpdate(driveServing(EMPTY_ZIP),
    { id: 'a', name: 'TwinVisitLogger-2.0.0.zip', size: EMPTY_ZIP.length, md5 }, { into: SCRATCH });
  check('a good download lands', fs.existsSync(got.path), true);
  check('...and reports how it was verified', got.verified, 'checksum');
  /*
   * Written to a .part file and renamed only after both checks pass, so anything finding the final path finds
   * a complete file. A consumer that could see a half-written package is a consumer that can install one.
   */
  check('no .part file is left behind',
    fs.readdirSync(SCRATCH).some((f) => f.endsWith('.part')), false);
}
{
  const md5 = crypto.createHash('md5').update(Buffer.from('something else')).digest('hex');
  let threw = '';
  try {
    await downloadUpdate(driveServing(EMPTY_ZIP),
      { id: 'a', name: 'bad.zip', size: EMPTY_ZIP.length, md5 }, { into: SCRATCH });
  } catch (e) { threw = e.message; }
  check('a checksum mismatch refuses', /does not match its checksum/.test(threw), true);
  check('...and says nothing was installed', /Nothing was installed/.test(threw), true);
  check('...leaving no file behind', fs.existsSync(path.join(SCRATCH, 'bad.zip')), false);
}
{
  let threw = '';
  try {
    await downloadUpdate(driveServing(EMPTY_ZIP),
      { id: 'a', name: 'short.zip', size: 99999 }, { into: SCRATCH });
  } catch (e) { threw = e.message; }
  check('a truncated download refuses', /expected 99999/.test(threw), true);
}
{
  /* Right length, no md5, and not a zip — the case the size check alone cannot catch. */
  const junk = Buffer.alloc(64, 7);
  let threw = '';
  try {
    await downloadUpdate(driveServing(junk), { id: 'a', name: 'junk.zip', size: junk.length }, { into: SCRATCH });
  } catch (e) { threw = e.message; }
  check('a file that is not a zip refuses even without a checksum',
    /not a complete zip/.test(threw), true);
}
fs.rmSync(SCRATCH, { recursive: true, force: true });

console.log('\n=== the installer half: what it refuses ===');
const UP = read('scripts/update-app.mjs');
/*
 * Refusing while a job runs. Swapping files out from under a sweep that is driving a browser corrupts the
 * profile, and on this project a corrupted profile means REI logs you out — the failure the run lock exists
 * for. Checked BEFORE downloading, because refusing after 200 MB wastes an afternoon.
 */
check('it refuses while a job is running', /A job is running right now/.test(UP), true);
check('...checked before the download', UP.indexOf('run.lock') < UP.indexOf('Downloading…'), true);
/*
 * But only a LIVE holder blocks. A lock left by a run that died would otherwise block updates for thirty
 * minutes, and "it says something is running but nothing is" is what gets worked around by deleting files.
 */
check('...but a dead lock does not block it', /alive = e\?\.code === 'EPERM'/.test(UP), true);
/* The previous version is kept, and rolling back is a documented flag rather than a manual folder shuffle. */
check('the previous version is kept', /\.previous/.test(UP), true);
check('rollback exists', /--rollback/.test(UP), true);
check('...and is offered in the success message', /update-app\.cmd --rollback/.test(UP), true);
/*
 * The machine's identity survives an update. Without this an update silently un-installs the PC: both
 * sign-ins again, and every scheduled job failing with a config error in the meantime.
 */
check('settings and logins are carried over',
  /CARRY_OVER = \['\.env', 'credentials', 'browser-data', 'data', 'logs'\]/.test(UP), true);
check('...and the reason is written down', /inherits this machine's IDENTITY/.test(UP), true);
/*
 * The swap runs AFTER this process exits — Windows will not let a process replace the folder it is running
 * from, and a partial replacement is the unacceptable outcome.
 */
check('the swap is staged, not done in-process', /writeSwapScript/.test(UP), true);
check('...and waits for this process to exit', /tasklist \/FI "PID eq/.test(UP), true);
check('...and restores the old version if the move fails',
  /move "\$\{keepCurrentAs\}" "\$\{ROOT\}"/.test(UP), true);
check('...saying so, because no app at all is the one unacceptable outcome',
  /would otherwise leave NO app at all/.test(UP), true);
/* A package that is not the app must be caught before anything is swapped. */
check('a package with no package.json is rejected', /does not look like the app/.test(UP), true);
/* Both zip shapes a person will produce are handled rather than erroring. */
check('a single wrapped folder inside the zip is handled',
  /entries\.length === 1 && entries\[0\]\.isDirectory\(\)/.test(UP), true);
/* Expand-Archive, not a new dependency: node_modules may be the very thing being replaced. */
check('unpacking uses what ships with Windows', /Expand-Archive/.test(UP), true);
check('...and says why not a library', /may be the very thing being replaced/.test(UP), true);

console.log('\n=== it is a BUTTON, and the folder is a code-execution path ===');
/*
 * The client asked for a button and was right to. A silent overnight auto-install means a bad version of mine
 * stops the automation with nobody watching — and this project's whole design principle is that silence must
 * never be ambiguous.
 */
check('checking does not install', /if \(!INSTALL\) \{/.test(UP), true);
check('...installing takes an explicit flag', /const INSTALL = args\.includes\('--install'\);/.test(UP), true);
const CMD = read('scripts/update-app.cmd');
check('the launcher explains why it is not automatic', /is how an automation stops for a day/.test(CMD), true);
/*
 * And the warning that no code can enforce. This gets set up once, shared "just for a minute", and never
 * tightened again — so it is said in the module, in the launcher, and on screen at the moment somebody is
 * about to create the folder.
 */
check('the module says the folder is a code-execution path',
  /code-execution path/.test(read('src/google/updates.mjs')), true);
check('the launcher says it too', /KEEP THAT FOLDER PRIVATE TO YOU/.test(CMD), true);
check('...naming what must not be done', /not "anyone with the link"/.test(CMD), true);
check('and it is repeated on screen when the folder is missing',
  /anyone you share edit access with can run code on this machine/.test(UP), true);
/* Found by NAME so a package built today can be pointed at a different folder without a rebuild. */
check('the folder is found by name, not a baked-in id',
  /name = '\$\{UPDATE_FOLDER\}'|name = '" \+ UPDATE_FOLDER|UPDATE_FOLDER = 'Twin Visit Logger Updates'/
    .test(read('src/google/updates.mjs')), true);

console.log('\n=== the button on the dashboard, and the hole it would have been ===');
/*
 * The client asked for a button, so the dashboard has one — and that turns the monitoring page into something
 * that can EXECUTE an install. Which makes it a cross-site request forgery target: this server answers on
 * 127.0.0.1, and any page in any other tab can POST to 127.0.0.1. Without a defence, a site the user happens
 * to visit while the dashboard is open could trigger an install.
 *
 * These four conditions were each verified against the running server before being written down here.
 */
const DASH = read('scripts/dashboard.mjs');
check('the install endpoint requires POST', /req\.method !== 'POST'/.test(DASH), true);
check('...because a GET can be triggered by an <img> tag with no script at all',
  /a GET could be triggered by an <img src>/.test(DASH), true);
check('a per-run secret is generated', /const TOKEN = crypto\.randomBytes\(24\)/.test(DASH), true);
check('...and regenerating it each launch is explained',
  /a token that outlives the process is a token that can be replayed/.test(DASH), true);
check('the token is required on the endpoint', /req\.headers\['x-dash-token'\]/.test(DASH), true);
/* Compared in constant time, so the comparison itself leaks nothing about the value. */
check('...and compared without leaking it', /crypto\.timingSafeEqual/.test(DASH), true);
/*
 * A length check BEFORE timingSafeEqual, because that function throws on mismatched lengths — which would
 * turn a probe with a short token into a 500 and an unhandled rejection rather than a clean refusal.
 */
check('...guarded against the length mismatch that would throw',
  DASH.indexOf('supplied.length === expected.length') < DASH.indexOf('crypto.timingSafeEqual'), true);
check('a cross-site Origin is refused', /originOk/.test(DASH), true);
check('...while our own is allowed', /127\\\.0\\\.0\\\.1\|localhost/.test(DASH), true);
check('the token is put into the page per response, not baked into the template',
  /PAGE\.replace\('__TOKEN__', TOKEN\)/.test(DASH), true);
/*
 * The update notice is LAST in the banner list. Above it is everything that is actually wrong, and "new
 * version available" sitting on top of "REI is logged out" would bury the thing that needs doing.
 */
check('the update notice sits below the real problems',
  /it is the only one that is not a problem/.test(DASH), true);
/*
 * The dashboard runs FROM the folder being replaced, so it holds files open and the swap fails with a sharing
 * violation — the update would look ready and quietly not happen. Its pid is passed in so the swap waits.
 */
check('the dashboard tells the updater to wait for it', /'--wait-for', String\(process\.pid\)/.test(DASH), true);
check('...and the updater honours that', /const WAIT_FOR = \(\(\) => \{/.test(UP), true);
check('...and the page asks the person to close the window',
  /Close this dashboard window<\/b> to finish/.test(DASH), true);
/* The check is cached far longer than the sheet's: the answer changes a few times a month, the page polls every 3s. */
check('the update check is cached for half an hour',
  /UPDATE_CACHE_MS = 30 \* 60 \* 1000/.test(DASH), true);
check('...and a Drive outage does not put a red banner on a working system',
  /must not put a red banner on a system that is working perfectly/.test(DASH), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
