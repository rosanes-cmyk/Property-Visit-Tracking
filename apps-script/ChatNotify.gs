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
/*
 * Cherry's structure, second revision: FIVE stages plus gifts.
 *
 * She replaced the field-based buckets with the pipeline itself — "notification should be like this
 * only: Upcoming Visit / Completed Visit - Need next course of action / Pending offer - ASAP / Offer
 * Sent / Still negotiating ... also we want to track sending gifts to them as part of follow up".
 *
 * That is a better fit than what it replaced. The previous eight buckets answered "which field is
 * empty"; these five answer "where is this deal and who owes it a move", which is what a manager reads
 * a work queue for. Each maps to exactly one Current Stage, so the categories cannot drift from the
 * pipeline the team actually works.
 *
 * Two things her list leaves open, both flagged for her and neither decided here:
 *   - Verbal Agreement, Contract Sent and Long-Term Nurture are not in the five, so leads at those
 *     stages now appear nowhere. A verbal agreement with no contract out is a real gap.
 *   - The gift bucket is ADDITIVE — the one place a lead can appear twice. Sending a gift is a
 *     separate errand from moving the deal, and gifts are recommended at every stage, so a
 *     one-bucket-only rule would hide every gift behind its stage. See giftPending_.
 */
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
      /*
       * Called off but still wanted is not the same as called off. It goes to Follow Up, where the job is to
       * find out, rather than to Cancelled, where the job is to decide.
       */
      if (status === 'Reschedule Needed') {
        return { key: 'pendingFollowUp', attention: true, sort: at,
          reason: 'RESCHEDULE NEEDED' + was + ' — agree a new date with the seller' };
      }

      if (!on) return { key: b.key, attention: true, sort: at, reason: 'no visit date set — nothing to confirm against' };
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
        return { key: 'pendingFollowUp', attention: true, sort: at,
          reason: 'OVERDUE — visit was ' + fmt_(on) + ' and is still marked ' + (status || 'Scheduled')
            + ' — nobody has recorded what happened' };
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
    var owner = String(rec['Assigned Owner'] || '').trim();
    var line = function (reason) {
      return '<b>' + (rec['Seller Name'] || '(no name)') + '</b> · ' + rec['Property Address'] +
        ' · Owner: ' + (owner || '<b>UNASSIGNED</b>') + ' · <i>' + reason + '</i>';
    };

    var hit = attentionBucket_(rec, today);
    if (hit) {
      found[hit.key].push({ text: line(hit.reason), attention: hit.attention ? 0 : 1, at: hit.sort });
    }

    // Additive, on purpose — see giftPending_. A lead can be listed once for its stage and once for
    // a gift it owes, because those are two different jobs for two different people.
    var gift = giftPending_(rec);
    if (gift) found.giftFollowUp.push({ text: line(gift), attention: 1, at: undefined });
  });

  /*
   * Order each section, then flatten to the lines that get posted.
   *
   * Two rules, in this order:
   *   1. anything needing a decision first — overdue, cancelled, reschedule needed, no date set
   *   2. then by the visit's own date, soonest first
   *
   * Cherry: "it should be prioritized, the upcoming visit by its date that near to visit". Before
   * this, the section came out in whatever order the rows sat in the sheet, so tomorrow's visit could
   * appear below one three weeks out. A line with no date sorts last within its group, and the
   * sections that carry no date at all keep their sheet order because Array.sort is stable.
   */
  ATTENTION_BUCKETS.forEach(function (b) {
    found[b.key] = found[b.key]
      .sort(function (x, y) {
        if (x.attention !== y.attention) return x.attention - y.attention;
        var a = x.at === undefined ? 0 : x.at, c = y.at === undefined ? 0 : y.at;
        return a - c;
      })
      .map(function (x) { return x.text; });
  });

  /*
   * Count leads and gifts SEPARATELY.
   *
   * The gift bucket is additive, so summing every bucket would report a lead twice and the headline
   * number would stop meaning "leads that need something" — which is the only reason the headline is
   * there. Stage buckets are mutually exclusive, so their sum is a true lead count.
   */
  var gifts = found.giftFollowUp.length;
  var leads = ATTENTION_BUCKETS.reduce(function (n, b) {
    return n + (b.key === 'giftFollowUp' ? 0 : found[b.key].length);
  }, 0);
  var total = leads + gifts;
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
      arr.slice(0, DIGEST_LINES_PER_SECTION).join('<br>') +
      (arr.length > DIGEST_LINES_PER_SECTION
        ? ('<br>…and ' + (arr.length - DIGEST_LINES_PER_SECTION) + ' more')
        : '')
    } });
    widgets.push({ divider: {} });
  });

  var url = dashboardUrl_();
  if (url) widgets.push({ buttonList: { buttons: [{ text: 'Open dashboard to update', onClick: { openLink: { url: url } } }] } });

  var top = ATTENTION_BUCKETS.filter(function (b) { return found[b.key].length; })[0];
  var err = chatPost_({ cardsV2: [{ cardId: 'attention', card: {
    header: {
      title: 'Work queue — ' + leads + ' lead(s)' + (gifts ? ' · ' + gifts + ' gift(s) to action' : ''),
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
/*
 * Two posts a day, at the client's request: "we will update start from shift before lunch and then few
 * hours before we go home the notif."
 *
 * 11am and 3pm. The first lands while there is still a morning left to act in — a visit confirmed at 11
 * can still be rearranged; the same news at 3 cannot. The second is late enough that the day's work is
 * reflected in it and early enough that somebody can still make a call before leaving.
 *
 * Change DIGEST_HOURS to move them. Hours are in the SPREADSHEET'S timezone (File > Settings), not the
 * reader's, so a team spread across timezones sees one schedule rather than each their own.
 *
 * Apps Script fires a daily trigger somewhere inside the named hour rather than on the minute. So the
 * message arrives between 11:00 and 12:00, not at 11:00 exactly, and that cannot be tightened from here.
 */
var DIGEST_HOURS = [11, 15];

function installChatAttentionTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendAttentionDigestToChat') ScriptApp.deleteTrigger(t);
  });
  DIGEST_HOURS.forEach(function (h) {
    ScriptApp.newTrigger('sendAttentionDigestToChat').timeBased().everyDays(1).atHour(h).create();
  });
  var when = DIGEST_HOURS.map(function (h) {
    return (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? 'am' : 'pm');
  }).join(' and ');
  SpreadsheetApp.getActive().toast('Attention digest ON — posts daily in the ' + when + ' hours.',
    'Google Chat', 8);
}

function removeChatAttentionTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendAttentionDigestToChat') { ScriptApp.deleteTrigger(t); n++; }
  });
  SpreadsheetApp.getActive().toast('Attention digest OFF (' + n + ' trigger removed).', 'Google Chat', 6);
}
