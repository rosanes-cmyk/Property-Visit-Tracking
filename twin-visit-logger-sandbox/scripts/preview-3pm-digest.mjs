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
/*
 * The SAME format the workbook uses, which is not the friendly one.
 *
 * Code.combined.gs: fmt_(d) = Utilities.formatDate(..., 'yyyy-MM-dd'). This printed "Aug 4, 2026" instead,
 * so a preview whose entire job is to show exactly what will post was showing a different date format from
 * the card — and the client spotted it on a real line before I did.
 *
 * Changed here rather than in the workbook on purpose: fmt_ is used by the daily report, the exception queue
 * and the dashboard as well, so making it friendlier is a separate decision about every date in the system,
 * not a fix to this preview.
 */
const fmt_ = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const today_ = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };

/*
 * The Script Properties the copied rules read.
 *
 * In Apps Script CFG comes from Config.gs; here there is no Config.gs, so the preview has to supply it — and
 * did not, which is why this script died with "CFG is not defined" the first time it was run against the
 * live sheet. The values MUST match apps-script/Config.gs or the preview approves a card that differs from
 * the one that posts; tests/attention-digest checks every CFG key the rules read is defined here.
 */
const CFG = {
  DIGEST_INCLUDE_IMPORTED: false        // apps-script/Config.gs
};

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

/*
 * Shorter lines, at the client's request: "we need to lessen in the notf."
 *
 * A line read like this on a phone:
 *
 *   Jose Anguiano · 2145 Capitol Ave, East Palo Alto, CA, 94303, UNITED STATES · Owner: Juan · OVERDUE ...
 *
 * Half of it is postcode, state and country. Nobody scanning a work queue needs any of the three: they know
 * which state they work in, and the street and town identify the property. Cherry's original complaint about
 * this message was that she could not see what to start on without scrolling, and length is what caused it.
 *
 * Dropped from the END only, and only when a part IS one of those things — so "340 Vallejo Dr, Apt 83,
 * Millbrae" keeps its flat number, and an address written in any other shape is left exactly as it is.
 */
function shortAddress_(address) {
  var parts = String(address || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean);
  var junk = /^(?:usa|us|united states)$/i;                       // country
  var zip = /^\d{5}(?:-\d{4})?$/;                                 // 94303 or 94303-1234
  var state = /^[A-Z]{2}$/;                                       // CA
  var stateZip = /^[A-Z]{2}\s+\d{5}(?:-\d{4})?$/;                // "CA 95401", written as one part
  while (parts.length > 1) {
    var last = parts[parts.length - 1];
    if (junk.test(last) || zip.test(last) || state.test(last) || stateZip.test(last)) { parts.pop(); continue; }
    break;
  }
  return parts.join(', ');
}

/*
 * A reason is one line of a scan, not a paragraph.
 *
 * REI's notes run to hundreds of characters — call transcripts, order summaries, escrow instructions — and one
 * of them wraps to five lines on a phone and pushes the sections below it off the screen. The full text is in
 * the sheet, where there is room for it; this is the version somebody reads while deciding what to pick up.
 */
var DIGEST_REASON_MAX = 120;

function clipReason_(reason) {
  var text = String(reason || '').replace(/\s+/g, ' ').trim();
  return text.length > DIGEST_REASON_MAX ? text.slice(0, DIGEST_REASON_MAX - 1).replace(/\s+\S*$/, '') + '…' : text;
}

/*
 * How long a gift stays visible after it has been sent.
 *
 * Three days: long enough that it appears on at least one 11am and one 3pm card, short enough that the
 * section still means "needs attention" rather than becoming a gift ledger.
 */
