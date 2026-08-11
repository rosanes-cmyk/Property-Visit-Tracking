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
/**
 * How fresh REI is, read from the sweep's own stamp in the Automation Log.
 *
 * The client, after a card told the whole team nobody had recorded five outcomes their colleague had
 * written up in REI that morning: "im asking why did the sysytem nofit the gc nit cheking of those?"
 *
 * Because the sweep and this card are on separate timers with nothing between them. The card published
 * whatever the sheet happened to hold, with no way to know it was stale and no way to say so. The client
 * had asked about exactly this earlier — "but all lead in 8 bucket should be chekd before sending the notif
 * right?" — and the sequencing was described and never built.
 *
 * The sweep runs 15 minutes before each posting and records when it finished; this reads that line.
 *
 * Two things are built on it, and they are different jobs. This function only WORDS the card. Whether the
 * card goes out at all is decided by digestWithFreshRei_, which holds it back until the stamp is recent —
 * the client's instruction: "you will check first the 8 bucket send ing the updates in to the gc."
 *
 * This half still matters after that one, because holding is not infinite: after three waits the card is
 * posted anyway rather than going silent, and then this is what tells the reader the data is old.
 */
/*
 * Ninety minutes, because the sweep runs hourly AND again at :45 before each card. Apps Script fires a
 * daily trigger anywhere inside the named hour, so the intended sweep can be as much as 74 minutes old by
 * the time the card runs (08:45 sweep, 09:59 card) and must still count as fresh. Anything past 90 means a
 * sweep was genuinely MISSED, not that this card came a little late.
 */
var DIGEST_FRESH_MINUTES = 90;

/**
 * When the bucket sweep last finished, as a Date, or null if it has never stamped the log.
 * Never throws — a missing tab or an unreadable cell reads as "no stamp".
 */
function reiSweptAt_() {
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName('Automation Log');
    if (!sh) return null;
    var last = sh.getLastRow();
    if (last < 2) return null;
    /*
     * The tail only. This log grows all day, and a card must not read thousands of rows to print six words
     * — the sweep's line is always among the most recent when it has run at all.
     */
    var from = Math.max(2, last - 120);
    var vals = sh.getRange(from, 1, last - from + 1, 2).getValues();
    for (var i = vals.length - 1; i >= 0; i--) {
      if (String(vals[i][1]).trim().toUpperCase() !== 'SWEEP') continue;
      var d = new Date(vals[i][0]);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  } catch (e) {
    return null;
  }
}

/** Minutes since the last sweep, or null when there is no stamp to measure from. */
function reiSweepAgeMinutes_() {
  var when = reiSweptAt_();
  return when ? Math.round((Date.now() - when.getTime()) / 60000) : null;
}

function reiFreshness_() {
  try {
    var when = reiSweptAt_();
    if (!when) return ' · REI freshness unknown';
    var mins = Math.round((Date.now() - when.getTime()) / 60000);
    var clock = Utilities.formatDate(when, Session.getScriptTimeZone(), 'h:mm a');
    return mins <= DIGEST_FRESH_MINUTES
      ? ' · REI checked ' + clock
      : ' · REI last checked ' + clock + ' — may be out of date';
  } catch (e) {
    return '';                                    // never let a stamp stop the queue going out
  }
}

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

/**
 * The MOMENT a visit starts — its date and its time together — or null when the time is unknown.
 *
 * Everything else in this file compares dates at midnight, which is right for "is this booked for today".
 * It is wrong for "has this already happened", and the client saw exactly that: the 4pm card listed a visit
 * at 2:00 PM and one at 3:00 PM under "Confirm the visit is going ahead", two hours after they had been and
 * gone. Their words: "its not accurate the notif this was alreday update with my colleaguse."
 *
 * A visit is only upcoming until it starts. After that the question is what happened, which is a different
 * section with a different ask.
 */
