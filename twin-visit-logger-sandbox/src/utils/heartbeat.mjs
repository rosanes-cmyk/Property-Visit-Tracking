/**
 * What the automation is doing RIGHT NOW, written to disk so something else can watch it.
 *
 * WHY
 *
 * The client asked for a dashboard inside the app: "add a dashboard in the app what leas is working qhat
 * quett and if the procerss is loading ... know its wroking."
 *
 * That last clause is the requirement. Until now the only windows into a running system were `status.cmd`,
 * which is a snapshot of scheduled-task metadata, and log files nobody opens. Neither answers the question
 * a person actually has, which is "is it working, or is it stuck?" — and those two look identical from
 * outside. A job that is quietly wedged on one lead and a job that has nothing to do both show up as
 * silence.
 *
 * So each job says what it is doing as it goes, and the dashboard reads that.
 *
 * DESIGN RULES, all of them learned from things in this project that went wrong
 *
 *   1. NEVER THROWS. A heartbeat is telemetry. If writing it fails — disk full, file locked by a virus
 *      scanner, folder missing — the run must carry on regardless. A monitoring feature that can break the
 *      thing it monitors is worse than no monitoring.
 *   2. Records the PID. Staleness alone cannot tell "stuck" from "killed": a run that was Ctrl+C'd or died
 *      leaves a heartbeat that simply stops updating, which looks exactly like a hang. Whether the process
 *      still exists is the one reliable answer, and it is the same lesson the run lock learned when a dead
 *      run held it for thirty minutes.
 *   3. Synchronous writes. These are called from the middle of a lead loop, and an unawaited async write is
 *      how you get a heartbeat that reports a lead the run finished with two minutes ago.
 *   4. Local only. Nothing here goes to the sheet or to Chat. It updates every few seconds; sending it
 *      anywhere would cost API quota to say things nobody needs a record of.
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve('./data');
const BEAT_FILE = path.join(DIR, 'heartbeat.json');
const ACTIVITY_FILE = path.join(DIR, 'activity.jsonl');

/*
 * How many recent events to keep. Two hundred is about a day of ordinary running — enough to answer "what
 * happened this morning?" without turning a log nobody rotates into a file that grows forever.
 */
const ACTIVITY_KEEP = 200;

/*
 * A heartbeat older than this, from a process that is still alive, is reported as possibly stuck.
 *
 * SIX minutes, raised from three after it cried wolf on the client's first morning — "Possibly stuck. The REI
 * sweep has not reported for 3 minutes" on a sweep that was working perfectly and finished shortly after.
 *
 * Three was set from how long a lead USUALLY takes, 20-40 seconds, which was the wrong number to reason from.
 * The beat is written once per lead, so the gap between beats is the WORST case for a single lead, and the
 * worst case is bounded by the timeouts rather than the average:
 *
 *   45s   REI_PAGE_TIMEOUT_MS, a page that never finishes rendering
 * + 45s   the one retry an empty scrape is given
 * + 45s   opening the Tasks panel on top of that
 *   ----
 *   ~2m15  before anything has actually gone wrong, plus whatever the network is doing
 *
 * Six leaves real headroom over that while still noticing a genuine hang long before a person would. A
 * monitoring feature that reports healthy work as broken is worse than one that says nothing: it teaches
 * the reader to ignore the warning, which is the one thing it cannot afford.
 */
export const STUCK_AFTER_MS = 6 * 60 * 1000;

function ensureDir() {
  try { fs.mkdirSync(DIR, { recursive: true }); } catch { /* see rule 1 */ }
}

function writeBeat(beat) {
  try {
    ensureDir();
    fs.writeFileSync(BEAT_FILE, JSON.stringify(beat, null, 2));
  } catch { /* see rule 1 */ }
}

/** Start of a job. `job` is a short stable id the dashboard maps to a friendly name. */
export function beginJob(job, { total = 0, phase = 'starting' } = {}) {
  const now = new Date().toISOString();
  writeBeat({ job, pid: process.pid, startedAt: now, updatedAt: now, phase, item: '', index: 0, total, done: false });
}

/**
 * Progress. Called once per lead, so it must stay cheap — one small synchronous write, no formatting work.
 *
 * Reads the existing file to keep startedAt rather than taking it as an argument: the caller in the middle
 * of a loop should not have to carry the job's start time around, and forgetting to would silently reset
 * the elapsed clock on every lead.
 */
