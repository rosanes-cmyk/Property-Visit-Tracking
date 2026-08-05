/**
 * Twin Visit Logger — why didn't the cancellation go through?
 *
 * Run cancelDoctor() from the Apps Script editor and read the execution log.
 *
 * Setting a visit to Canceled is supposed to do three things: tag the calendar event and keep it, strip
 * its reminders, and post one Chat alert. It is doing none of them, and every link in that chain fails
 * SILENTLY — a missing trigger logs nothing, an unreachable calendar returns the string "calendar not
 * found" to a caller that only logs it, and a blank webhook makes the alert a no-op by design.
 *
 * So rather than guess at which link it is, this walks the whole chain and prints what it finds:
 *
 *   1. is the onEditInstallable trigger installed at all — without it NO sheet edit runs anything
 *   2. is a Chat webhook saved
 *   3. which calendar does the code resolve, and can this account WRITE to it
 *   4. which rows are marked Canceled
 *   5. what calendar events actually exist for that property
 *   6. then it runs the real sync on that row and prints the result
 *
 * Steps 1-5 change nothing. Step 6 performs the tag, because that is the thing that is supposed to
 * happen; it is idempotent — an already-tagged event is left alone.
 */
function cancelDoctor() {
  var L = function (s) { Logger.log(s); };

  L('=== 1. Triggers ===');
  var triggers = ScriptApp.getProjectTriggers();
  if (!triggers.length) L('  NONE. No trigger is installed in this project at all.');
  triggers.forEach(function (t) {
    L('  ' + t.getHandlerFunction() + '  (' + t.getEventType() + ')');
  });
  var hasEdit = triggers.some(function (t) { return t.getHandlerFunction() === 'onEditInstallable'; });
  L(hasEdit
    ? '  -> onEditInstallable IS installed, so a sheet edit runs the automation.'
    : '  -> onEditInstallable is MISSING. Nothing you type in the sheet triggers anything. ' +
      'Fix: menu "4) Install automation triggers".');

  L('');
  L('=== 2. Google Chat webhook ===');
  var hook = '';
  try { hook = chatWebhookUrl_() || ''; } catch (e) { L('  chatWebhookUrl_ threw: ' + e); }
  L(hook ? '  saved (' + hook.length + ' chars) — alerts can be posted.'
    : '  BLANK. No Chat alert can be sent. Fix: menu "Set Google Chat webhook".');

  L('');
  L('=== 3. Calendar ===');
  L('  CFG.VISIT_CALENDAR_NAME = "' + (CFG.VISIT_CALENDAR_NAME || '') + '"   (takes priority)');
  L('  CFG.VISIT_CALENDAR_ID   = "' + (CFG.VISIT_CALENDAR_ID || '') + '"');
  L('  script runs as: ' + Session.getEffectiveUser().getEmail());
  var cal = null;
  try { cal = visitCalendar_(); } catch (e) { L('  visitCalendar_ threw: ' + e); }
  if (!cal) {
    L('  -> NO CALENDAR RESOLVED. This is fatal for tagging: markVisitEvents_ returns');
    L('     "calendar not found" and the cancellation cannot touch anything.');
    L('     Usually means the named calendar is not shared with this account WITH EDIT RIGHTS.');
    L('     Calendars this account CAN see:');
    (CalendarApp.getAllCalendars() || []).forEach(function (c) {
      L('       "' + c.getName() + '"  owned-by-me=' + c.isOwnedByMe() + '  id=' + c.getId());
    });
  } else {
    L('  resolved: "' + cal.getName() + '"  id=' + cal.getId());
    L('  owned by this account: ' + cal.isOwnedByMe());
    if (!cal.isOwnedByMe()) {
      L('  -> shared calendar. Tagging needs EDIT rights, not just "see all event details".');
      L('     If step 6 reports "no matching event" but step 5 listed one, this is why.');
    }
  }

  L('');
  L('=== 4. Rows marked Canceled / Reschedule Needed ===');
  var sh = dataSheet_();
  var last = sh.getLastRow();
  var idx = headerIndex_();
  var width = Math.max(sh.getLastColumn(), HEADERS.length);
  var vals = sh.getRange(CFG.FIRST_DATA_ROW, 1, last - CFG.FIRST_DATA_ROW + 1, width).getValues();
  var hits = [];
  vals.forEach(function (v, i) {
    var get = function (h) { var c = idx[h]; return c ? v[c - 1] : ''; };
    var st = String(get('Visit Status') || '').trim();
    if (st !== 'Canceled' && st !== 'Reschedule Needed') return;
    hits.push({
      row: CFG.FIRST_DATA_ROW + i,
      addr: get('Property Address'),
      seller: get('Seller Name'),
      status: st,
      date: get('Visit Date'),
      stage: String(get('Current Stage') || '')
    });
  });
  if (!hits.length) {
    L('  NONE. No row in the sheet has Visit Status = Canceled.');
    L('  -> If you cancelled on the dashboard, the save did not reach the sheet. Nothing downstream');
    L('     can work until the cell itself says Canceled, so start there.');
    return;
  }
  hits.forEach(function (h) {
    L('  row ' + h.row + '  ' + h.status + '  ' + h.seller + ' · ' + h.addr +
      '  visit=' + (h.date ? fmt_(new Date(h.date)) : '(blank)') + '  stage="' + h.stage + '"');
  });

  var t = hits[0];
  L('');
  L('=== 5. Calendar events for row ' + t.row + ' (' + t.addr + ') ===');
  if (!cal) {
    L('  skipped — no calendar resolved.');
  } else {
    var evs = findVisitEvents_(cal, t.addr, t.date);
    if (!evs.length) {
      L('  no matching event found.');
      L('  -> Either the event was already deleted by the OLD behaviour (this used to delete on');
      L('     cancel), or it lives on a different calendar from the one resolved above. The local');
      L('     scraper writes to whichever calendar its own .env names, which may not be this one.');
    }
    evs.forEach(function (e) {
      L('  "' + e.getTitle() + '"  ' + e.getStartTime() + '  reminders=' + (e.getPopupReminders() || []).length);
    });
  }

  L('');
  L('=== 6. Running the real sync on row ' + t.row + ' ===');
  try {
    var result = syncVisitCalendar_(sh, t.row);
    L('  syncVisitCalendar_ returned: ' + result);
    L('  Meaning:');
    L('    "tagged N event(s)"   -> it worked. Check the calendar and Chat.');
    L('    "already tagged (N)"  -> it worked earlier; no second alert is sent, by design.');
    L('    "no matching event"   -> the event is not on the resolved calendar (see step 5).');
    L('    "calendar not found"  -> step 3 is the problem.');
  } catch (e) {
    L('  syncVisitCalendar_ THREW: ' + e);
  }
}
