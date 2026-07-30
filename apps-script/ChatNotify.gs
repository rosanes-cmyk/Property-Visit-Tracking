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

/** The deployed dashboard URL, so the team can act on the digest in one tap. */
function dashboardUrl_() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
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

/** Menu: post the digest every weekday morning. Replaces any existing copy. */
function installChatDigestTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendVisitDigestToChat') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendVisitDigestToChat').timeBased().everyDays(1).atHour(7).create();
  SpreadsheetApp.getActive().toast('Daily Chat digest ON — posts each morning around 7am.', 'Google Chat', 8);
}

/** Menu: stop the daily digest. */
function removeChatDigestTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendVisitDigestToChat') { ScriptApp.deleteTrigger(t); n++; }
  });
  SpreadsheetApp.getActive().toast('Daily Chat digest OFF (' + n + ' trigger removed).', 'Google Chat', 6);
}
