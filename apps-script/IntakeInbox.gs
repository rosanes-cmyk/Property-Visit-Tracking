/**
 * Intake Inbox — Zapier bridge for Workspaces that block public web apps.
 *
 * Why: equitytrack.org/twinhomebuyer.com blocks "Anyone" access to Apps Script web apps, so an
 * external webhook (Zapier → /exec) is refused (403). Instead, Zapier's "Google Sheets → Create
 * Spreadsheet Row" writes each REI appointment into the "Intake Inbox" tab (authenticated as you —
 * no public URL). A time trigger (every 10 min) or the manual runner processes new rows through
 * webIntake_ (create/update the logger row + calendar event + Automation Log). Sandbox-safe;
 * nothing is ever sent to a seller.
 */

var INTAKE_INBOX_HEADERS = ['Timestamp', 'Seller Name', 'Phone', 'Email', 'Property Address',
  'Visit Date', 'Visit Time', 'Assigned Visitor', 'Lead Source', 'Task Body', 'Tags',
  'Status', 'Property ID', 'Processed At'];

// Contacts carrying any of these tags are NEVER auto-logged. Only an explicit hands-off flag.
// (Empty this array to log everything.)
var INTAKE_SKIP_TAGS = ['do not automate'];

/** Create/repair the Intake Inbox tab. Adds any missing headers to an existing tab (non-destructive). */
function ensureIntakeInbox_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(CFG.INTAKE_INBOX_SHEET);
  if (!sh) { sh = ss.insertSheet(CFG.INTAKE_INBOX_SHEET); sh.setTabColor('#34a853'); }
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var existing = sh.getLastRow() >= 1
    ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); })
    : [];
  if (!existing.length || existing[0] !== 'Timestamp') {
    sh.getRange(1, 1, 1, INTAKE_INBOX_HEADERS.length).setValues([INTAKE_INBOX_HEADERS])
      .setFontWeight('bold').setBackground('#e6f4ea');
    sh.setFrozenRows(1);
    sh.setColumnWidth(5, 240); sh.setColumnWidth(10, 300); sh.setColumnWidth(11, 130);
  } else {
    var missing = INTAKE_INBOX_HEADERS.filter(function (h) { return existing.indexOf(h) < 0; });
    if (missing.length) {
      sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing])
        .setFontWeight('bold').setBackground('#e6f4ea');
    }
  }
  return sh;
}

function inboxGet_(row, idx, name) { return idx[name] != null ? row[idx[name]] : ''; }

