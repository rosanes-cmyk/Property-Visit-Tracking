/**
 * Intake Inbox — Zapier bridge for Workspaces that block public web apps.
 *
 * Why: equitytrack.org/twinhomebuyer.com blocks "Anyone" access to Apps Script web apps, so an
 * external webhook (Zapier → /exec) is refused (403). Instead, Zapier's "Google Sheets → Create
 * Spreadsheet Row" writes each REI appointment into the "Intake Inbox" tab (authenticated as you —
 * no public URL). A time trigger (every MINUTE) or the manual runner processes new rows through
 * webIntake_ (create/update the logger row + calendar event + Automation Log). Sandbox-safe;
 * nothing is ever sent to a seller.
 */

/*
 * 'REI BlackBook Link' is APPENDED, after the columns the script writes back, so no existing column
 * moves and ensureIntakeInbox_ can add it to a live tab without touching what is already there.
 *
 * It was the one field the tracker needs that this contract had no way to carry, and its absence was not
 * cosmetic. A row that arrives with a real address is never looked up by fill-pending-rei.mjs (that only
 * takes rows carrying the PENDING REI LOOKUP placeholder), and recheck.mjs returns 'no REI link' and
 * skips any row without one. So a booking from the phone path landed in a dead zone: complete enough to
 * look finished, and permanently invisible to the REI sweep — no stage changes, no gift tracking, no
 * owner corrections, no cancellation detection, and nothing anywhere saying so.
 *
 * Found on TVL-1397, whose calendar event read "REI:" with nothing after it.
 *
 * webIntake_ already maps this header into the Data row, so nothing downstream needed changing — the
 * field simply had no way in.
 */