function visitStartsAt_(rec, on) {
  if (!on) return null;
  var hhmm = timeCell_(rec['Visit Time']);          // '2:00 PM' or ''
  if (!hhmm) return null;                            // no time: date-only comparison is all we have
  var m = /(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/.exec(hhmm);
  if (!m) return null;
  var h = Number(m[1]);
  if (m[3]) { h = h % 12; if (/p/i.test(m[3])) h += 12; }
  var at = new Date(on.getTime());
  at.setHours(h % 24, Number(m[2]), 0, 0);
  return at;
}

/*
 * How long after a visit STARTS before the card stops calling it upcoming.
 *
 * An hour, matching DEFAULT_VISIT_DURATION_MINUTES: during the visit itself "confirm it is going ahead" is
 * merely redundant, and nagging somebody about an outcome while they are standing in the property would be
 * worse than the problem being fixed. An hour after the start, asking what happened is the right question.
 */
var VISIT_GRACE_MS = 60 * 60 * 1000;

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
/*
 * `now` is the actual moment, and it DEFAULTS TO `today` — midnight — on purpose.
 *
 * Without a default, every existing caller and every test would silently start comparing fixture dates
 * against the wall clock, and a suite built on a fixed today would begin passing or failing depending on
 * the hour it was run at. Defaulting to midnight means "no now supplied" behaves exactly as this rule did
 * before: a visit's time can never be in the past, so nothing changes. Only the live card passes a real now.
 */
function attentionBucket_(rec, today, now) {
  if (excludedFromDigest_(rec)) return null;
  var nowAt = now || today;
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
      /*
       * Started more than an hour ago counts as past, even when the date is today.
       *
       * This is the half the date comparison could not see. `on < today` only catches yesterday and earlier,
       * so a visit at 2:00 PM stayed under "Confirm the visit is going ahead" until midnight — which is what
       * the 4pm card showed the client, about two visits that had already been and gone.
       */
      var startsAt = visitStartsAt_(rec, on);
      var alreadyStarted = startsAt && nowAt.getTime() > startsAt.getTime() + VISIT_GRACE_MS;
      if (on < today || alreadyStarted) {
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
          /*
           * Worded to FIT. DIGEST_REASON_MAX clips at 120 characters, and the first version ran to about
           * 135 — so it published "REI was last noted 2026-08-08 — tick it Completed or…" and cut off the
           * only actionable words in the line. A truncated instruction is worse than a terse one.
           */
          return { key: 'pendingFollowUp', attention: true, sort: at,
            reason: 'visit was ' + fmt_(on) + ' · tracker says ' + (status || 'Scheduled')
              + ' · REI noted ' + fmt_(lastOn) + ' — tick Completed or Canceled' };
        }
        /*
         * A visit earlier TODAY is not "overdue" — it is simply finished, and nobody has said how it went.
         *
         * The same word for both would be wrong in opposite directions: calling a visit from last Tuesday
         * "today at 2:00 PM" hides how long it has been sitting, and shouting OVERDUE about something that
         * happened ninety minutes ago reads as an accusation. The client's complaint was precisely this
         * tone — the card told the team to chase visits their colleagues had already been to.
         */
        if (on.getTime() === today.getTime()) {
          var clockText = timeCell_(rec['Visit Time']);
          return { key: 'pendingFollowUp', attention: true, sort: at,
            reason: 'visit was earlier today' + (clockText ? ' at ' + clockText : '')
              + ' — how did it go? mark it Completed or Canceled' };
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

/* ====== END OF THE RULES COPIED INTO THE SANDBOX ====== */
/*
 * Everything ABOVE this line, back to `var DIGEST_LINES_PER_SECTION`, is copied byte-for-byte into
 * twin-visit-logger-sandbox/src/rei/attention-rules.mjs and scripts/preview-3pm-digest.mjs by
 * scripts/sync-attention-rules.mjs, so the hourly sweep and the preview work the same buckets as the card.
 *
 * This sentinel exists because the end of that region used to be found by the words "Post the 3pm work
 * queue" in the doc comment below — so renaming a comment silently truncated the copy to nothing, and the
 * only sign was two tests failing with "the rules are carried verbatim: false". A marker that means
 * something is one that cannot be edited by accident.
 */

/*
 * ── Check the buckets FIRST, then send. ──────────────────────────────────────────────────────────
 *
 * The client, in as many words: "it should be like this ok do you get me you will check first the 8 bucket
 * send ing the updates in to the gc." And earlier, twice: "but all lead in 8 bucket should be chekd before
 * sending the notif right?" / "im asking why did the sysytem nofit the gc nit cheking of those?"
 *
 * What existed was two independent clocks. The sweep was SCHEDULED 15 minutes before the card, and the card
 * printed how old the sweep was — but if the sweep was slow, or the PC was asleep, or it crashed, the card
 * went out anyway carrying yesterday's picture with a small apology attached. That is not "check first, then
 * send"; that is "send, and hope". It is how a card came to tell the whole team nobody had recorded five
 * outcomes their colleague had written up in REI that morning.
 *
 * So the trigger no longer posts. It asks one question — has the sweep finished recently? — and:
 *
 *   fresh   → post now.
 *   stale   → post NOTHING, and come back in 10 minutes. Up to three times.
 *   still stale after the third wait → post anyway, with the card saying the data may be out of date.
 *
 * The last line is deliberate and it is the one trade-off worth understanding. The wait cannot be infinite:
 * if the PC is off, no amount of waiting produces a sweep, and a work queue that goes SILENT on those days is
 * worse than one that arrives late with a warning — silence looks identical to "nothing needs doing", and the
 * leads on the list still need working. So the guarantee is: the buckets are checked before the card is sent,
 * and on the days that is impossible you are told, in the card, rather than left to assume.
 *
 * The visible cost: a card can now arrive up to half an hour after its hour. That is the price of it being
 * true when it does arrive.
 *
 * The menu item does NOT wait. Somebody who clicked "post now" is standing there asking for what the sheet
 * holds this second, and making them wait 30 minutes for it would be absurd.
 */
var DIGEST_RETRY_MINUTES = 10;
var DIGEST_MAX_WAITS = 3;
var DIGEST_WAIT_KEY = 'DIGEST_WAITING_FOR_SWEEP';
var DIGEST_RETRY_HANDLER = 'retryAttentionDigest';

/** The scheduled 9am / 11am / 4pm posting. Waits for a fresh sweep before it says anything. */
function sendAttentionDigestToChat() {
  return digestWithFreshRei_();
}

/**
 * The one-off trigger digestWithFreshRei_ sets when it decides to wait.
 *
 * It clears itself first. Apps Script caps a project at 20 triggers and a one-off that has already fired is
 * still counted until it is deleted, so leaving them behind would eventually stop the digest installing at
 * all — a failure that would show up weeks later as "the 9am card stopped coming".
 */
function retryAttentionDigest() {
  clearDigestRetryTriggers_();
  return digestWithFreshRei_();
}

function clearDigestRetryTriggers_() {
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === DIGEST_RETRY_HANDLER) ScriptApp.deleteTrigger(t);
    });
  } catch (e) { /* a trigger we cannot delete must not stop the queue going out */ }
}

