/**
 * Print the 3pm work queue EXACTLY as it will appear in Google Chat — without deploying anything.
 *
 *   node scripts/preview-3pm-digest.mjs
 *   node scripts/preview-3pm-digest.mjs --save        (also writes 3pm-preview.txt to forward)
 *
 * Why this exists: Cherry asked to see the finished notification before approving the rules, which is
 * the right way round. The alternative was pasting the new script into the workbook to use the menu
 * item — but the 3pm trigger calls that same function, so pasting it IS deploying it. This reads the
 * sheet through the same credentials the automation already uses and prints the message, so she can
 * react to the real thing while the live notification stays exactly as it is.
 *
 * READ ONLY. It opens no browser, posts nothing to Chat, and writes nothing to the sheet.
 *
 * The bucket rules below are a VERBATIM copy of apps-script/ChatNotify.gs. tests/attention-digest
 * asserts the two are identical, so this preview cannot quietly disagree with what will ship.
 */
import { google } from 'googleapis';
import { authorizeGoogle } from '../src/google/auth.mjs';
import { config } from '../src/config.mjs';

const SAVE = process.argv.includes('--save');

/* ---- fmt_ and today_, the two helpers the lifted rules call ---- */
const fmt_ = (d) => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
const today_ = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };

/* ====== VERBATIM FROM apps-script/ChatNotify.gs — do not edit here ====== */
var ATTENTION_BUCKETS = [
  { key: 'visitOverdue', icon: '🚩', title: 'Visit Overdue', action: 'Confirm whether the visit happened — mark it Completed or Canceled.' },
  { key: 'offerIncomplete', icon: '💵', title: 'Offer Needs Completion', action: 'Enter the offer amount and sent date, or correct the status.' },
  { key: 'missingNextAction', icon: '📋', title: 'Missing Next Action', action: 'Assign the next action and its due date.' },
  { key: 'missingMotivation', icon: '🗣', title: 'Missing Seller Motivation', action: 'Write up the post-visit seller motivation notes.' },
  { key: 'missingOwner', icon: '👤', title: 'Missing Assigned Owner', action: 'Assign the person responsible for the lead.' },
  { key: 'nurtureNoFollowUp', icon: '🌱', title: 'Long-Term Nurture Missing Follow-Up', action: 'Add a future follow-up date.' },
  { key: 'stalled', icon: '🐢', title: 'Stalled', action: 'Decide the next step, move to nurture, or close it out.' },
  { key: 'flagged', icon: '⚠️', title: 'Flagged — ambiguous, needs a person', action: 'Read the record and decide; it fits none of the buckets above.' }
];