/** Process every un-Status'd row in the Inbox through webIntake_. Idempotent (skips done rows). */
function processIntakeInbox_() {
  var sh = ensureIntakeInbox_();
  var last = sh.getLastRow();
  if (last < 2) return { processed: 0, logged: 0, errors: 0 };
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var idx = {}; headers.forEach(function (h, i) { idx[String(h).trim()] = i; });
  if (idx['Status'] == null) return { processed: 0, logged: 0, errors: 0, note: 'no Status column' };
  var vals = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  var processed = 0, logged = 0, errors = 0, skipped = 0;
  for (var r = 0; r < vals.length; r++) {
    var row = vals[r];
    var rowNum = 2 + r;
    if (String(row[idx['Status']]).trim()) continue;                 // already handled
    var addr = String(inboxGet_(row, idx, 'Property Address')).trim();
    var body = String(inboxGet_(row, idx, 'Task Body')).trim();
    /*
     * A row with no address AND no body used to be skipped in silence, on the assumption that it was
     * an empty row. It is not always: three real appointments sat here for days carrying a seller
     * name, a phone and a visit date but NO Property Address, because whatever writes into this tab
     * never filled that column. Silence made them invisible — Status stayed blank, so the tab looked
     * like nothing had arrived, while the dashboard showed nothing because no Data row was ever made.
     *
     * A genuinely empty row is still skipped quietly. A row with real content but no address is now
     * MARKED, because an address is the one thing that cannot be worked around: no address means no
     * tracker row and no calendar event, and nobody can be sent to a house that was never named.
     */
    if (!addr && !body) {
      var hasSomething = ['Seller Name', 'Phone', 'Email', 'Visit Date', 'Visit Time']
        .some(function (f) { return String(inboxGet_(row, idx, f)).trim(); });
      if (hasSomething) {
        sh.getRange(rowNum, idx['Status'] + 1)
          .setValue('NOT LOGGED: no Property Address — fill it in on this row, then re-run');
        if (idx['Processed At'] != null) sh.getRange(rowNum, idx['Processed At'] + 1).setValue(new Date());
        processed++; errors++;
      }
      continue;
    }                                    // blank row — skip
    // Respect hands-off tags — never auto-log these contacts.
    var tags = String(inboxGet_(row, idx, 'Tags')).toLowerCase();
    var blocked = INTAKE_SKIP_TAGS.filter(function (t) { return tags.indexOf(t) >= 0; });
    if (blocked.length) {
      sh.getRange(rowNum, idx['Status'] + 1).setValue('Skipped: ' + blocked.join(', '));
      if (idx['Processed At'] != null) sh.getRange(rowNum, idx['Processed At'] + 1).setValue(new Date());
      processed++; skipped++; continue;
    }
    var lead = {
      'Seller Name': inboxGet_(row, idx, 'Seller Name'),
      'Phone': inboxGet_(row, idx, 'Phone'),
      'Email': inboxGet_(row, idx, 'Email'),
      'Property Address': inboxGet_(row, idx, 'Property Address'),
      'Visit Date': inboxGet_(row, idx, 'Visit Date'),
      'Visit Time': inboxGet_(row, idx, 'Visit Time'),
      'Assigned Visitor': inboxGet_(row, idx, 'Assigned Visitor'),
      'Lead Source': inboxGet_(row, idx, 'Lead Source'),
      'Task Body': body
    };
    var res;
    try { res = webIntake_(lead); } catch (e) { res = { ok: false, error: String(e) }; }
    sh.getRange(rowNum, idx['Status'] + 1).setValue(
      res.ok ? ((res.created ? 'Logged (new)' : 'Logged (updated)') + ' · cal: ' + (res.calendar || '-'))
             : ('Error: ' + res.error));
    if (idx['Property ID'] != null) sh.getRange(rowNum, idx['Property ID'] + 1).setValue(res.ok ? (res.id || '') : '');
    if (idx['Processed At'] != null) sh.getRange(rowNum, idx['Processed At'] + 1).setValue(new Date());
    processed++; if (res.ok) logged++; else errors++;
  }
  SpreadsheetApp.flush();
  if (processed) logAuto_('INTAKE', '', 'Intake Inbox processed ' + processed + ' row(s): ' + logged + ' logged, ' + skipped + ' skipped, ' + errors + ' error(s).');
  return { processed: processed, logged: logged, skipped: skipped, errors: errors };
}

/* ---------- menu-facing wrappers ---------- */

/** Menu: create the Intake Inbox tab. */
function setupIntakeInbox() {
  ensureIntakeInbox_();
  SpreadsheetApp.getActive().toast('Intake Inbox tab is ready. Point Zapier "Create Spreadsheet Row" at it.', 'Intake Inbox', 8);
}

/** Menu: process new rows right now. */
function checkIntakeInboxNow() {
  var r = processIntakeInbox_();
  SpreadsheetApp.getActive().toast(
    'Intake Inbox: ' + r.processed + ' new · ' + r.logged + ' logged · ' + (r.skipped || 0) + ' skipped (Do Not Automate) · ' + r.errors + ' error(s).', 'Intake Inbox', 8);
}

/** Menu: install the every-10-minutes auto-check (approved cadence). Removes any prior copy first. */
function installInboxTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processIntakeInbox_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processIntakeInbox_').timeBased().everyMinutes(10).create();
  SpreadsheetApp.getActive().toast('Auto-check ON: Intake Inbox runs every 10 minutes.', 'Intake Inbox', 8);
}

/** Menu: remove the auto-check. */
function removeInboxTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processIntakeInbox_') { ScriptApp.deleteTrigger(t); n++; }
  });
  SpreadsheetApp.getActive().toast('Auto-check OFF (' + n + ' trigger removed).', 'Intake Inbox', 6);
}