var GIFT_SENT_VISIBLE_DAYS = 3;

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
  /*
   * "Cancelled, but nobody knows yet whether it is really off" gets its own place.
   *
   * Cherry, via the client: "if there was lead is suddenly cancelled but not sure if the lead will go or what,
   * should had a pending tab" — and, about Jose specifically, "this was for follow up, should move to follow up
   * tab."
   *
   * The distinction is between a lead that is OFF and a lead whose outcome is UNKNOWN, and they need opposite
   * actions. Off means rebook it or close it out — a decision. Unknown means find out first, and there is
   * nothing to decide until somebody has spoken to the seller. Putting both under one heading told whoever read
   * it to make a decision they did not yet have the facts for.
   *
   * Two kinds of lead land here, and neither needed a new Visit Status value — a value outside the workbook's
   * dropdown fails the whole row write:
   *   Reschedule Needed   called off but still wanted; the automation already writes this from REI's notes
   *   an OVERDUE visit    the date has passed and it is still marked Scheduled, so nobody knows what happened
   *
   * Jose Anguiano is the second kind, which is exactly where Cherry asked for him. It also means Upcoming Visit
   * finally contains only visits that are actually still upcoming.
   */
  { key: 'pendingFollowUp', icon: '⏳', title: 'Follow Up — Outcome Not Known Yet', stage: '',
    action: 'Ask the seller whether it is still going ahead, then set a date or close it out.' },
  { key: 'needsRebooking', icon: '🚫', title: 'Cancelled — Close Out or Rebook', stage: '',
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
  /*
   * A date written as TEXT, which is what most of these cells actually hold.
   *
   * This accepted a Date or a serial and rejected everything else, and the preview reported "no visit date
   * set — nothing is actually booked" for four leads including one booked for the next day and one the card
   * had shown as OVERDUE that morning. The sheet was right: Jose Anguiano's row holds Visit Date 2026-08-01.
   *
   * The automation writes dates as strings, so those cells are TEXT, not dates — which means this affected
   * the live 3pm card too, not just the preview. Every row written by the automation rather than typed by a
   * person was invisible to every date rule here.
   *
   * Both shapes the sheet contains: ISO from the automation, US from the workbook's own formatting. Built
   * from the parts rather than via new Date(string), which reads "2026-08-01" as UTC midnight and lands on
   * July 31 for anyone west of Greenwich — the same one-day shift that put a task on the wrong day once
   * already.
   */
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  var iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  var us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (us) return new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2]));
  return null;
}

/*
 * A TIME cell, rendered as a time.
 *
 * "visit TODAY at Sat Dec 30 1899 16:00:00 GMT-0800". A time-only cell is a Date on the spreadsheet epoch —
 * 30 December 1899 — and this was doing String() on it. The bug was always here; it only became visible once
 * dates parsed, because until then no line ever got as far as printing a time.
 *
 * Three shapes, because three things reach this: a Date from Apps Script's getValues(), a fraction of a day
 * from the Sheets API, and plain text like "10:30 AM" from a cell somebody typed. Anything unrecognised is
 * returned untouched rather than blanked — an odd-looking time still tells the reader more than nothing.
 */
function clock_(hours, minutes) {
  var h = ((hours % 12) + 12) % 12;
  return (h === 0 ? 12 : h) + ':' + (minutes < 10 ? '0' : '') + minutes + ' ' + (hours % 24 < 12 ? 'AM' : 'PM');
}