/**
 * How many times this posting has already stood down, and when it started.
 *
 * Keyed on nothing but a timestamp on purpose. Keying it on the hour looked tidier and was wrong: a card
 * that fires at 9:55 and waits twice is asking again at 10:15, in a different hour, and the counter would
 * have reset every time — an unbounded loop that never posts. Anything older than an hour is a new posting.
 */
function digestWaitCount_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(DIGEST_WAIT_KEY);
    if (!raw) return 0;
    var o = JSON.parse(raw);
    if (!o || !o.at || (Date.now() - o.at) > 60 * 60 * 1000) return 0;
    return Number(o.n) || 0;
  } catch (e) {
    return 0;
  }
}

function setDigestWaitCount_(n) {
  try {
    var p = PropertiesService.getScriptProperties();
    if (!n) { p.deleteProperty(DIGEST_WAIT_KEY); return; }
    p.setProperty(DIGEST_WAIT_KEY, JSON.stringify({ n: n, at: Date.now() }));
  } catch (e) { /* the counter is a convenience; losing it costs one extra wait, not correctness */ }
}

/**
 * The sequencing itself: check the buckets, then send.
 *
 * Reads the sweep's stamp BEFORE reading the tracker, so a held posting costs one small range read rather
 * than a full sheet scan it is going to throw away.
 */
