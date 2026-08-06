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
/*
 * How many leads each section lists before "…and N more".
 *
 * Five, at Cherry's instruction: "it only should have 5 person or lead should be included". It was
 * eight, which on a phone pushed the later sections off the first screen entirely — and the point of
 * the message is that she can see what to start on without scrolling. The count in the heading is
 * always the true total, so nothing is hidden by shortening the list; the section says so itself.
 */
var DIGEST_LINES_PER_SECTION = 5;

var ATTENTION_BUCKETS = [
  { key: 'upcomingVisit', icon: '📅', title: 'Upcoming Visit', stage: 'Visit Scheduled',
    action: 'Confirm the visit is going ahead. Afterwards mark it Completed or Canceled.' },
  /*
   * Cancelled visits get their OWN section, and move into it by themselves.
   *
   * The client: "the card should automatic move as well where that should be move, it should be automated
   * right?" He is right, and the distinction that makes it safe is between MOVING a card and CLOSING a
   * deal. Sara Davenport sat under "Upcoming Visit — confirm the visit is going ahead" for a visit that had
   * been called off, which made the section read as three visits coming up when one was off.
   *
   * So the card moves on VISIT STATUS, which REI and the team both set, while Current Stage — the thing
   * that decides whether a lead is dead — is still only ever moved by a person. The lead stops cluttering
   * the visit list and still cannot be quietly written off.
   */
  { key: 'needsRebooking', icon: '🚫', title: 'Cancelled — Rebook or Close Out', stage: '',
    action: 'Agree a new date with the seller, or move the lead to Lost / Closed Out.' },
  { key: 'needsDecision', icon: '📋', title: 'Completed Visit — Needs Next Course of Action', stage: 'Visit Completed — Needs Review',
    action: 'Decide: make an offer, pass, or move to nurture — and set the next action.' },
  { key: 'offerPending', icon: '⏱', title: 'Pending Offer — ASAP', stage: 'Offer Preparation',
    action: 'Finish the offer and get it sent today.' },
  { key: 'offerSent', icon: '📤', title: 'Offer Sent', stage: 'Offer Sent',
    action: 'Follow up with the seller for a decision.' },
  { key: 'negotiating', icon: '🤝', title: 'Still Negotiating', stage: 'Active Negotiation',
    action: 'Decide the counter response and keep it moving.' },
  { key: 'giftFollowUp', icon: '🎁', title: 'Gift Follow-Up', stage: '',
    action: 'Approve the gift, or send it and record the sent date.' }
];