export function updateJob({ phase, item, index, total } = {}) {
  let beat = {};
  try { beat = JSON.parse(fs.readFileSync(BEAT_FILE, 'utf8')); } catch { beat = {}; }
  writeBeat({
    ...beat,
    pid: process.pid,
    updatedAt: new Date().toISOString(),
    ...(phase === undefined ? {} : { phase }),
    ...(item === undefined ? {} : { item }),
    ...(index === undefined ? {} : { index }),
    ...(total === undefined ? {} : { total }),
    done: false
  });
}

/**
 * End of a job.
 *
 * The record is marked done rather than DELETED, on purpose. A missing file cannot tell the dashboard
 * whether the last run finished cleanly or was killed — and "the last sweep ended at 8:52 having checked
 * 12 leads" is exactly what somebody wants to see when nothing is running.
 */
export function endJob({ summary = '', ok = true } = {}) {
  let beat = {};
  try { beat = JSON.parse(fs.readFileSync(BEAT_FILE, 'utf8')); } catch { beat = {}; }
  writeBeat({
    ...beat, pid: process.pid, updatedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(), done: true, ok, summary, phase: '', item: ''
  });
}

/** Is a process still alive? The only reliable way to tell "stuck" from "died". */
export function pidAlive(pid) {
  if (!pid) return false;
  try {
    /*
     * Signal 0 checks existence without touching the process. It throws EPERM when the process exists but
     * belongs to somebody else — which still means ALIVE, so that case must not be read as dead.
     */
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/**
 * What is happening, interpreted.
 *
 * Returns one of four states, because they need four different things said about them and collapsing any
 * two of them is how a dashboard ends up lying:
 *
 *   'idle'    nothing running; the last job finished
 *   'running' a live process, updating
 *   'stuck'   a live process that has not said anything for a while
 *   'died'    a job that never finished and whose process is gone
 */
export function readHeartbeat() {
  let beat;
  try { beat = JSON.parse(fs.readFileSync(BEAT_FILE, 'utf8')); } catch { return { state: 'unknown' }; }
  if (!beat || typeof beat !== 'object') return { state: 'unknown' };

  const updated = new Date(beat.updatedAt || 0).getTime();
  const silentFor = Number.isFinite(updated) ? Date.now() - updated : Infinity;

  if (beat.done) return { ...beat, state: 'idle', silentFor };
  const alive = pidAlive(beat.pid);
  if (!alive) return { ...beat, state: 'died', silentFor };
  return { ...beat, state: silentFor > STUCK_AFTER_MS ? 'stuck' : 'running', silentFor };
}

/**
 * Append one line to the activity feed.
 *
 * A separate file from the heartbeat because they answer different questions — "what now" versus "what
 * happened" — and a single file would either lose history or make the per-lead write expensive.
 *
 * Trimmed on write rather than by a scheduled job: nothing here is allowed to depend on another timer
 * running, since a rotation that never fires is how a data folder quietly fills a disk.
 */
export function recordActivity(text, { kind = 'info', job = '' } = {}) {
  try {
    ensureDir();
    const line = JSON.stringify({ at: new Date().toISOString(), kind, job, text: String(text || '') });
    let existing = [];
    try {
      existing = fs.readFileSync(ACTIVITY_FILE, 'utf8').split('\n').filter(Boolean);
    } catch { existing = []; }
    existing.push(line);
    if (existing.length > ACTIVITY_KEEP) existing = existing.slice(-ACTIVITY_KEEP);
    fs.writeFileSync(ACTIVITY_FILE, `${existing.join('\n')}\n`);
  } catch { /* see rule 1 */ }
}

/** The feed, newest first. Unparseable lines are skipped rather than throwing. */
export function readActivity(limit = 30) {
  try {
    const lines = fs.readFileSync(ACTIVITY_FILE, 'utf8').split('\n').filter(Boolean);
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      try { out.push(JSON.parse(lines[i])); } catch { /* skip a truncated line */ }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Friendly names, so the dashboard says "REI sweep" rather than "bucket-sweep".
 *
 * Kept SHORT because these are printed as the headline of the "Now" card, and a screenshot of the first
 * version showed "REI sweep (work-queue leads)" wrapping onto two lines and pushing the progress bar out of
 * the card. The detail a longer name was carrying — which leads, how far through — is on the line underneath
 * anyway, where it belongs.
 */
export const JOB_NAMES = {
  'bucket-sweep': 'REI sweep',
  recheck: 'REI re-check',
  intake: 'Booking emails',
  'board-intake': 'Board booking',
  'notes-audit': 'Notes audit'
};