function timeCell_(raw) {
  if (raw instanceof Date) return clock_(raw.getHours(), raw.getMinutes());
  if (typeof raw === 'number' && isFinite(raw)) {
    // The Sheets API sends a time as a fraction of a day: 0.5 is noon.
    var mins = Math.round((raw - Math.floor(raw)) * 1440);
    if (!mins) return '';
    return clock_(Math.floor(mins / 60) % 24, mins % 60);
  }
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  var m = /(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/.exec(s);
  if (!m) return s;
  var h = Number(m[1]);
  if (m[3]) { h = h % 12; if (/p/i.test(m[3])) h += 12; }
  return clock_(h % 24, Number(m[2]));
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
      /*
       * Called off but still wanted is not the same as called off. It goes to Follow Up, where the job is to
       * find out, rather than to Cancelled, where the job is to decide.
       */
      if (status === 'Reschedule Needed') {
        return { key: 'pendingFollowUp', attention: true, sort: at,
          reason: 'RESCHEDULE NEEDED' + was + ' — agree a new date with the seller' };
      }

      /*
       * No date is not an upcoming visit either. It goes to Follow Up with the rest of the unknowns.
       *
       * The client, looking at the live board: "UPCOMING VISITS (SCHEDULED) 8" where every one of the eight
       * read NO DATE — "some is not in the upcoming visit, some of them is dead lead and follow up." A heading
       * that says Scheduled over eight leads with nothing scheduled is simply untrue, and the count is the part
       * people act on.
       *
       * Leaving them there was my call when the Follow Up section went in, on the grounds that a missing date is
       * a booking gap rather than an unknown outcome. Seen on the board that distinction does not survive: there
       * is no date, no owner and no visit, so the job is the same as the rest of this section — find out where
       * the lead actually stands, then book it or close it out.
       */
      if (!on) return { key: 'pendingFollowUp', attention: true, sort: at, reason: 'no visit date set — nothing is actually booked' };
      /*
       * An overdue visit moves to Follow Up too, and this is the change Cherry asked for by name.
       *
       * It used to sit inside Upcoming Visit under "Confirm the visit is going ahead" — for a visit whose date
       * had already passed, where there is nothing left to confirm. Jose Anguiano had been reading that way for
       * five days. What is actually needed is to find out what happened, which is this section's whole purpose.
       *
       * A side effect worth having: Upcoming Visit now contains only visits that really are upcoming, so its
       * count means what it says.
       */
      if (on < today) {
        /*
         * If somebody HAS recorded the outcome, say so and quote it. Do not ask again.
         *
         * The old line ended "— nobody has recorded what happened", and a colleague read that in the team
         * channel about five leads they had written up properly in REI that morning. They were angry, and
         * they were right to be.
         *
         * The deeper fault was not the wording, it was that this rule never looked. The re-check copies
         * REI's latest note into Last Contact Result and stamps Last Contact Date, so their work was
         * already sitting in the workbook — one column away from the rule that declared it missing. A card
         * that ignores the answer and then blames people for not answering is worse than no card.
         *
         * So: a contact result dated ON OR AFTER the visit is treated as the outcome. It is still listed,
         * because Visit Status remains wrong and the dashboard, the reports and the counts all read that
         * field — but the ask becomes the one click that is genuinely outstanding, and the line carries
         * what REI says rather than an accusation.
         */
        var lastOn = dateCell_(rec['Last Contact Date']);
        if (lastOn && lastOn.getTime() >= on.getTime()) {
          /*
           * The DATE of REI's latest note, never its text.
           *
           * Quoting the text was my first attempt and it was wrong. Last Contact Result holds whatever REI
           * noted most recently, which for Joe Dickerson was "107 Virginia Street, Hayward, CA 94544 Offer
           * deadline: No offer deadline stated in MLS" — listing boilerplate. Prefixed with "REI says:" it
           * reads as the visit outcome, which is precisely the confusion this line is meant to remove. The
           * client caught it in the preview before it ever posted.
           *
           * Nothing here can tell an outcome from a comp note, and guessing from prose is how a card starts
           * asserting things nobody checked. So the claim is narrowed to what is actually provable: somebody
           * was working this lead in REI after the visit date. That is enough to stop implying neglect, and
           * it stops short of saying what happened — which only the person who was there can record.
           */
          return { key: 'pendingFollowUp', attention: true, sort: at,
            reason: 'visit was ' + fmt_(on) + ' · the tracker still says ' + (status || 'Scheduled')
              + ' · REI was last noted ' + fmt_(lastOn)
              + ' — tick it Completed or Canceled to clear this' };
        }
        return { key: 'pendingFollowUp', attention: true, sort: at,
          reason: 'OVERDUE — visit was ' + fmt_(on) + ' and the tracker still says ' + (status || 'Scheduled')
            + ' — mark it Completed or Canceled to clear this' };
      }
      var when = on.getTime() === today.getTime() ? 'TODAY' : fmt_(on);
      var time = timeCell_(rec['Visit Time']);
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
  /*
   * A gift can surface on a lead the STAGE sections have finished with.
   *
   * "THE GIFT IS NOT INCLUDED?" — no, and this was a bug I introduced today. Rob Walker is Contract Signed,
   * excludedFromDigest_ drops that stage, and giftPending_ deferred to it wholesale. So the moment Contract
   * Signed leads became re-checkable and their gifts started reaching the sheet, the one section that exists
   * to track those gifts could not show them.
   *
   * Gifts follow a deal PAST its stage — Rob's is a post-signing apology basket — so the stage-based
   * exclusions do not apply here. The Gift Follow-Up section is already the one place a lead may appear
   * twice, which is why letting it ignore stage is consistent rather than a special case.
   *
   * Contract Signed is allowed through; Lost / Closed Out is NOT. A won deal earns follow-up, and Rob's
   * basket is exactly that. A dead lead should not generate a to-do — dropping the whole stage check was an
   * over-correction that had a closed-out lead asking Cherry to approve a gift for a seller nobody is
   * pursuing. If the team does want apology gifts on lost leads, that is a decision to make deliberately.
   *
   * Source = 'Import' does NOT exclude a gift either, and that took reading the live sheet to find.
   *
   * After the stage fix above, Rob Walker's gift STILL did not appear. His row is Source = 'Import' — he
   * came in with the 373 rows recovered from the client's own workbook — and the queue drops imported rows
   * on volume grounds. That argument is about a backlog of 373 leads all claiming attention at once. It does
   * not transfer to gifts: a gift is money already spent on a named seller, there were exactly two in the
   * whole sheet when this was written, and the section caps at five lines anyway. Worse, the tracker only
   * began in July, so nearly every lead far enough along to be sent a gift is imported by definition — the
   * exclusion was removing the section's whole subject matter.
   *
   * The remaining two are about the ROW: nowhere to send anything, and a test row.
   */
  if (!rec['Property Address']) return '';
  if (String(rec['Source'] || '').trim() === 'TEST') return '';
  if (String(rec['Current Stage'] || '').trim() === 'Lost / Closed Out') return '';

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
  /*
   * A gift SENT in the last few days is shown as confirmation, then drops off by itself.
   *
   * The section is a work queue and a sent gift needs no action, so listing every gift ever sent would grow
   * it forever and bury the ones still waiting on somebody. But a gift that went out yesterday is the team's
   * own follow-up landing, and Cherry asked to "track sending gifts to them as part of follow up" — tracking
   * that only ever shows what has NOT happened is half a tracker.
   *
   * GIFT_SENT_VISIBLE_DAYS is the whole compromise: long enough to be seen at the next digest, short enough
   * that the section still means "needs attention" a week later.
   */
  if (status === 'Sent') {
    var sentOn = dateCell_(rec['Gift Sent Date']);
    if (!sentOn) return 'gift marked Sent but no Gift Sent Date recorded';
    var age = Math.round((today_().getTime() - sentOn.getTime()) / 86400000);
    if (age < 0) return 'gift out for delivery on ' + fmt_(sentOn);
    if (age <= GIFT_SENT_VISIBLE_DAYS) {
      /*
       * "gift SENT Aug 4 — Gift ordered in REI — ordered 08/04/2026 — nothing to do" was the real line, and
       * it says "gift ordered in REI" to a reader who has just been told the gift was sent. The reason column
       * carries that prefix because it has to stand alone in the sheet; on the card it is noise, so it comes
       * off here rather than being left out of the column.
       */
      var what = String(rec['Gift Recommendation Reason'] || '').trim()
        .replace(/^gift ordered in REI\s*[—-]\s*/i, '')
        /*
         * And the "ordered 08/04/2026" clause, because the line has already given a date.
         *
         * Marlene's read "gift SENT 2026-08-04 — ordered 08/04/2026 — nothing to do", which is the same date
         * twice in two formats and says nothing about what was actually sent. The column keeps the order date
         * — ordered and delivered are genuinely different facts on the record — but on a card that already
         * leads with the sent date it is noise.
         */
        .replace(/\s*·?\s*\bordered\s+\d{1,2}\/\d{1,2}\/\d{4}\s*$/i, '')
        .replace(/^·\s*/, '')
        .trim();
      return 'gift SENT ' + fmt_(sentOn) + (what ? ' — ' + what : '') + ' — nothing to do, for your awareness';
    }
    return '';
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
/*
 * UNFORMATTED_VALUE, so dates arrive as SERIAL NUMBERS — the shape dateCell_ understands.
 *
 * The default is FORMATTED_VALUE, which hands back the string "2026-08-01". dateCell_ accepts a Date (what
 * Apps Script's getValues() returns) or a serial number, and correctly rejects a string — so every lead read
 * "no visit date set — nothing is actually booked", including one booked twenty minutes earlier and one the
 * card had shown as OVERDUE that morning. The rules were right; the preview was feeding them the wrong shape.
 *
 * This is what getValues() gives Apps Script, so it is the faithful choice as well as the working one. The
 * copied rules stay untouched: the fix belongs where the difference is, which is how the sheet is READ.
 */
const res = await sheets.spreadsheets.values.get({
  spreadsheetId: config.spreadsheetId,
  range: `${config.trackerSheet}`,
  valueRenderOption: 'UNFORMATTED_VALUE',
  dateTimeRenderOption: 'SERIAL_NUMBER'
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
  /* Same two shorteners the card uses, or this preview would show a longer line than Cherry gets. */
  const line = (reason) => ({
    seller: rec['Seller Name'] || '(no name)',
    address: shortAddress_(rec['Property Address']),
    owner: owner || 'UNASSIGNED',
    reason: clipReason_(reason)
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