function digestWithFreshRei_() {
  if (!chatWebhookUrl_()) return { posted: false, count: 0 };

  var age = reiSweepAgeMinutes_();
  if (age !== null && age <= DIGEST_FRESH_MINUTES) {
    setDigestWaitCount_(0);
    return postAttentionDigest_();
  }

  var waited = digestWaitCount_();
  if (waited >= DIGEST_MAX_WAITS) {
    setDigestWaitCount_(0);
    /*
     * The waits are exhausted. Post a NOTICE, not the queue.
     *
     * This is the third answer to the same question, and the first two were both wrong.
     *
     * First it posted the queue with a small "may be out of date" note on the subtitle. The client saw that
     * fire for real — the morning after their PC died, so the last sweep was 17 hours old — and said: "as you
     * see this was 43 mins ago its not accurate and send." They are right. Six leads published with a warning
     * attached puts the reader in the worst position available: act on it, or ignore it, with no way to tell
     * which is correct. That is precisely how a colleague got blamed for outcomes they had already recorded.
     *
     * Then the temptation is silence. Also wrong, and for a reason that has not changed: a queue that simply
     * does not arrive reads as "nothing needs doing today", and the leads on it still need working.
     *
     * So neither. It publishes the ONE fact it can actually stand behind — REI has not been checked, since
     * when, and on which machine — and no lead data at all. Nobody can act on stale information they were
     * never shown, and nobody can mistake the silence for an empty queue.
     */
    logAuto_('CHAT', '', 'Work queue HELD BACK — waited '
      + (DIGEST_MAX_WAITS * DIGEST_RETRY_MINUTES) + ' min and REI was never swept'
      + (age === null ? ' (no sweep has ever stamped the log).' : ' (last sweep ' + age + ' min ago).')
      + ' Posted the outage notice instead of the queue.');
    return postQueueHeldNotice_(age);
  }

  setDigestWaitCount_(waited + 1);
  clearDigestRetryTriggers_();
  try {
    ScriptApp.newTrigger(DIGEST_RETRY_HANDLER).timeBased()
      .after(DIGEST_RETRY_MINUTES * 60 * 1000).create();
  } catch (e) {
    /*
     * If the retry cannot be scheduled there is nothing left to wait FOR, so post now rather than lose the
     * posting entirely. A queue that vanishes because a trigger quota was full is the failure this whole
     * mechanism exists to avoid.
     */
    setDigestWaitCount_(0);
    logAuto_('CHAT', '', 'Could not schedule the REI re-check wait (' + e + ') — posting the work queue now.');
    return postAttentionDigest_();
  }

  logAuto_('CHAT', '', 'Work queue HELD — buckets not swept yet'
    + (age === null ? ' (no sweep stamp found)' : ' (last sweep ' + age + ' min ago)')
    + '. Checking again in ' + DIGEST_RETRY_MINUTES + ' min · wait '
    + (waited + 1) + ' of ' + DIGEST_MAX_WAITS + '.');
  return { posted: false, count: 0, held: true, waits: waited + 1, sweepAgeMinutes: age };
}

