/**
 * GmailIntake.gs — read REI BlackBook task-assignment emails straight from Gmail and auto-log
 * property visits, with NO Zapier, NO REI API key, and NO public web app.
 *
 * WHY THIS EXISTS
 *   REI exposes nothing about a task to any external tool: Zapier has no task trigger, there is no
 *   API key, the public web app is blocked by the Workspace, and REI Workflows only send texts/emails.
 *   The ONE thing that escapes REI automatically is the task TITLE — it rides along in the
 *   "You have 1 new task assignment" email from noreply@reiblackbook.com, which we CAN read.
 *
 * THE TEAM'S ONE HABIT
 *   Title booked-appointment tasks so the title carries the seller + address + date/time, e.g.:
 *     Booked appointment | Cyn Ku | 2607 Gimelli Place #115, San Jose | Jul 24 11:00 AM
 *   Order after the keyword is: Seller | Address | Date Time  (pipe-separated).
 *   The date-only form ("Booked appointment on Jul 24") is recognized too, but without an address
 *   in the title there is nothing to log, so it is counted as "skipped (no address)".
 *
 * FLOW (fully automatic once the every-minute trigger is on)
 *   REI emails the task  ->  Gmail  ->  processReiTaskEmails_()  ->  webIntake_()  ->  dashboard
 *   card + calendar event + Automation Log.  Processed threads get the "PV-Logged" label so they
 *   are never re-scanned; webIntake_ upserts by address so reminders can never create duplicates.
 */

var GMAIL_CFG = {
  SENDER: 'noreply@reiblackbook.com',   // REI's notification sender
  SUBJECT: 'new task assignment',        // assignment email subject contains this phrase
  KEYWORD: 'booked appointment',         // only task titles containing this are treated as visits
  LABEL: 'PV-Logged',                    // applied to processed threads (created on first run)
  LOOKBACK: '7d',                        // how far back to scan
  LEAD_SOURCE: 'REI Task (email)'
};

/** Find (or create) a Gmail label by name. */
function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

/** Pull the task titles out of an REI notification email's HTML body (one per <li>, minus "Due:"). */
function extractReiTaskTitles_(html) {
  var titles = [], re = /<li[^>]*>([\s\S]*?)<\/li>/gi, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var txt = m[1].replace(/<[^>]+>/g, ' ')
                  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
                  .replace(/\s+/g, ' ').trim();
    txt = txt.replace(/\bDue:.*$/i, '').trim();   // drop trailing "Due: Monday, ..."
    if (txt) titles.push(txt);
  }
  return titles;
}

/**
 * Parse a task TITLE into { seller, address, visitDate, visitTime }.
 * Convention:  <keyword> | Seller | Address | Date Time
 * Also tolerates the date-only form "Booked appointment on Jul 24".
 */
