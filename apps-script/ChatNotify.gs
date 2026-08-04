/**
 * ChatNotify.gs — post the upcoming-visit digest to a Google Chat space.
 *
 * WHY A WEBHOOK: an incoming webhook is created inside the Space itself, so it needs no Cloud
 * project, no published Chat app, and no extra OAuth scope beyond external requests. The URL is the
 * only credential, so it is kept in Script Properties and never written into source or Git.
 *
 * SETUP (once)
 *   1. Open the Google Space -> space name -> Apps & integrations -> Manage webhooks
 *   2. Add webhook, name it e.g. "Twin Visit Logger", copy the URL
 *   3. Sheet menu: Twin Visit Logger -> "Set Google Chat webhook" and paste it
 *   4. Sheet menu: "Send visit digest to Chat now" to verify, then turn on the daily trigger
 *
 * DESIGN: one digest per morning rather than a message per booking. Per-visit pings flood the Space
 * and get muted, which defeats the point. Nothing here is ever sent to a seller.
 */

var CHAT_WEBHOOK_PROP = 'CHAT_WEBHOOK_URL';

/** Menu: store the webhook URL (kept out of source control). */
function setChatWebhook() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('Google Chat webhook',
    'Paste the incoming-webhook URL from the Space (Apps & integrations -> Manage webhooks).\n' +
    'Leave blank and press OK to REMOVE the current webhook.', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var url = String(res.getResponseText() || '').trim();
  var props = PropertiesService.getScriptProperties();
  if (!url) {
    props.deleteProperty(CHAT_WEBHOOK_PROP);
    ui.alert('Google Chat webhook removed. Digests will no longer be posted.');
    return;
  }
  if (url.indexOf('https://chat.googleapis.com/') !== 0) {
    ui.alert('That does not look like a Google Chat webhook URL.\nIt should start with https://chat.googleapis.com/');
    return;
  }
  props.setProperty(CHAT_WEBHOOK_PROP, url);
  ui.alert('Saved. Use "Send visit digest to Chat now" to test it.');
}

function chatWebhookUrl_() {
  return PropertiesService.getScriptProperties().getProperty(CHAT_WEBHOOK_PROP) || '';
}

/** POST a payload to the Space. Returns '' on success, or the error text. */
function chatPost_(payload) {
  var url = chatWebhookUrl_();
  if (!url) return 'no webhook configured';
  try {
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code >= 200 && code < 300) return '';
    return 'HTTP ' + code + ': ' + res.getContentText().slice(0, 300);
  } catch (e) {
    return String(e);
  }
}

var DASHBOARD_URL_PROP = 'DASHBOARD_URL';

/**
 * The dashboard link put on every Chat card.
 *
 * NOT ScriptApp.getService().getUrl(): that hands back the /dev URL, which only opens for people
 * who can edit the script. Everyone else on the team clicks the card and gets a Google error page —
 * which is exactly what happened. The deployed /exec URL is used instead.
 *
 * Order: the DASHBOARD_URL script property (set once via the menu, survives redeploys), then the
 * value in CFG, then getUrl() as a last resort so a fresh install still links somewhere.
 */
function dashboardUrl_() {
  var stored = '';
  try { stored = PropertiesService.getScriptProperties().getProperty(DASHBOARD_URL_PROP) || ''; } catch (e) {}
  if (stored) return normalizeExecUrl_(stored);
  if (CFG.DASHBOARD_URL) return normalizeExecUrl_(CFG.DASHBOARD_URL);
  try { return normalizeExecUrl_(ScriptApp.getService().getUrl() || ''); } catch (e) { return ''; }
}

/**
 * Repair the URL SHAPE. There are two forms of a Workspace web-app link and only one still works:
 *
 *   works:  https://script.google.com/a/macros/DOMAIN/s/ID/exec
 *   fails:  https://script.google.com/a/DOMAIN/macros/s/ID/exec     <- note where "macros" sits
 *
 * ScriptApp.getService().getUrl() hands back the second (legacy) form, and Google now answers it with
 * a Google Drive "unable to open the file" page. That is what the team saw when they tapped a card.
 * Rather than trusting whoever set the link to spot the difference, the shape is corrected here so
 * every path through dashboardUrl_ produces a link that opens.
 */
function normalizeExecUrl_(url) {
  var text = String(url || '').trim();
  if (!text) return '';
  return text.replace(
    /^(https:\/\/script\.google\.com)\/a\/(?!macros\/)([^\/]+)\/macros\/s\//,
    '$1/a/macros/$2/s/'
  );
}