/**
 * What goes out INSTEAD of the queue when REI could not be checked.
 *
 * Deliberately carries no lead names, addresses, statuses or counts. The whole point is that the tracker
 * cannot be vouched for, so publishing anything out of it — even a number — invites somebody to act on it.
 *
 * It names the machine, read from the same Automation Settings tab the PC app claims, because "the
 * automation is not running" is not actionable and "DESKTOP-M4C8U38 has not swept since 4:59 PM" is.
 */
function postQueueHeldNotice_(age) {
  var since = '';
  try {
    var at = reiSweptAt_();
    if (at) since = Utilities.formatDate(at, Session.getScriptTimeZone(), 'h:mm a \'on\' EEE d MMM');
  } catch (e) { /* fall through to the vaguer wording */ }

  var who = '';
  try {
    /*
     * Guarded with typeof: this file is pasted into projects that may not carry AgentSettings.gs yet, and a
     * missing helper must not turn the outage notice — the one message that says nothing is working — into a
     * failure of its own.
     */
    if (typeof getAgentSetting_ === 'function' && typeof AGENT_SETTING_KEYS === 'object') {
      who = getAgentSetting_(AGENT_SETTING_KEYS.ACTIVE_MACHINE) || '';
    }
  } catch (e) { /* the notice is worth sending without it */ }

  var hours = age === null ? null : Math.round(age / 60);
  var howOld = age === null ? 'never' : (age < 90 ? age + ' minutes ago' : hours + ' hours ago');

  var body =
    '<b>The work queue is being held back.</b><br><br>'
    + 'REI has not been checked ' + (age === null ? '<b>at all</b>' : '<b>since ' + (since || howOld) + '</b>')
    + (who ? ' — the automation runs on <b>' + who + '</b>.' : '.')
    + '<br><br>'
    + 'So today\'s list is <b>not being published</b>: it would be built from a tracker nobody has verified, '
    + 'and a work queue you cannot trust is worse than none. <b>No lead has been left out — none has been '
    + 'shown.</b><br><br>'
    + '<b>What to check on that PC:</b><br>'
    + '• is it switched on and logged in to Windows?<br>'
    + '• is REI still signed in? — run <b>scripts\\login-rei.cmd</b><br>'
    + '• open <b>scripts\\dashboard.cmd</b> — it says which of these it is<br><br>'
    + 'The queue posts itself as soon as one sweep finishes. Nothing needs restarting.';

  var widgets = [{ textParagraph: { text: body } }];
  var url = dashboardUrl_();
  if (url) widgets.push({ buttonList: { buttons: [{ text: 'Open dashboard', onClick: { openLink: { url: url } } }] } });

  var err = chatPost_({ cardsV2: [{ cardId: 'queueHeld', card: {
    header: { title: '⚠️ Work queue held — REI not checked', subtitle: fmt_(today_()) + ' · nothing published' },
    sections: [{ widgets: widgets }]
  } }] });
  logAuto_('CHAT', '', err ? ('Outage notice FAILED: ' + err) : 'Outage notice posted instead of the work queue.');
  return { posted: !err, count: 0, held: true, stale: true, error: err };
}

/**
 * Post the work queue to Chat. Silent when there is nothing to do.
 *
 * Every line carries the four things a manager needs to act without opening anything: who the seller
 * is, which property, who owns it, and the exact reason it is on the list.
 */
function postAttentionDigest_() {
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
      return '<b>' + (rec['Seller Name'] || '(no name)') + '</b> · ' + shortAddress_(rec['Property Address']) +
        ' · Owner: ' + (owner || '<b>UNASSIGNED</b>') + ' · <i>' + clipReason_(reason) + '</i>';
    };

    /*
     * The real clock, so a visit that has already started today drops out of Upcoming Visit. Every other
     * caller omits it and keeps the old date-only behaviour — see attentionBucket_ for why that default
     * matters to the tests.
     */
    var hit = attentionBucket_(rec, today, new Date());
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
        + reiFreshness_()
    },
    sections: [{ widgets: widgets }]
  } }] });
  logAuto_('CHAT', '', err ? ('Attention digest FAILED: ' + err) : ('Attention digest posted · ' + total + ' lead(s).'));
  return { posted: !err, count: total, error: err };
}