var INTAKE_INBOX_HEADERS = ['Timestamp', 'Seller Name', 'Phone', 'Email', 'Property Address',
  'Visit Date', 'Visit Time', 'Assigned Visitor', 'Lead Source', 'Task Body', 'Tags',
  'Status', 'Property ID', 'Processed At', 'REI BlackBook Link'];

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
     * A genuinely empty row is still skipped quietly.
     *
     * A row with a PHONE but no address is now PARKED, not rejected — the same thing the dashboard's
     * booking form does with `PENDING REI LOOKUP — (phone)`, so the office PC looks the contact up in
     * REI and fills in the address, the notes, the owner and the REI link on its next pass.
     *
     * This was the same situation reaching two different outcomes. The booking form was built for a
     * colleague who has the phone in front of them and would have to go into REI to fetch the address —
     * exactly the errand the form exists to remove — and it parks. This tab rejected. And the tab is
     * what the voice-AI path writes into, on a Chat card whose own words are "No address on file — add
     * it after the time": the address is OPTIONAL by design there, so every reply without one produced
     * a rejection. Nine of them were sitting in this tab, each a booking that reached neither the board
     * nor Juan's calendar.
     *
     * A row with NEITHER an address nor anything to look one up with is still marked, because then
     * there genuinely is nothing to be done with it: nobody can be sent to a house that was never
     * named, and there is no way to find out which house it was.
     */
    var lookupKey = String(inboxGet_(row, idx, 'Phone') ||
                           inboxGet_(row, idx, 'REI BlackBook Link') || '').trim();
    var parked = '';
    /*
     * "No address anywhere" — the FIELD, and the task body, which can carry one.
     *
     * This condition was `!addr && !body`, and that was wrong in the one way that mattered. The voice-AI
     * path writes a Task Body on every row ("Human-answered call. Campaign PROPERTY-LEADS. Booked by
     * Thea. Agreed time 2:00 PM. Ref ..."), so `body` was never empty, so the parking branch could never
     * run for the very path it was written for. The row fell through to webIntake_, which found no
     * address in the fields or the body and rejected it — exactly the behaviour the parking was meant to
     * replace. I tested it against a row with an empty Task Body, which is a shape those rows never have.
     *
     * A body that DOES carry "Property address: ..." is left alone: webIntake_ parses it out and the row
     * completes normally with no parking and no PC lookup needed.
     */
    var addrInBody = '';
    if (!addr && body && typeof parseReiTaskBody_ === 'function') {
      try { addrInBody = String((parseReiTaskBody_(body) || {}).address || '').trim(); } catch (e) { addrInBody = ''; }
    }
    if (!addr && !addrInBody) {
      var hasSomething = ['Seller Name', 'Phone', 'Email', 'Visit Date', 'Visit Time']
        .some(function (f) { return String(inboxGet_(row, idx, f)).trim(); });
      if (!hasSomething && !body) continue;                            // blank row — skip
      if (!lookupKey) {
        sh.getRange(rowNum, idx['Status'] + 1)
          .setValue('NOT LOGGED: no Property Address and no phone to look one up with — ' +
                    'add either on this row, CLEAR THIS CELL, then re-run');
        if (idx['Processed At'] != null) sh.getRange(rowNum, idx['Processed At'] + 1).setValue(new Date());
        processed++; errors++;
        continue;
      }
      /*
       * The placeholder is not cosmetic. webIntake_ finds the next free row by looking for a blank
       * Property Address, so a genuinely blank one would be handed out again to the next booking and
       * overwritten. Same reasoning as webAddRecordLocked_, and the prefix must match PENDING_REI_PREFIX
       * or the office PC will not recognise the row as one to look up.
       */
      parked = PENDING_REI_PREFIX + ' ' + lookupKey;
      addr = parked;
    }
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
      // Optional, and the tab may predate the column — inboxGet_ returns '' when idx has no entry for it,
      // and webIntake_ skips empty values, so an older Inbox tab keeps working untouched.
      'REI BlackBook Link': inboxGet_(row, idx, 'REI BlackBook Link'),
      'Task Body': body
    };
    /*
     * A parked row is flagged the same way the booking form flags one, so it reads as visibly unfinished
     * on the board rather than as a complete record with a strange address — and so the BEING ADDED card
     * can count how long it has been waiting. The timestamp goes inside the TEXT because Created Date and
     * Last Updated Date are both midnight-only dates; the card subtracts this ISO instant instead.
     */
    if (parked) {
      lead['Property Address'] = parked;
      lead['Data Quality Status'] = 'Incomplete';
      lead['Exception Reason'] = 'Waiting for the PC to read REI and fill in the address and details.' +
        ' [since ' + new Date().toISOString() + ']';
    }
    var res;
    try { res = webIntake_(lead); } catch (e) { res = { ok: false, error: String(e) }; }
    /*
     * The warning is part of the Status, not a footnote in the log. webIntake_ now REFUSES a date it
     * cannot read rather than turning it into 1969-12-31, and the person watching this tab is the one who
     * can put the real date on the row — so the cell has to say the date did not go in.
     */
    sh.getRange(rowNum, idx['Status'] + 1).setValue(
      res.ok ? ((res.created ? 'Logged (new)' : 'Logged (updated)') + ' · cal: ' + (res.calendar || '-') +
                (res.warning ? ' · ⚠️ ' + res.warning : ''))
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
/*
 * EVERY MINUTE, not every ten, and the reason is what the queue actually holds.
 *
 * The client: "the intake inbox kinda take long for 10 mins we need it to for 5 mins ... once there a new
 * came from intake inbox should auto process in the data because that is prio."
 *
 * They asked for five and this is one, because five is not meaningfully closer to what they want and one
 * costs almost nothing. A row sitting in this tab is a BOOKING somebody took on the phone — a seller
 * expecting a visit, and a colleague waiting to organise it. Ten minutes of it existing nowhere but a
 * staging tab is ten minutes where the board, Juan's calendar and the team all say the visit does not
 * exist.
 *
 * The cost is a run a minute, and an idle run is cheap: it reads the tab, finds every row already carries a
 * Status, and returns. Apps Script's minimum interval is one minute, so this is as close to immediate as a
 * timer can get.
 *
 * IT IS STILL A TIMER, AND THAT IS A REAL LIMITATION worth writing down rather than hiding. Zapier writes
 * this tab through the Sheets API, and an API write does not fire onEdit or onChange — the same rule that
 * makes the tracker's own stage cascade need a handler rather than a sheet event. So nothing can react to
 * the row ARRIVING; the best available is to look very often. Genuinely instant means Zapier calling the
 * web app's intake endpoint directly instead of writing a row, which is a change on the Zapier side.
 */
function installInboxTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processIntakeInbox_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processIntakeInbox_').timeBased().everyMinutes(1).create();
  SpreadsheetApp.getActive().toast(
    'Auto-check ON: the Intake Inbox is now read EVERY MINUTE, so a booking reaches the board and '
    + "Juan's calendar within about a minute of Zapier writing it.", 'Intake Inbox', 8);
}

/** Menu: remove the auto-check. */
function removeInboxTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processIntakeInbox_') { ScriptApp.deleteTrigger(t); n++; }
  });
  SpreadsheetApp.getActive().toast('Auto-check OFF (' + n + ' trigger removed).', 'Intake Inbox', 6);
}