/** Menu: paste the /exec link once. Refuses a /dev link, which is the whole bug this fixes. */
function setDashboardUrl() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.prompt(
    'Dashboard link for Chat cards',
    'Paste the deployed web-app link, ending in /exec.\n\n' +
    'Find it: Extensions -> Apps Script -> Deploy -> Manage deployments -> copy the Web app URL.\n\n' +
    'A /dev link will be rejected: it only opens for people who can edit the script, so everyone\n' +
    'else on the team gets an error page when they tap the card.\n\n' +
    'Leave blank to clear it and fall back to the built-in value.',
    ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return;

  var url = String(answer.getResponseText() || '').trim();
  var props = PropertiesService.getScriptProperties();
  if (!url) {
    props.deleteProperty(DASHBOARD_URL_PROP);
    ui.alert('Cleared. Chat cards will use the link built into the script.');
    return;
  }
  if (!/^https:\/\/script\.google\.com\//.test(url)) {
    ui.alert('That is not an Apps Script web-app link. It should start with https://script.google.com/');
    return;
  }
  if (/\/dev(\?|$)/.test(url)) {
    ui.alert('That is the /dev link. It only opens for editors of this script — the team would get\n' +
             'an error page. Use the /exec link from Manage deployments instead.');
    return;
  }
  props.setProperty(DASHBOARD_URL_PROP, url);
  ui.alert('Saved. Chat cards will link here:\n\n' + url);
}

/**
 * Visits that need attention: Visit Status = Scheduled with a visit date from today through
 * `daysAhead`. Excludes Source = TEST and closed-out records, matching every other live view.
 */
function upcomingVisitsForChat_(daysAhead) {
  var horizon = daysAhead == null ? 1 : daysAhead;
  var sh = dataSheet_();
  var last = sh.getLastRow();
  var out = [];
  if (last < CFG.FIRST_DATA_ROW) return out;
  var vals = sh.getRange(CFG.FIRST_DATA_ROW, 1, last - CFG.FIRST_DATA_ROW + 1, HEADERS.length).getValues();
  var today = today_();
  var until = new Date(today.getTime() + horizon * 864e5);

  vals.forEach(function (v) {
    var rec = {}; HEADERS.forEach(function (h, i) { rec[h] = v[i]; });
    if (!rec['Property Address']) return;
    if (String(rec['Source']).trim() === 'TEST') return;
    if (rec['Current Stage'] === 'Lost / Closed Out') return;
    if (String(rec['Visit Status']) !== 'Scheduled') return;

    // Visit Date may be a Date or a bare serial number when a row was written unformatted.
    var raw = rec['Visit Date'];
    var d = null;
    if (raw instanceof Date) d = new Date(raw.getFullYear(), raw.getMonth(), raw.getDate());
    else if (typeof raw === 'number' && raw > 1000) {
      var u = new Date(Date.UTC(1899, 11, 30) + Math.round(raw) * 864e5);
      d = new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
    }
    if (!d || d < today || d > until) return;

    out.push({
      id: rec['Property ID'] || '',
      seller: rec['Seller Name'] || '(no name)',
      address: rec['Property Address'],
      date: fmt_(d),
      time: cellDisplay_('Visit Time', rec['Visit Time']) || 'time not set',
      visitor: rec['Assigned Visitor'] || rec['Assigned Owner'] || 'UNASSIGNED',
      rei: rec['REI BlackBook Link'] || '',
      missing: rec['Missing Required Fields'] || ''
    });
  });

  out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return out;
}

/** Build the Chat card. Kept plain enough to stay readable on mobile. */
function buildVisitDigestCard_(visits, daysAhead) {
  var widgets = [];
  visits.forEach(function (v) {
    var lines = [
      '<b>' + v.seller + '</b>',
      v.address,
      '🗓 ' + v.date + ' · ' + v.time,
      '👤 ' + v.visitor
    ];
    if (v.visitor === 'UNASSIGNED') lines.push('⚠️ <b>No visitor assigned</b>');
    if (v.missing) lines.push('⚠️ Missing: ' + v.missing);
    widgets.push({ textParagraph: { text: lines.join('<br>') } });
    if (v.rei) {
      widgets.push({ buttonList: { buttons: [{ text: 'Open in REI', onClick: { openLink: { url: v.rei } } }] } });
    }
    widgets.push({ divider: {} });
  });

  var url = dashboardUrl_();
  if (url) {
    widgets.push({ buttonList: { buttons: [
      { text: 'Open dashboard to update', onClick: { openLink: { url: url } } }
    ] } });
  }

  var window_ = daysAhead === 0 ? 'today' : daysAhead === 1 ? 'today & tomorrow' : 'next ' + daysAhead + ' days';
  return {
    cardsV2: [{
      cardId: 'visit-digest',
      card: {
        header: {
          title: 'Property Visits — ' + window_,
          subtitle: visits.length + ' scheduled · ' + fmt_(today_())
        },
        sections: [{ widgets: widgets }]
      }
    }]
  };
}

