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
 * FLOW (fully automatic once the 10-min trigger is on)
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

/**
 * Scan Gmail for REI task-assignment emails and log any booked-appointment titles.
 * Returns { scanned, logged, skipped, errors }.
 */
function processReiTaskEmails_() {
  var label = getOrCreateLabel_(GMAIL_CFG.LABEL);
  var q = 'from:' + GMAIL_CFG.SENDER +
          ' subject:("' + GMAIL_CFG.SUBJECT + '")' +
          ' newer_than:' + GMAIL_CFG.LOOKBACK +
          ' -label:' + GMAIL_CFG.LABEL;
  var threads = GmailApp.search(q, 0, 50);
  var scanned = 0, logged = 0, skipped = 0, errors = 0;

  for (var i = 0; i < threads.length; i++) {
    var msgs = threads[i].getMessages();
    for (var j = 0; j < msgs.length; j++) {
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
          'Lead Source': GMAIL_CFG.LEAD_SOURCE,
          'Task Body': title
        };
        var res;
        try { res = webIntake_(lead); } catch (e) { res = { ok: false, error: String(e) }; }
        if (res.ok) logged++; else errors++;
      }
    }
    threads[i].addLabel(label);   // mark processed (upsert-by-address guards against any re-log)
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

/** Menu: install the every-10-minutes Gmail scan. Removes any prior copy first. */
function installGmailTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processReiTaskEmails_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processReiTaskEmails_').timeBased().everyMinutes(10).create();
  SpreadsheetApp.getActive().toast('Gmail auto-reader ON: scans REI emails every 10 minutes.', 'Gmail Intake', 8);
}

/** Menu: remove the Gmail scan trigger. */
function removeGmailTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processReiTaskEmails_') { ScriptApp.deleteTrigger(t); n++; }
  });
  SpreadsheetApp.getActive().toast('Gmail auto-reader OFF (' + n + ' trigger removed).', 'Gmail Intake', 6);
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