/** A sheet date cell (real Date or Sheets serial) as a local midnight Date, or null. */
function dateCell_(raw) {
  if (raw instanceof Date) return new Date(raw.getFullYear(), raw.getMonth(), raw.getDate());
  if (typeof raw === 'number' && raw > 1000) {
    var u = new Date(Date.UTC(1899, 11, 30) + Math.round(raw) * 864e5);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  return null;
}

/** Is this lead finished, or not a lead at all? Nothing excluded here ever reaches the notification. */
function excludedFromDigest_(rec) {
  var stage = String(rec['Current Stage'] || '').trim();
  var source = String(rec['Source'] || '').trim();
  if (!rec['Property Address']) return 'no property address';
  if (source === 'TEST') return 'test row';
  if (stage === 'Lost / Closed Out') return 'closed out';
  if (stage === 'Contract Signed') return 'contract signed';

  /*
   * Pre-cutover history is kept OUT of the work queue.
   *
   * The first live run posted 103 leads. Nearly every line read "Owner: UNASSIGNED · no visit date set",
   * "offer not priced yet", or "no contact for 131 day(s)" — the rows imported from the old workbook,
   * which carry a stage but no owner, no dates and no decisions. A 103-line message fails the one
   * requirement Cherry set, that she can see what to work on first, and it fails it on volume rather
   * than on anything about the categories.
   *
   * Source = 'Import' is the exact signature: importFromOldWorkbook stamps it, and nothing else does.
   * The dashboard writes 'Manual', the REI intake writes 'Intake', the scraper writes its own. So no
   * cutover date has to be invented and no live lead can be caught by accident.
   *
   * The rows are NOT touched, hidden or closed — they stay in the sheet and on the dashboard, where
   * Operations can work through them deliberately. This only keeps them out of the daily message.
   * Set CFG.DIGEST_INCLUDE_IMPORTED = true to put them back.
   */
  if (source === 'Import' && !CFG.DIGEST_INCLUDE_IMPORTED) return 'imported history (pre-cutover)';
  return '';
}

/**
 * Which stage bucket this lead belongs in, and the exact reason it is listed. null = no stage bucket.
 *
 * One lead, one stage bucket: the stages are mutually exclusive, so there is no priority puzzle to
 * solve — a lead is at exactly one point in the pipeline. The order of ATTENTION_BUCKETS is Cherry's
 * reading order, not a tie-break.
 *
 * `today` is injected so the decision is testable and does not depend on when the tests run.
 */
function attentionBucket_(rec, today) {
  if (excludedFromDigest_(rec)) return null;
  var stage = String(rec['Current Stage'] || '').trim();

  for (var i = 0; i < ATTENTION_BUCKETS.length; i++) {
    var b = ATTENTION_BUCKETS[i];
    if (!b.stage || b.stage !== stage) continue;

    /*
     * An overdue visit is not a separate bucket any more — Cherry's five do not include one. It is
     * called out INSIDE Upcoming Visit instead, because a visit whose date has passed while still
     * marked Scheduled is the single most urgent line in the whole message, and dropping it silently
     * because there is no bucket for it would be the worst outcome of this simplification.
     */
    if (b.key === 'upcomingVisit') {
      var on = dateCell_(rec['Visit Date']);
      var status = String(rec['Visit Status'] || '').trim();
      var was = on ? ' — was booked for ' + fmt_(on) : '';

      /*
       * A CANCELLED visit is still listed here, and says so.
       *
       * Cancelling does not move Current Stage — realignStage_ leaves it alone for a human to close
       * out — so the lead stays at Visit Scheduled and lands in this section. Reading it back showed
       * the bug: a cancelled visit appeared under "Confirm the visit is going ahead" as "visit Aug 12,
       * 2026", and a cancelled visit whose date had passed read "OVERDUE ... still marked Canceled",
       * which is nonsense.
       *
       * Removing it from the section would be worse: a cancellation is exactly the thing someone has
       * to act on, by rebooking or closing the lead out. So it stays, labelled, and sorts to the top.
       */
      /*
       * `sort` orders the section by the visit's own date. Cherry: "it should be prioritized, the
       * upcoming visit by its date that near to visit" — so the soonest visit is the first line, not
       * whichever row happens to sit highest in the sheet. A visit with no date sorts last within its
       * group, because there is no date to be near to.
       */
      var at = on ? on.getTime() : Infinity;

      /*
       * Out of Upcoming Visit and into its own section, automatically. The key is 'needsRebooking', not
       * b.key, which is what actually moves the card — see the bucket comment above for why this is done on
       * Visit Status and never by rewriting Current Stage.
       */
      if (status === 'Canceled') {
        return { key: 'needsRebooking', attention: true, sort: at,
          reason: 'CANCELED' + was + ' — rebook it or close the lead out' };
      }
      if (status === 'Reschedule Needed') {
        return { key: 'needsRebooking', attention: true, sort: at,
          reason: 'RESCHEDULE NEEDED' + was + ' — agree a new date with the seller' };
      }

      if (!on) return { key: b.key, attention: true, sort: at, reason: 'no visit date set — nothing to confirm against' };
      if (on < today) {
        return { key: b.key, attention: true, sort: at,
          reason: 'OVERDUE — visit was ' + fmt_(on) + ' and is still marked ' + (status || 'Scheduled') };
      }
      var when = on.getTime() === today.getTime() ? 'TODAY' : fmt_(on);
      var time = String(rec['Visit Time'] || '').trim();
      return { key: b.key, sort: at, reason: 'visit ' + when + (time ? ' at ' + time : '') };
    }

    if (b.key === 'needsDecision') {
      var visited = dateCell_(rec['Visit Date']);
      return { key: b.key,
        reason: 'visited' + (visited ? ' ' + fmt_(visited) : '') + ', no offer decision recorded yet' };
    }

    if (b.key === 'offerPending') {
      var amount = rec['Approved Offer Amount'];
      var has = amount !== '' && amount !== null && amount !== undefined;
      return { key: b.key,
        reason: has ? 'offer of ' + digestMoney_(amount) + ' prepared but not sent' : 'offer not priced yet' };
    }

    if (b.key === 'offerSent') {
      var sentOn = dateCell_(rec['Offer Sent Date']);
      var amt = rec['Approved Offer Amount'];
      var parts = [];
      if (amt !== '' && amt !== null && amt !== undefined) parts.push(digestMoney_(amt));
      parts.push(sentOn ? 'sent ' + fmt_(sentOn) : 'sent date not recorded');
      var quiet = Number(rec['Days Since Last Activity']);
      if (isFinite(quiet) && quiet > 0) parts.push('no contact for ' + quiet + ' day(s)');
      return { key: b.key, reason: parts.join(' · ') };
    }

    if (b.key === 'negotiating') {
      var counter = rec['Counteroffer Amount'];
      var said = String(rec['Last Contact Result'] || '').trim();
      var bits = [];
      if (counter !== '' && counter !== null && counter !== undefined) bits.push('seller countered at ' + digestMoney_(counter));
      if (said) bits.push(said.length > 90 ? said.slice(0, 87) + '…' : said);
      if (!bits.length) bits.push('undecided since the offer went out');
      return { key: b.key, reason: bits.join(' · ') };
    }
  }
  return null;
}

/**
 * Does this lead owe a gift? Returns the reason, or '' when nothing is due.
 *
 * ADDITIVE, and deliberately so: a gift is recommended at any stage, so making it compete with the
 * stage buckets would mean every gift stayed invisible behind the deal it belongs to. Sending a gift
 * is a different errand, done by a different person, than deciding a counter-offer.
 *
 * 'Recommended' needs an approval; 'Approved' needs someone to actually send it and record the date.
 * 'Sent' and 'Not Appropriate' are finished, and 'Not Reviewed' is not a commitment anyone has made.
 */
function giftPending_(rec) {
  if (excludedFromDigest_(rec)) return '';
  var status = String(rec['Gift Status'] || '').trim();
  if (status === 'Recommended') {
    var why = String(rec['Gift Recommendation Reason'] || '').trim();
    var who = String(rec['Gift Approval Owner'] || '').trim();
    return 'gift recommended' + (why ? ' (' + why + ')' : '') +
      ' — awaiting approval' + (who ? ' from ' + who : '');
  }
  if (status === 'Approved') {
    if (dateCell_(rec['Gift Sent Date'])) return '';       // approved AND sent: finished
    var by = String(rec['Gift Approved By'] || '').trim();
    var on = dateCell_(rec['Gift Approval Date']);
    return 'gift approved' + (by ? ' by ' + by : '') + (on ? ' on ' + fmt_(on) : '') +
      ' — not sent yet';
  }
  return '';
}

/**
 * A currency cell as "$450,000". Non-numbers come back as they were written.
 *
 * NOT called money_: there is already a money_ in this project with different behaviour — it returns
 * '' for a zero amount, where this returns '$0'. Two functions of the same name in one Apps Script
 * project silently resolve to whichever loads last, which made the offer-prep task text depend on file
 * order. Distinct name, no collision, no order dependency.
 */
function digestMoney_(v) {
  var n = Number(v);
  if (!isFinite(n) || v === '' || v === null) return String(v == null ? '' : v);
  return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
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
  const owner = String(rec['Assigned Owner'] || '').trim();
  const line = (reason) => ({
    seller: rec['Seller Name'] || '(no name)',
    address: rec['Property Address'],
    owner: owner || 'UNASSIGNED',
    reason
  });
  const hit = attentionBucket_(rec, today);
  if (hit) {
    if (hit.attention) found[hit.key].unshift(line(hit.reason));
    else found[hit.key].push(line(hit.reason));
  }
  const gift = giftPending_(rec);
  if (gift) found.giftFollowUp.push(line(gift));
}

const gifts = found.giftFollowUp.length;
const leads = ATTENTION_BUCKETS.reduce((n, b) => n + (b.key === 'giftFollowUp' ? 0 : found[b.key].length), 0);
const total = leads + gifts;
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
  say(`  WORK QUEUE — ${leads} lead(s)${gifts ? ` · ${gifts} gift(s) to action` : ''}`);
  say(`  ${fmt_(today)}  ·  start with ${active[0].title} (${found[active[0].key].length})`);
  say('');
  ATTENTION_BUCKETS.forEach((b, i) => {
    const arr = found[b.key];
    if (!arr.length) return;
    say(`  ${b.icon} ${i + 1}. ${b.title.toUpperCase()} (${arr.length})`);
    say(`     ${b.action}`);
    arr.slice(0, DIGEST_LINES_PER_SECTION).forEach((x) => {
      say(`     ${x.seller} · ${x.address}`);
      say(`     Owner: ${x.owner} · ${x.reason}`);
    });
    if (arr.length > DIGEST_LINES_PER_SECTION) say(`     …and ${arr.length - DIGEST_LINES_PER_SECTION} more`);
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