function dateCell_(raw) {
  if (raw instanceof Date) return new Date(raw.getFullYear(), raw.getMonth(), raw.getDate());
  if (typeof raw === 'number' && raw > 1000) {
    var u = new Date(Date.UTC(1899, 11, 30) + Math.round(raw) * 864e5);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  return null;
}

/**
 * Which ONE bucket this record belongs in, and the exact reason it is there. null = it does not appear.
 *
 * Ordered by Cherry's priority list, and the first match wins — that is what makes "one lead, one
 * bucket" true by construction rather than by a flag that has to be maintained.
 *
 * `today` is passed in so the decision is testable and does not depend on when the tests run.
 */

function attentionBucket_(rec, today) {
  var stage = String(rec['Current Stage'] || '').trim();

  // Never appears: no address to act on, a test row, or a lead that is finished either way.
  if (!rec['Property Address']) return null;
  if (String(rec['Source']).trim() === 'TEST') return null;
  if (stage === 'Lost / Closed Out' || stage === 'Contract Signed') return null;

  // 1. A visit whose date has passed while still marked Scheduled. Either it happened and nobody
  //    logged it, or it was missed — and only a person knows which.
  var visitOn = dateCell_(rec['Visit Date']);
  if (String(rec['Visit Status']).trim() === 'Scheduled' && visitOn && visitOn < today) {
    return { key: 'visitOverdue', reason: 'visit was ' + fmt_(visitOn) + ', still marked Scheduled' };
  }

  // 2. The status says an offer is out, the numbers say otherwise.
  if (stage === 'Offer Sent') {
    var noAmount = !rec['Approved Offer Amount'] && Number(rec['Approved Offer Amount']) !== 0;
    var noSent = !dateCell_(rec['Offer Sent Date']);
    if (noAmount || noSent) {
      return {
        key: 'offerIncomplete',
        reason: 'stage is Offer Sent but ' +
          (noAmount && noSent ? 'neither the amount nor the sent date is filled in'
            : noAmount ? 'the offer amount is blank' : 'the sent date is blank')
      };
    }
  }

  /*
   * 3. Nobody has said what happens next.
   *
   * Long-Term Nurture is deliberately exempt: a nurture lead's "next action" IS its future follow-up
   * date, and bucket 6 exists to ask for exactly that. Without this exemption bucket 3 would claim
   * every nurture lead first and bucket 6 would always read zero.
   */
  if (stage !== 'Long-Term Nurture') {
    var action = String(rec['Next Action'] || '').trim();
    var due = dateCell_(rec['Next Action Due Date']);
    if (!action || !due) {
      return {
        key: 'missingNextAction',
        reason: !action && !due ? 'no next action and no due date'
          : !action ? 'a due date with no action written against it'
            : 'next action "' + action + '" has no due date'
      };
    }
  }

  // 4. The visit is done but what the seller actually wants was never written up. This is the field
  //    the whole visit exists to capture, so it gets its own bucket rather than a "missing data" line.
  var visited = String(rec['Visit Status']).trim() === 'Completed' || stage === 'Visit Completed — Needs Review';
  if (visited && !String(rec['Seller Motivation'] || '').trim()) {
    return {
      key: 'missingMotivation',
      reason: 'visit' + (visitOn ? ' on ' + fmt_(visitOn) : '') + ' completed, seller motivation still blank'
    };
  }

  // 5. Work with no owner is work nobody does.
  if (!String(rec['Assigned Owner'] || '').trim()) {
    return { key: 'missingOwner', reason: 'no assigned owner' };
  }

  // 6. In nurture with nothing in the diary, which is the same as forgotten.
  if (stage === 'Long-Term Nurture') {
    var nurtureDue = dateCell_(rec['Next Action Due Date']);
    if (!nurtureDue || nurtureDue <= today) {
      return {
        key: 'nurtureNoFollowUp',
        reason: nurtureDue ? 'follow-up date ' + fmt_(nurtureDue) + ' is not in the future' : 'no follow-up date set'
      };
    }
  }

  // 7. Silent for days with everything above in order.
  if (String(rec['Stalled Status']).trim() === 'Yes') {
    var quiet = Number(rec['Days Since Last Activity']);
    return {
      key: 'stalled',
      reason: isFinite(quiet) && quiet > 0 ? 'no activity for ' + quiet + ' day(s)' : 'no recent activity'
    };
  }

  // 8. Flagged by validation but matching none of the seven — a person has to look.
  var dq = String(rec['Data Quality Status'] || '').trim();
  if (dq === 'Exception' || dq === 'Incomplete') {
    return {
      key: 'flagged',
      reason: String(rec['Exception Reason'] || rec['Missing Required Fields'] || 'flagged ' + dq).trim()
    };
  }

  return null;
}

/* ====== END VERBATIM ====== */

const auth = await authorizeGoogle();
const sheets = google.sheets({ version: 'v4', auth });

const book = await sheets.spreadsheets.get({ spreadsheetId: config.spreadsheetId });
const res = await sheets.spreadsheets.values.get({
  spreadsheetId: config.spreadsheetId,
  range: `${config.trackerSheet}`
});
const grid = res.data.values || [];
const headers = (grid[config.trackerHeaderRow - 1] || []).map((h) => String(h).trim());
const rows = grid.slice(config.trackerHeaderRow);

const today = today_();
const found = {};
ATTENTION_BUCKETS.forEach((b) => { found[b.key] = []; });

let scanned = 0;
for (const r of rows) {
  const rec = {};
  headers.forEach((h, i) => { if (h) rec[h] = r[i] === undefined ? '' : r[i]; });
  if (!rec['Property Address']) continue;
  scanned += 1;
  const hit = attentionBucket_(rec, today);
  if (!hit) continue;
  const owner = String(rec['Assigned Owner'] || '').trim();
  found[hit.key].push({
    seller: rec['Seller Name'] || '(no name)',
    address: rec['Property Address'],
    owner: owner || 'UNASSIGNED',
    reason: hit.reason
  });
}

const total = ATTENTION_BUCKETS.reduce((n, b) => n + found[b.key].length, 0);
const active = ATTENTION_BUCKETS.filter((b) => found[b.key].length);

const out = [];
const say = (line = '') => out.push(line);

say(`Workbook: "${book.data.properties?.title}"  ·  tab "${config.trackerSheet}"`);
say(`${scanned} live record(s) scanned  ·  ${total} landed in the work queue`);
say('');
say('='.repeat(78));
say('  This is what the 3:00 PM message would say TODAY. Nothing was posted or changed.');
say('='.repeat(78));
say('');

if (!total) {
  say('  Nothing needs attention — the notification would stay silent.');
} else {
  say(`  WORK QUEUE — ${total} lead(s)`);
  say(`  ${fmt_(today)}  ·  start with ${active[0].title} (${found[active[0].key].length})`);
  say('');
  ATTENTION_BUCKETS.forEach((b, i) => {
    const arr = found[b.key];
    if (!arr.length) return;
    say(`  ${b.icon} ${i + 1}. ${b.title.toUpperCase()} (${arr.length})`);
    say(`     ${b.action}`);
    arr.slice(0, 8).forEach((x) => {
      say(`     ${x.seller} · ${x.address}`);
      say(`     Owner: ${x.owner} · ${x.reason}`);
    });
    if (arr.length > 8) say(`     …and ${arr.length - 8} more`);
    say('');
  });
  say('  [ Open dashboard to update ]');
}
say('');
say('='.repeat(78));
say('');
say('Bucket totals:');
ATTENTION_BUCKETS.forEach((b, i) => {
  say(`  ${String(i + 1).padStart(2)}. ${b.title.padEnd(38)} ${String(found[b.key].length).padStart(4)}`);
});
say(`      ${'TOTAL'.padEnd(38)} ${String(total).padStart(4)}`);

const text = out.join('\n');
console.log(text);

if (SAVE) {
  const fs = await import('node:fs');
  fs.writeFileSync('3pm-preview.txt', text + '\n');
  console.log('\nWritten to 3pm-preview.txt — forward that file.');
}