/**
 * Post the digest. Returns { posted, count, error }.
 * Silent when there is nothing scheduled, so the Space stays quiet on empty days.
 */
function sendVisitDigestToChat(daysAhead) {
  var horizon = daysAhead == null ? 1 : daysAhead;
  var visits = upcomingVisitsForChat_(horizon);
  if (!visits.length) {
    logAuto_('CHAT', '', 'Visit digest skipped — no visits scheduled in the next ' + horizon + ' day(s).');
    return { posted: false, count: 0, error: '' };
  }
  var err = chatPost_(buildVisitDigestCard_(visits, horizon));
  logAuto_('CHAT', '', err
    ? ('Visit digest FAILED (' + visits.length + ' visit(s)): ' + err)
    : ('Visit digest posted to Google Chat · ' + visits.length + ' visit(s).'));
  return { posted: !err, count: visits.length, error: err };
}

/** Menu: post now and report what happened. */
function sendVisitDigestNow() {
  if (!chatWebhookUrl_()) {
    SpreadsheetApp.getUi().alert('No Google Chat webhook saved yet.\nUse "Set Google Chat webhook" first.');
    return;
  }
  var r = sendVisitDigestToChat(1);
  SpreadsheetApp.getActive().toast(
    r.error ? ('Chat digest failed: ' + r.error)
            : (r.count ? ('Posted ' + r.count + ' visit(s) to Google Chat.') : 'No visits scheduled today/tomorrow — nothing posted.'),
    'Google Chat', 10);
}

/** Menu: post the visit digest daily at 9am. Replaces any existing copy. */
function installChatDigestTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendVisitDigestToChat') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendVisitDigestToChat').timeBased().everyDays(1).atHour(9).create();
  SpreadsheetApp.getActive().toast('Morning visit digest ON — posts daily in the 9am hour.', 'Google Chat', 8);
}

/** Menu: stop the daily digest. */
function removeChatDigestTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendVisitDigestToChat') { ScriptApp.deleteTrigger(t); n++; }
  });
  SpreadsheetApp.getActive().toast('Daily Chat digest OFF (' + n + ' trigger removed).', 'Google Chat', 6);
}

/* ============================ instant new-booking alerts ============================ */

var CHAT_SEEN_PROP = 'CHAT_SEEN_IDS';   // Property IDs already announced to the Space

/**
 * Announce bookings that appeared since the last check — however they arrived.
 *
 * The local scraper writes rows straight into the sheet via the Sheets API, so no Apps Script event
 * ever fires for them. Watching for newly-appeared Property IDs therefore covers every path
 * (scraper, manual "Add property", webIntake_) from one place.
 *
 * The FIRST run seeds the seen-list WITHOUT posting, so switching this on cannot blast the Space
 * with every row already in the tracker.
 */
function notifyNewBookings() {
  if (!chatWebhookUrl_()) return { posted: 0, seeded: false };

  var props = PropertiesService.getScriptProperties();
  var stored = props.getProperty(CHAT_SEEN_PROP);
  var seen = {};
  (stored || '').split(',').forEach(function (id) { if (id) seen[id] = true; });

  var sh = dataSheet_();
  var last = sh.getLastRow();
  if (last < CFG.FIRST_DATA_ROW) return { posted: 0, seeded: false };
  var vals = sh.getRange(CFG.FIRST_DATA_ROW, 1, last - CFG.FIRST_DATA_ROW + 1, HEADERS.length).getValues();

  var fresh = [], ids = [];
  vals.forEach(function (v) {
    var rec = {}; HEADERS.forEach(function (h, i) { rec[h] = v[i]; });
    var id = String(rec['Property ID'] || '').trim();
    if (!id || !rec['Property Address']) return;
    if (String(rec['Source']).trim() === 'TEST') return;
    ids.push(id);
    if (seen[id]) return;
    if (rec['Current Stage'] === 'Lost / Closed Out') return;   // nothing to action
    fresh.push({
      id: id,
      seller: rec['Seller Name'] || '(no name)',
      address: rec['Property Address'],
      date: cellDisplay_('Visit Date', rec['Visit Date']) || 'no date',
      time: cellDisplay_('Visit Time', rec['Visit Time']) || 'time not set',
      visitor: rec['Assigned Visitor'] || rec['Assigned Owner'] || 'UNASSIGNED',
      stage: rec['Current Stage'] || '(no stage)',
      rei: rec['REI BlackBook Link'] || '',
      missing: rec['Missing Required Fields'] || ''
    });
  });

  var isFirstRun = (stored === null);
  props.setProperty(CHAT_SEEN_PROP, ids.slice(-1500).join(','));

  if (isFirstRun) {
    logAuto_('CHAT', '', 'New-booking watcher seeded with ' + ids.length + ' existing record(s); nothing posted.');
    return { posted: 0, seeded: true };
  }
  if (!fresh.length) return { posted: 0, seeded: false };

  var err = chatPost_(buildNewBookingCard_(fresh));
  logAuto_('CHAT', '', err
    ? ('New-booking alert FAILED (' + fresh.length + '): ' + err)
    : ('New-booking alert posted · ' + fresh.map(function (f) { return f.id; }).join(', ')));
  return { posted: err ? 0 : fresh.length, seeded: false, error: err };
}

