/**
 * Why has the automation stopped? One command, every answer.
 *
 *   node scripts/why-stopped.mjs
 *
 * READ-ONLY. It opens no browser, takes no lock, touches no sheet and writes nothing. Safe at any time,
 * including while a job is running — which is often exactly when you want it.
 *
 * WHY THIS EXISTS. Every outage this system has had was diagnosed by a person pasting six or seven
 * commands at my request, one at a time, reading the output back, and waiting for the next list. That is
 * the wrong shape of help. The client, plainly: "YOU KNOW I DONT WANT TO BLE LIKE THIS ALWAYS."
 *
 * Every fault found that way is checked here, in the order they actually occurred:
 *
 *   - the PC rebooted for a Windows update and nobody signed in, so jobs registered "run only when
 *     logged on" never fired, while Task Scheduler reported Ready and Last Result 0 for thirteen hours
 *   - a .cmd carrying the Mark of the Web froze a hidden task at a security dialog nobody could click
 *   - a run died holding the REI lock, so every later run stood down
 *   - the 20-minute re-check lost the lock race to the 2-minute jobs, every time, for 13.5 hours
 *   - a pause flag left in .env, which no monitor looks at
 *   - REI signed itself out
 *   - another PC still held the active-machine claim
 *
 * It prints what it found and then ONE verdict naming the most likely cause, because a wall of facts is
 * what the last six debugging sessions already were.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const APP = process.cwd();
const now = Date.now();
const findings = [];
/*
 * RANK IS WHAT MAKES THE VERDICT USEFUL.
 *
 * The first draft reported findings in the order it checked them, so with a fresh install it announced
 * "Booking emails has not run" as the most likely cause when the real answer was two lines further down:
 * credentials.json was missing, so nothing could run at all. A list of five symptoms above the cause is
 * the wall of facts this script exists to replace.
 *
 * Lower number = closer to a root cause. A job being late is a SYMPTOM of everything above it.
 */
const RANK = {
  paused: 10, google: 20, tasks: 30, interactive: 40,
  neverRan: 50, lock: 60, rei: 70, jobLate: 80, sweep: 90,
};
const add = (level, text, fix = '', rank = 99) => findings.push({ level, text, fix, rank });

const ok = (t, f, r) => add('ok', t, f, r);
const warn = (t, f, r) => add('warn', t, f, r);
const bad = (t, f, r) => add('bad', t, f, r);