/** Menu: post the attention digest now. */
/*
 * Calls postAttentionDigest_ directly, NOT the waiting path. A person who has just clicked "post now" is
 * asking for what the sheet holds this second; standing them down for half an hour waiting on a sweep would
 * read as a broken menu item. The toast says how fresh REI is instead, which is the same information in the
 * form somebody standing at the screen can act on — they can run the sweep by hand and click again.
 */
function sendAttentionDigestNow() {
  if (!chatWebhookUrl_()) { SpreadsheetApp.getUi().alert('Save a Google Chat webhook first.'); return; }
  var r = postAttentionDigest_();
  var age = reiSweepAgeMinutes_();
  var fresh = age === null ? ' (REI freshness unknown)'
    : age <= DIGEST_FRESH_MINUTES ? '' : ' (REI last swept ' + age + ' min ago)';
  SpreadsheetApp.getActive().toast(
    r.error ? ('Failed: ' + r.error)
      : (r.count ? ('Posted ' + r.count + ' item(s) needing attention.' + fresh)
        : 'Nothing overdue, stalled or flagged — nothing posted.'),
    'Google Chat', 10);
}

/** Menu: post the attention digest daily at 3pm. */
/*
 * Two posts a day, at the client's request: "we will update start from shift before lunch and then few
 * hours before we go home the notif."
 *
 * 9am, 11am and 4pm — the client's shift, in their own words: "we start shift 8 am california time, so
 * before you notif the gc in 9 check the all bucket, and then before lunch 12 in 11 should be cheked again,
 * and then our shift end 5, before 5 its already checked so 4pm will notf."
 *
 * 9 sets the day up while everything is still movable. 11 catches what the morning changed, before lunch
 * splits the team. 4 lands with an hour left, so the wording there asks what HAPPENED rather than what is
 * coming — at 4 o'clock a visit booked for the afternoon has either gone ahead or not.
 *
 * It was 11 and 3. The 3pm slot was too late to act on a morning visit and too early to know the outcome of
 * an afternoon one, which is the worst of both.
 *
 * Apps Script fires a daily trigger somewhere inside the named HOUR, not on the minute, so the sweep is
 * scheduled 15 minutes before each one and the card prints when REI was actually last read.
 *
 * Change DIGEST_HOURS to move them. Hours are in the SPREADSHEET'S timezone (File > Settings), not the
 * reader's, so a team spread across timezones sees one schedule rather than each their own.
 *
 * Apps Script fires a daily trigger somewhere inside the named hour rather than on the minute. So the
 * message arrives between 11:00 and 12:00, not at 11:00 exactly, and that cannot be tightened from here.
 */
var DIGEST_HOURS = [9, 11, 16];

function installChatAttentionTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendAttentionDigestToChat') ScriptApp.deleteTrigger(t);
  });
  clearDigestRetryTriggers_();          // a wait left over from a previous install is not this one's
  setDigestWaitCount_(0);
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
  /*
   * BOTH handlers. A pending retry is a posting that has not happened yet, so leaving one behind means
   * "OFF" is followed by one more card ten minutes later — exactly the kind of thing that makes an off
   * switch untrustworthy, and this project has already learned that lesson once over the scheduled tasks.
   */
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'sendAttentionDigestToChat' || h === DIGEST_RETRY_HANDLER) { ScriptApp.deleteTrigger(t); n++; }
  });
  setDigestWaitCount_(0);
  SpreadsheetApp.getActive().toast('Attention digest OFF (' + n + ' trigger removed).', 'Google Chat', 6);
}