function buildNewBookingCard_(items) {
  var widgets = [];
  items.forEach(function (v) {
    var lines = [
      '<b>' + v.seller + '</b>',
      v.address,
      '🗓 ' + v.date + ' · ' + v.time,
      '👤 ' + v.visitor,
      '📋 ' + v.stage
    ];
    if (v.visitor === 'UNASSIGNED') lines.push('⚠️ <b>Needs a visitor assigned</b>');
    if (v.missing) lines.push('⚠️ Missing: ' + v.missing);
    widgets.push({ textParagraph: { text: lines.join('<br>') } });
    if (v.rei) widgets.push({ buttonList: { buttons: [{ text: 'Open in REI', onClick: { openLink: { url: v.rei } } }] } });
    widgets.push({ divider: {} });
  });
  var url = dashboardUrl_();
  if (url) widgets.push({ buttonList: { buttons: [{ text: 'Open dashboard to update', onClick: { openLink: { url: url } } }] } });

  return { cardsV2: [{ cardId: 'new-booking', card: {
    header: { title: items.length > 1 ? (items.length + ' new property visits booked') : 'New property visit booked',
              subtitle: 'Added to the tracker · ' + fmt_(today_()) },
    sections: [{ widgets: widgets }]
  } }] };
}

/** Menu: check for new bookings now. */
function notifyNewBookingsNow() {
  if (!chatWebhookUrl_()) { SpreadsheetApp.getUi().alert('Save a Google Chat webhook first.'); return; }
  var r = notifyNewBookings();
  SpreadsheetApp.getActive().toast(
    r.seeded ? 'Watcher seeded with existing records — future bookings will be announced.'
             : (r.error ? ('Failed: ' + r.error) : (r.posted ? ('Announced ' + r.posted + ' new booking(s).') : 'No new bookings since the last check.')),
    'Google Chat', 10);
}

/** Menu: watch for new bookings every 5 minutes. */
function installChatNewBookingTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'notifyNewBookings') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('notifyNewBookings').timeBased().everyMinutes(5).create();
  SpreadsheetApp.getActive().toast('New-booking alerts ON — checks every 5 minutes.', 'Google Chat', 8);
}

function removeChatNewBookingTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'notifyNewBookings') { ScriptApp.deleteTrigger(t); n++; }
  });
  SpreadsheetApp.getActive().toast('New-booking alerts OFF (' + n + ' trigger removed).', 'Google Chat', 6);
}

/* ==================== the 3pm work queue ==================== */

/**
 * The 3pm digest, as a WORK QUEUE rather than a data-quality report.
 *
 * Cherry's revision, in her words: "Every category must represent one business action, not merely one
 * database condition", and she must know within ten seconds what the team works on first. The previous
 * version had four buckets and swept every incomplete field into one "Needs review / missing data"
 * pile, so a lead missing Seller Motivation sat next to a lead missing an owner — accurate, and no help
 * in deciding what to do.
 *
 * The seven buckets below are hers, in her priority order, each with exactly one action attached. A
 * lead appears ONCE, in the most urgent bucket that applies. Nothing here writes to the sheet: no due
 * date and no next action is ever invented in order to raise an alert.
 *
 * Two places where her structure needed a decision, both flagged for approval in
 * docs/3pm-Digest-Revision.md rather than settled quietly here:
 *   - Long-Term Nurture is exempt from "Missing Next Action", or bucket 3 would swallow every nurture
 *     lead before bucket 6 could ever see one.
 *   - A final bucket 8 catches records flagged Exception/Incomplete that match none of the seven. Her
 *     rule "if a record is ambiguous, flag it for review instead of guessing" needs somewhere to put
 *     them, and it is a residue rather than the old catch-all — if it grows, that is a finding.
 */
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