function parseReiTaskTitle_(title) {
  var t = String(title || '').trim(), out = { raw: t };
  if (t.indexOf('|') >= 0) {
    var parts = t.split('|').map(function (s) { return s.trim(); }).filter(String);
    // parts[0] is the keyword ("Booked appointment"); the rest are Seller, Address, Date Time in order.
    var rest = parts.slice(1);
    for (var i = 0; i < rest.length; i++) {
      var p = rest[i];
      var looksDate = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(p) && /\d/.test(p);
      var looksAddr = /\d/.test(p) && (/,/.test(p) ||
        /(\bst\b|\bave\b|\brd\b|\bblvd\b|\bdr\b|\bln\b|\bct\b|\bway\b|\bpl\b|place|street|road|drive|court|lane|circle|#)/i.test(p));
      if (looksDate && !out.dateTime) out.dateTime = p;
      else if (looksAddr && !out.address) out.address = p;
      else if (!out.seller) out.seller = p;
      else if (!out.address) out.address = p;
    }
  }
  if (!out.dateTime) {   // date-only fallback: "...on Jul 24" / "...on July 24, 2026"
    var md = t.match(/on\s+([A-Za-z]{3,9}\.?\s+\d{1,2}(?:,?\s*\d{4})?(?:\s+\d{1,2}:\d{2}\s*[AP]M)?)/i);
    if (md) out.dateTime = md[1];
  }
  if (out.dateTime) {
    var s = out.dateTime.replace(/^[A-Za-z]+day,\s*/, '');
    var tm = s.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
    if (tm) out.visitTime = tm[1].toUpperCase().replace(/\s+/g, ' ');
    var dm = s.match(/([A-Za-z]{3,9}\.?\s+\d{1,2})(?:,?\s*(\d{4}))?/);
    if (dm) {
      var yr = dm[2] || String(new Date().getFullYear());
      out.visitDate = dm[1] + ', ' + yr + (out.visitTime ? ' ' + out.visitTime : '');
    }
  }
  return out;
}

var GMAIL_SEEN_PROP = 'PV_SEEN_MSG_IDS';   // Script Property: comma-joined processed message IDs

/**
 * Scan Gmail for REI task-assignment emails and log any booked-appointment titles.
 * Dedups per MESSAGE (not per conversation) via Script Properties — REI reuses one subject for
 * every assignment, so Gmail threads them together; a per-thread label would skip later bookings.
 * Returns { scanned, logged, skipped, errors }.
 */
function processReiTaskEmails_() {
  var props = PropertiesService.getScriptProperties();
  var seen = {};
  (props.getProperty(GMAIL_SEEN_PROP) || '').split(',').forEach(function (id) { if (id) seen[id] = true; });
  var label = getOrCreateLabel_(GMAIL_CFG.LABEL);   // visual marker in Gmail only (not used to skip)
  var q = 'from:' + GMAIL_CFG.SENDER +
          ' subject:("' + GMAIL_CFG.SUBJECT + '")' +
          ' newer_than:' + GMAIL_CFG.LOOKBACK;
  var threads = GmailApp.search(q, 0, 50);
  var scanned = 0, logged = 0, skipped = 0, errors = 0, added = 0;

  for (var i = 0; i < threads.length; i++) {
    var msgs = threads[i].getMessages();
    for (var j = 0; j < msgs.length; j++) {
      var mid = msgs[j].getId();
      if (seen[mid]) continue;                 // this exact email was already handled
      var titles = extractReiTaskTitles_(msgs[j].getBody());
      for (var k = 0; k < titles.length; k++) {
        var title = titles[k];
        if (title.toLowerCase().indexOf(GMAIL_CFG.KEYWORD) < 0) continue;   // not a visit booking
        scanned++;
        var p = parseReiTaskTitle_(title);
        if (!p.address) { skipped++; continue; }   // title has no address -> nothing to log
        var lead = {
          'Seller Name': p.seller || '',
          'Property Address': p.address,
          'Visit Date': p.visitDate || '',
          'Visit Time': p.visitTime || '',
          'Visit Status': 'Scheduled',          // a booking is always a scheduled visit...
          'Current Stage': 'Visit Scheduled',   // ...so it shows on the dashboard even on an update
          'Lead Source': GMAIL_CFG.LEAD_SOURCE,
          'Task Body': title
        };
        var res;
        try { res = webIntake_(lead); } catch (e) { res = { ok: false, error: String(e) }; }
        if (res.ok) logged++; else errors++;
      }
      seen[mid] = true; added++;               // remember this email so we never rescan it
    }
    threads[i].addLabel(label);
  }
  if (added) {
    var ids = Object.keys(seen);
    if (ids.length > 800) ids = ids.slice(ids.length - 800);   // keep the list bounded
    props.setProperty(GMAIL_SEEN_PROP, ids.join(','));
  }
  if (scanned) {
    logAuto_('GMAIL', '', 'REI task emails: ' + scanned + ' booking title(s) — ' + logged +
      ' logged, ' + skipped + ' skipped (no address in title), ' + errors + ' error(s).');
  }
  return { scanned: scanned, logged: logged, skipped: skipped, errors: errors };
}

/* ---------- menu-facing wrappers ---------- */

/** Menu: explain the setup + create the label. */
function setupGmailIntake() {
  getOrCreateLabel_(GMAIL_CFG.LABEL);
  SpreadsheetApp.getActive().toast(
    'Gmail auto-reader ready. Title booked tasks:  Booked appointment | Seller | Address | Date Time.',
    'Gmail Intake', 10);
}

/** Menu: scan REI task emails right now. */
function checkReiEmailsNow() {
  var r = processReiTaskEmails_();
  SpreadsheetApp.getActive().toast(
    'REI emails: ' + r.scanned + ' booking(s) · ' + r.logged + ' logged · ' +
    r.skipped + ' skipped (no address) · ' + r.errors + ' error(s).', 'Gmail Intake', 8);
}

/** Menu: install the every-minute Gmail scan. Removes any prior copy first. */
function installGmailTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processReiTaskEmails_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processReiTaskEmails_').timeBased().everyMinutes(1).create();
  SpreadsheetApp.getActive().toast('Gmail auto-reader ON: scans REI emails every minute.', 'Gmail Intake', 8);
}

/** Menu: remove the Gmail scan trigger. */
function removeGmailTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processReiTaskEmails_') { ScriptApp.deleteTrigger(t); n++; }
  });
  SpreadsheetApp.getActive().toast('Gmail auto-reader OFF (' + n + ' trigger removed).', 'Gmail Intake', 6);
}

/** Run from the editor to forget which emails were processed, so the next scan re-reads them. */
function resetGmailSeen() {
  PropertiesService.getScriptProperties().deleteProperty(GMAIL_SEEN_PROP);
  SpreadsheetApp.getActive().toast('Gmail reader reset — the next scan will re-read recent REI emails.', 'Gmail Intake', 6);
}

/** Editor test: parse a sample title without touching Gmail. Run and read the log. */
function testReiTitleParse() {
  var samples = [
    'Booked appointment | Cyn Ku | 2607 Gimelli Place #115, San Jose | Jul 24 11:00 AM',
    'Booked appointment on Jul 24',
    'Booked appointment | Jane Doe | 12 Oak St, Fremont | July 30, 2026 2:30 PM'
  ];
  samples.forEach(function (s) { Logger.log(s + '  =>  ' + JSON.stringify(parseReiTaskTitle_(s))); });
}