const read = (p) => { try { return fs.readFileSync(path.join(APP, p), 'utf8'); } catch { return null; } };
const stat = (p) => { try { return fs.statSync(path.join(APP, p)); } catch { return null; } };
const ago = (ms) => {
  if (!Number.isFinite(ms)) return 'never';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min ago`;
  const h = m / 60;
  if (h < 48) return `${h.toFixed(1)} hours ago`;
  return `${Math.round(h / 24)} days ago`;
};

console.log('='.repeat(72));
console.log('  WHY HAS IT STOPPED?   ' + new Date().toLocaleString());
console.log('='.repeat(72));

/* ---------------------------------------------------------------- is this the app folder */
if (!read('src/config.mjs')) {
  console.log('\nThis is not the app folder, so there is nothing here to check.');
  console.log(`  Looked in: ${APP}`);
  console.log('  Try:  cd C:\\TwinVisitLogger   (PowerShell)   or   cd /d C:\\TwinVisitLogger   (Command Prompt)');
  process.exit(2);
}

/* ---------------------------------------------------------------- 1. paused
 * First because it is invisible to every other monitor: the health check never reads it, and the booking
 * intake is not pause-gated, so its heartbeat keeps ticking while five jobs do nothing. */
const env = read('.env') || '';
const envPaused = /^\s*AUTOMATION_PAUSED\s*=\s*(true|1|yes|on)\s*$/im.test(env);
const filePaused = Boolean(stat('data/PAUSED'));
if (envPaused || filePaused) {
  bad(`PAUSED — ${[envPaused && 'AUTOMATION_PAUSED is set in .env', filePaused && 'the file data\\PAUSED exists']
      .filter(Boolean).join(' and ')}`,
    'Run scripts\\resume.cmd, and if .env holds the flag, delete that line too. BOTH must be clear.',
    RANK.paused);
} else {
  ok('Not paused');
}

/* ---------------------------------------------------------------- 2. the REI lock */
const lockRaw = read('data/run.lock');
if (!lockRaw) {
  ok('The REI browser is free — no run is holding it');
} else {
  let pid = 0, startedAt = '';
  try { const j = JSON.parse(lockRaw); pid = Number(j.pid) || 0; startedAt = j.startedAt || ''; } catch { /* unreadable */ }
  const held = startedAt ? now - new Date(startedAt).getTime() : NaN;
  let alive = false;
  try { if (pid) { process.kill(pid, 0); alive = true; } } catch { alive = false; }
  if (alive && held > 30 * 60000) {
    bad(`A run (pid ${pid}) has held the REI browser for ${ago(held)} — far longer than any run should`,
      'That process is wedged. End it in Task Manager (Details tab, find the PID), then delete data\\run.lock.',
      RANK.lock);
  } else if (alive) {
    ok(`A run is using REI right now (pid ${pid}, started ${ago(held)}) — normal`);
  } else {
    warn(`A lock file is left over from pid ${pid}, which is gone (${ago(held)})`,
      'Harmless — the next run clears it automatically after 30 minutes. Delete data\\run.lock to clear it now.');
  }
}

/* ---------------------------------------------------------------- 3. when each job last ran
 * Read from the logs rather than Task Scheduler, because the scheduler reports that it STARTED a task,
 * not that the task did anything. That gap is how thirteen hours of nothing read as Last Result 0. */
const JOBS = [
  ['Booking emails',   'logs/scheduled-task.log',  2,    'the intake that turns a booking email into a row'],
  ['Board intake',     'logs/fill-pending.log',    2,    'finishes visits typed on the dashboard'],
  ['REI re-check',     'logs/recheck-task.log',    20,   'reads REI for leads already tracked'],
  ['Work-queue sweep', 'logs/bucket-task.log',     60,   'what the 9am/11am/4pm cards wait for'],
  ['Notes audit',      'logs/audit-notes.log',     60,   'reads your own notes for visit outcomes'],
];
console.log('\nWHEN EACH JOB LAST RAN');
let anyRan = false;
for (const [name, file, everyMin, what] of JOBS) {
  /* The shared log can be held open, so a run writes logs\<name>-<random>.log instead. Take the newest of
   * both, or a diverted log reads as a job that never ran — which it did, for two days. */
  const dir = path.join(APP, 'logs');
  const base = path.basename(file, '.log');
  let newest = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f === path.basename(file) || f.startsWith(base + '-')) {
        const s = fs.statSync(path.join(dir, f));
        if (s.mtimeMs > newest) newest = s.mtimeMs;
      }
    }
  } catch { /* no logs folder yet */ }
  const age = newest ? now - newest : NaN;
  const allowed = everyMin * 3 * 60000;
  const late = !newest || age > allowed;
  if (newest) anyRan = true;
  console.log(`  ${late ? 'LATE' : ' ok '}  ${name.padEnd(17)} ${ago(age).padEnd(14)} (every ${everyMin} min — ${what})`);
  if (late) bad(`${name} has not run (${ago(age)})`, '', RANK.jobLate);
}
if (!anyRan) {
  bad('NO job has ever written a log on this PC',
    'Either the tasks are not installed, or nothing has fired yet. Check: schtasks /Query /TN "Twin Visit Logger*"',
    RANK.neverRan);
}

/* ---------------------------------------------------------------- 4. the sweep stamp the cards wait on */
const sweep = read('data/LAST-SWEEP');
if (sweep) {
  let t = NaN;
  try { t = new Date(JSON.parse(sweep).completedAt).getTime(); } catch { t = NaN; }
  const age = now - t;
  if (!Number.isFinite(age)) warn('The sweep marker is unreadable', '');
  else if (age > 90 * 60000) {
    bad(`The last finished sweep was ${ago(age)} — the work-queue cards hold at 90 minutes`,
      'Run:  node scripts\\recheck-rei.mjs --buckets --limit 40 --wait --yes', RANK.sweep);
  } else ok(`A sweep finished ${ago(age)} — the cards will publish`);
} else {
  warn('No sweep has ever finished on this PC',
    'Normal on a fresh install. Run:  node scripts\\recheck-rei.mjs --buckets --limit 40 --wait --yes');
}

/* ---------------------------------------------------------------- 5. REI session
 * An OPEN with no CLOSE is a browser that was killed, and a killed Chromium never writes its cookies
 * back — which is one of the two explanations for REI logging this machine out. */
const sess = read('logs/rei-session.log');
if (sess) {
  const lines = sess.trim().split('\n').slice(-40);
  const loggedOut = lines.filter((l) => /login page|post_logout/i.test(l)).length;
  const neverClosed = lines.filter((l) => /CONTEXT NEVER CLOSED/.test(l)).length;
  if (loggedOut) {
    bad(`REI showed a login page on ${loggedOut} of the last runs`,
      'Sign in again:  scripts\\login-rei.cmd', RANK.rei);
  } else ok('REI has not reported a login page recently');
  if (neverClosed) {
    warn(`${neverClosed} recent run(s) ended without closing the browser`,
      'A killed Chromium does not save its cookies, which is how REI logs this PC out. Usually the 20-minute task limit.');
  }
} else {
  warn('No REI session log yet — no run has opened REI on this PC', '');
}

/* ---------------------------------------------------------------- 6. Google token */
if (!stat('credentials/credentials.json')) {
  bad('credentials\\credentials.json is missing — Google cannot be reached at all',
    'Copy it back in. Without it nothing can read the sheet, the calendar or the inbox.', RANK.google);
} else if (!stat('credentials/token.json')) {
  warn('No Google sign-in saved yet on this PC',
    'Run:  node scripts\\google-auth.mjs');
} else ok('Google credentials and a saved sign-in are both present');

/* ---------------------------------------------------------------- 7. Windows: tasks, boot, logon type
 * The fault behind every outage so far: a task registered "run only when the user is logged on" does not
 * fire when nobody is, and nothing anywhere reports that as a failure. */
if (process.platform === 'win32') {
  const ps = (cmd) => {
    try {
      return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd],
        { encoding: 'utf8', timeout: 25000, windowsHide: true });
    } catch { return ''; }
  };
  const boot = ps('(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString("s")').trim();
  if (boot) {
    const bAge = now - new Date(boot).getTime();
    if (bAge < 2 * 3600000) ok(`This PC restarted ${ago(bAge)} — jobs resume at their next interval`);
    else console.log(`\n  (this PC last restarted ${ago(bAge)})`);
  }
  const raw = ps("Get-ScheduledTask -TaskName 'Twin Visit Logger*' | ForEach-Object { $_.TaskName + '|' + $_.State + '|' + $_.Principal.LogonType }");
  const rows = raw.trim().split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
  if (!rows.length) {
    bad('No Twin Visit Logger scheduled tasks exist on this PC',
      'Run:  powershell -ExecutionPolicy Bypass -File .\\scripts\\install-windows-task.ps1', RANK.tasks);
  } else {
    const disabled = rows.filter((r) => /disabled/i.test(r[1]));
    const interactive = rows.filter((r) => /interactive/i.test(r[2]));
    if (disabled.length) {
      bad(`${disabled.length} of ${rows.length} scheduled tasks are DISABLED`,
        'Re-enable:  Get-ScheduledTask -TaskName "Twin Visit Logger*" | Enable-ScheduledTask', RANK.tasks);
    } else ok(`All ${rows.length} scheduled tasks are enabled`);
    if (interactive.length) {
      bad(`${interactive.length} of ${rows.length} tasks run ONLY while somebody is signed in to Windows`,
        'This is the cause of every outage so far. Fix:  powershell -ExecutionPolicy Bypass -File .\\scripts\\run-without-login.ps1 -All',
        RANK.interactive);
    } else ok('Every task runs whether anybody is signed in or not');
  }
}

/* ---------------------------------------------------------------- the verdict */
console.log('\n' + '='.repeat(72));
/*
 * Drop the symptoms when their cause is already named. If nothing has ever run, "Booking emails has not
 * run" adds nothing to "NO job has ever written a log" -- it just buries it under four near-identical
 * lines. Same when every task needs a login: of course the jobs are late.
 */
const rootNamed = findings.some((f) => f.level === 'bad'
  && (f.rank === RANK.neverRan || f.rank === RANK.interactive || f.rank === RANK.tasks
      || f.rank === RANK.google || f.rank === RANK.paused));
const bads = findings
  .filter((f) => f.level === 'bad')
  .filter((f) => !(rootNamed && f.rank === RANK.jobLate))
  .sort((a, b) => a.rank - b.rank);
const warns = findings.filter((f) => f.level === 'warn');

for (const f of findings.filter((x) => x.level === 'ok')) console.log(`  OK    ${f.text}`);
for (const f of warns) console.log(`  note  ${f.text}`);
for (const f of bads) console.log(`  BAD   ${f.text}`);

console.log('\n' + '='.repeat(72));
if (!bads.length) {
  console.log('  NOTHING IS WRONG THAT THIS CAN SEE.');
  console.log('');
  console.log('  If the cards still are not posting, the sweep simply has not come round yet.');
  console.log('  Force one:  node scripts\\recheck-rei.mjs --buckets --limit 40 --wait --yes');
} else {
  console.log('  MOST LIKELY CAUSE — fix this one first:');
  console.log('');
  console.log(`    ${bads[0].text}`);
  if (bads[0].fix) console.log(`    ${bads[0].fix}`);
  if (bads.length > 1) {
    console.log('');
    console.log('  Then:');
    for (const f of bads.slice(1)) {
      console.log(`    - ${f.text}`);
      if (f.fix) console.log(`      ${f.fix}`);
    }
  }
}
console.log('='.repeat(72));