/** A sheet date cell (real Date or Sheets serial) as a local midnight Date, or null. */
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

/**
 * Post the 3pm work queue to Chat. Silent when there is nothing to do.
 *
 * Every line carries the four things a manager needs to act without opening anything: who the seller
 * is, which property, who owns it, and the exact reason it is on the list.
 */
function sendAttentionDigestToChat() {
  if (!chatWebhookUrl_()) return { posted: false, count: 0 };
  var sh = dataSheet_();
  var last = sh.getLastRow();
  if (last < CFG.FIRST_DATA_ROW) return { posted: false, count: 0 };
  var idx = headerIndex_();
  var width = Math.max(sh.getLastColumn(), HEADERS.length);
  var vals = sh.getRange(CFG.FIRST_DATA_ROW, 1, last - CFG.FIRST_DATA_ROW + 1, width).getValues();
  var today = today_();

  var found = {};
  ATTENTION_BUCKETS.forEach(function (b) { found[b.key] = []; });

  vals.forEach(function (v) {
    var rec = {};
    HEADERS.forEach(function (h) { var c = idx[h]; rec[h] = c ? v[c - 1] : ''; });
    var hit = attentionBucket_(rec, today);
    if (!hit) return;
    var owner = String(rec['Assigned Owner'] || '').trim();
    found[hit.key].push(
      '<b>' + (rec['Seller Name'] || '(no name)') + '</b> · ' + rec['Property Address'] +
      ' · ' + (owner ? '👤 ' + owner : '👤 <b>UNASSIGNED</b>') +
      ' · <i>' + hit.reason + '</i>'
    );
  });

  var total = ATTENTION_BUCKETS.reduce(function (n, b) { return n + found[b.key].length; }, 0);
  if (!total) {
    logAuto_('CHAT', '', 'Attention digest skipped — nothing needs attention.');
    return { posted: false, count: 0 };
  }

  var widgets = [];
  ATTENTION_BUCKETS.forEach(function (b, i) {
    var arr = found[b.key];
    if (!arr.length) return;
    widgets.push({ textParagraph: { text:
      b.icon + ' <b>' + (i + 1) + '. ' + b.title + ' (' + arr.length + ')</b><br>' +
      '<i>' + b.action + '</i><br>' +
      arr.slice(0, 8).join('<br>') +
      (arr.length > 8 ? ('<br>…and ' + (arr.length - 8) + ' more') : '')
    } });
    widgets.push({ divider: {} });
  });

  var url = dashboardUrl_();
  if (url) widgets.push({ buttonList: { buttons: [{ text: 'Open dashboard to update', onClick: { openLink: { url: url } } }] } });

  var top = ATTENTION_BUCKETS.filter(function (b) { return found[b.key].length; })[0];
  var err = chatPost_({ cardsV2: [{ cardId: 'attention', card: {
    header: {
      title: 'Work queue — ' + total + ' lead(s)',
      subtitle: fmt_(today_()) + ' · start with ' + top.title + ' (' + found[top.key].length + ')'
    },
    sections: [{ widgets: widgets }]
  } }] });
  logAuto_('CHAT', '', err ? ('Attention digest FAILED: ' + err) : ('Attention digest posted · ' + total + ' lead(s).'));
  return { posted: !err, count: total, error: err };
}

/** Menu: post the attention digest now. */
function sendAttentionDigestNow() {
  if (!chatWebhookUrl_()) { SpreadsheetApp.getUi().alert('Save a Google Chat webhook first.'); return; }
  var r = sendAttentionDigestToChat();
  SpreadsheetApp.getActive().toast(
    r.error ? ('Failed: ' + r.error) : (r.count ? ('Posted ' + r.count + ' item(s) needing attention.') : 'Nothing overdue, stalled or flagged — nothing posted.'),
    'Google Chat', 10);
}

/** Menu: post the attention digest daily at 3pm. */
function installChatAttentionTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendAttentionDigestToChat') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendAttentionDigestToChat').timeBased().everyDays(1).atHour(15).create();
  SpreadsheetApp.getActive().toast('Attention digest ON — posts daily in the 3pm hour.', 'Google Chat', 8);
}

function removeChatAttentionTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendAttentionDigestToChat') { ScriptApp.deleteTrigger(t); n++; }
  });
  SpreadsheetApp.getActive().toast('Attention digest OFF (' + n + ' trigger removed).', 'Google Chat', 6);
}
