/**
 * Twin Visit Logger — Web Dashboard (Apps Script Web App).
 * The Google Sheet remains the database. doGet() serves a mobile-friendly dashboard that reads the
 * live Data sheet; quick-actions call webAction(), which writes the sheet and runs the SAME
 * automation handlers as a manual edit (validation, Task Queue, stage cascades all apply).
 * Never contacts sellers. Excludes Source = TEST from every view.
 *
 * Deploy: Apps Script editor -> Deploy -> New deployment -> Web app
 *   Execute as: Me | Who has access: (your choice, e.g. anyone in your org). Open the /exec URL.
 */

function doGet(e) {
  e = e || {}; const p = e.parameter || {};
  if (p.api) {                                   // JSON API for the external website
    if (!apiAuthed_(p)) return apiJson_({ ok: false, error: 'unauthorized' });
    if (p.api === 'data') return apiJson_({ ok: true, data: webGetData() });
    return apiJson_({ ok: false, error: 'unknown api endpoint' });
  }
  // Polished dashboard served from the Dashboard.html file (falls back to the built-in string
  // if that file isn't present in the project).
  var out;
  try { out = HtmlService.createHtmlOutputFromFile('Dashboard'); }
  catch (e) { out = HtmlService.createHtmlOutput(dashboardHtml_()); }
  return out
    .setTitle('Twin Visit Logger')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** JSON API for writes from the website's serverless proxy. Body: {token, action, id, params}. */
function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return apiJson_({ ok: false, error: 'bad JSON' }); }
  if (!apiAuthed_(body)) return apiJson_({ ok: false, error: 'unauthorized' });
  if (body.action === 'data') return apiJson_({ ok: true, data: webGetData() });
  if (body.action === 'intake') return apiJson_(webIntake_(body.lead || body.params || body));
  return apiJson_(webAction(body.action, body.id, body.params || {}));
}

function apiAuthed_(o) { return !!CFG.API_TOKEN && o && String(o.token) === String(CFG.API_TOKEN); }
function apiJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- server: read ---------------- */

/**
 * Sheets stores a date/time as a serial number, and getValues() only returns a Date object when the
 * cell carries a date format. Rows written by the external automation can arrive unformatted, which
 * is why the detail view showed "46235" and "0.5833333" instead of a date and a time. Convert those
 * serials by column meaning so the UI always shows something readable.
 *   date serial 46235 -> 2026-08-01     time fraction 0.58333 -> 2:00 PM
 */
function cellDisplay_(header, val) {
  if (val == null || val === '') return '';
  var h = String(header);
  var isTime = /\bTime$/i.test(h);
  var isDate = /Date/i.test(h);

  if (val instanceof Date) {
    if (isTime) return Utilities.formatDate(val, Session.getScriptTimeZone(), 'h:mm a');
    return fmt_(val);
  }
  if (typeof val !== 'number' || !isFinite(val)) return val;

  if (isTime && val >= 0 && val < 1) {
    var mins = Math.round(val * 24 * 60);
    var hh = Math.floor(mins / 60) % 24, mm = mins % 60;
    var ap = hh >= 12 ? 'PM' : 'AM';
    var h12 = hh % 12; if (h12 === 0) h12 = 12;
    return h12 + ':' + (mm < 10 ? '0' + mm : mm) + ' ' + ap;
  }
  if (isDate && val > 1000) {
    // Sheets' serial epoch is 1899-12-30. Keep the whole-day part; ignore any time fraction.
    return fmt_(new Date(Date.UTC(1899, 11, 30) + Math.round(val) * 86400000));
  }
  return val;
}

/** Date-only helper for the flat fields: tolerates Date objects and bare serial numbers alike. */
function fmtCell_(header, val) {
  var out = cellDisplay_(header, val);
  return out === 0 ? '' : out;
}

function webGetData() {
  const sh = dataSheet_();
  const last = sh.getLastRow();
  const rows = [];
  if (last >= CFG.FIRST_DATA_ROW) {
    const vals = sh.getRange(CFG.FIRST_DATA_ROW, 1, last - CFG.FIRST_DATA_ROW + 1, HEADERS.length).getValues();
    vals.forEach(function(v, i){
      const rec = {}; HEADERS.forEach(function(h, j){ rec[h] = v[j]; });
      if (!rec['Property Address'] || String(rec['Source']).trim() === 'TEST') return; // live records only
      // full = every column, dates/times made readable, for the accurate 61-field detail view
      const full = {}; HEADERS.forEach(function(h){ full[h] = cellDisplay_(h, rec[h]); });
      rows.push({
        rowNum: CFG.FIRST_DATA_ROW + i,
        id: rec['Property ID'] || '',
        address: rec['Property Address'] || '',
        seller: rec['Seller Name'] || '',
        phone: rec['Phone'] || '',
        email: rec['Email'] || '',
        lead: rec['Lead Source'] || '',
        stage: rec['Current Stage'] || '',
        owner: rec['Assigned Owner'] || '',
        visitStatus: rec['Visit Status'] || '',
        visitDate: fmtCell_('Visit Date', rec['Visit Date']),
        visitTime: fmtCell_('Visit Time', rec['Visit Time']),
        visitor: rec['Assigned Visitor'] || '',
        visitNotes: rec['Visit Notes'] || '',
        nextAction: rec['Next Action'] || '',
        due: fmtCell_('Next Action Due Date', rec['Next Action Due Date']),
        lastContact: fmtCell_('Last Contact Date', rec['Last Contact Date']),
        daysOverdue: rec['Days Overdue'] === '' ? 0 : Number(rec['Days Overdue']) || 0,
        stalled: rec['Stalled Status'] === 'Yes',
        blocker: rec['Blocker'] || '',
        lastResult: rec['Last Contact Result'] || '',
        offerAmount: rec['Approved Offer Amount'] || '',
        dq: rec['Data Quality Status'] || '',
        exceptionReason: rec['Exception Reason'] || '',
        missing: rec['Missing Required Fields'] || '',
        rei: rec['REI BlackBook Link'] || '',
        priority: Number(rec['Opportunity Priority']) || 0,
        daysSince: rec['Days Since Last Activity'] === '' ? '' : Number(rec['Days Since Last Activity']),
        disposition: rec['Final Disposition'] || '',
        handoff: rec['Transaction Handoff Status'] || '',
        gift: rec['Gift Status'] || '',
        offerPromised: fmtCell_('Offer Promised Date', rec['Offer Promised Date']),
        sellerFloor: rec['Seller Floor'] || '',
        ourMax: rec['Our Max'] || '',
        priceGap: (Number(rec['Seller Floor']) && Number(rec['Our Max']) && Number(rec['Seller Floor']) > Number(rec['Our Max'])) ? (Number(rec['Seller Floor']) - Number(rec['Our Max'])) : 0,
        sla: slaFor_(rec),
        full: full
      });
    });
  }
  function by(pred, sort){ const r = rows.filter(pred); if (sort) r.sort(sort); return r; }
  const ovSort = function(a,b){ return b.daysOverdue - a.daysOverdue; };
  const prSort = function(a,b){ return b.priority - a.priority; };
  const sections = [
    ['Contracts Possible This Week', by(function(r){ return ['Verbal Agreement','Contract Sent','Active Negotiation'].indexOf(r.stage) >= 0; }, prSort)],
    ['Visited — No Offer Decision', by(function(r){ return r.stage === 'Visit Completed — Needs Review'; }, ovSort)],
    ['Offer Sent — Follow-Up Due', by(function(r){ return r.stage === 'Offer Sent'; }, ovSort)],
    ['Stalled Deals', by(function(r){ return r.stalled; }, ovSort)],
    ['Overdue Tasks', by(function(r){ return r.daysOverdue > 0; }, ovSort)],
    ['Negotiation Decisions', by(function(r){ return r.stage === 'Active Negotiation'; }, prSort)],
    ['Contract Handoffs', by(function(r){ return r.stage === 'Contract Signed' && r.handoff !== 'Handoff Confirmed'; })],
    ['Gift Review', by(function(r){ return r.gift === 'Recommended'; })],
    ['Revival Opportunities', by(function(r){ return r.disposition === 'Lost' && r.daysSince !== '' && r.daysSince >= 45; }, ovSort)],
    ['Exceptions Requiring Review', by(function(r){ return r.dq === 'Incomplete' || r.dq === 'Exception'; })]
  ].map(function(s){ return { title: s[0], rows: s[1] }; });

  const owners = DROPDOWNS['Assigned Owner'];
  var email = ''; try { email = Session.getActiveUser().getEmail() || ''; } catch (e) {}
  return { generatedAt: fmt_(today_()), owners: owners, sections: sections, records: rows, trash: trashList_(), userEmail: email, totalLive: rows.length };
}

/* ---------------- server: safe write actions ---------------- */

function findRowById_(id) {
  const sh = dataSheet_();
  const last = sh.getLastRow();
  if (last < CFG.FIRST_DATA_ROW) return 0;
  const ids = sh.getRange(CFG.FIRST_DATA_ROW, col('Property ID'), last - CFG.FIRST_DATA_ROW + 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return CFG.FIRST_DATA_ROW + i;
  return 0;
}

/**
 * Perform a guarded action from the web. It writes the record then runs the SAME automation
 * handler a manual edit would, so validation, Task Queue, and stage cascades all apply.
 * The dashboard only records values the user supplies — it never sets prices/decisions itself
 * and never messages a seller.
 */
/** Next TVL-#### id based on existing ids. */
function nextPropertyId_() {
  const sh = dataSheet_();
  const last = sh.getLastRow();
  var max = 0;
  if (last >= CFG.FIRST_DATA_ROW) {
    const ids = sh.getRange(CFG.FIRST_DATA_ROW, col('Property ID'), last - CFG.FIRST_DATA_ROW + 1, 1).getValues();
    ids.forEach(function(r){ const m = String(r[0]).match(/TVL-(\d+)/); if (m) max = Math.max(max, Number(m[1])); });
  }
  return 'TVL-' + ('000' + (max + 1)).slice(-4);
}

/** Create a NEW record from the website. Writes into the first empty row (grid never shrinks),
 *  stamps Property ID + Source=Manual + Created Date, then runs the visit-status handler so the
 *  same automation fires. Never contacts sellers. */
function webAddRecord_(params) {
  const sh = dataSheet_();
  ensureRows_(sh, CFG.MAX_ROWS);
  var row = 0;
  const addrs = sh.getRange(CFG.FIRST_DATA_ROW, col('Property Address'), CFG.MAX_ROWS - 1, 1).getValues();
  for (var i = 0; i < addrs.length; i++) { if (String(addrs[i][0]).trim() === '') { row = CFG.FIRST_DATA_ROW + i; break; } }
  if (!row) return { ok: false, error: 'No empty rows available (increase MAX_ROWS).' };
  if (!params['Property Address']) return { ok: false, error: 'Property Address is required.' };
  const R = new RowAccessor_(sh, row);
  const map = ['Property Address','Seller Name','Phone','Email','Lead Source','Visit Date','Visit Time',
    'Visit Status','Assigned Visitor','Visit Notes','Seller Motivation','Current Stage','Assigned Owner',
    'Next Action','Next Action Due Date','REI BlackBook Link'];
  map.forEach(function(h){
    if (params[h] === undefined || params[h] === '') return;
    if (h.indexOf('Date') >= 0) R.set(h, new Date(params[h])); else R.set(h, params[h]);
  });
  R.set('Property ID', nextPropertyId_());
  R.set('Source', 'Manual');
  R.set('Created Date', today_());
  stamp_(R);
  R.flush();
  if (params['Visit Status']) onVisitStatus_(new RowAccessor_(sh, row));
  SpreadsheetApp.flush();
  return { ok: true, data: webGetData(), newId: R.get('Property ID') };
}

function webAction(action, id, params) {
  params = params || {};
  if (action === 'addRecord') { try { return webAddRecord_(params); } catch (e) { return { ok: false, error: String(e) }; } }
  if (action === 'restoreRecord') { try { var rr = restoreFromTrash_(Number(params.trashRow)); if (rr.ok) rr.data = webGetData(); return rr; } catch (e) { return { ok: false, error: String(e) }; } }
  const sh = dataSheet_();
  const rowNum = findRowById_(id);
  if (!rowNum) return { ok: false, error: 'Record not found: ' + id };
  const R = new RowAccessor_(sh, rowNum);
  try {
    switch (action) {
      case 'visitCompleted':
        R.set('Visit Status', 'Completed'); stamp_(R); R.flush();
        runHandler_(onVisitStatus_, sh, rowNum); break;
      case 'logContact':
        R.set('Last Contact Date', today_());
        if (params.result) R.set('Last Contact Result', params.result);
        if (params.nextAction) R.set('Next Action', params.nextAction);
        if (params.due) R.set('Next Action Due Date', new Date(params.due));
        stamp_(R); R.flush(); break;
      case 'recordOfferSent':
        if (params.amount) R.set('Approved Offer Amount', Number(params.amount));
        R.set('Offer Sent Date', params.date ? new Date(params.date) : today_());
        stamp_(R); R.flush(); runHandler_(onOfferSent_, sh, rowNum); break;
      case 'sellerCounter':
        if (params.amount) R.set('Counteroffer Amount', Number(params.amount));
        if (params.result) R.set('Last Contact Result', params.result);
        stamp_(R); R.flush(); runHandler_(onSellerCounter_, sh, rowNum); break;
      case 'contractSent':
        R.set('Contract Sent Date', params.date ? new Date(params.date) : today_());
        stamp_(R); R.flush(); runHandler_(onContractSent_, sh, rowNum); break;
      case 'contractSigned':
        R.set('Contract Signed Date', params.date ? new Date(params.date) : today_());
        stamp_(R); R.flush(); runHandler_(onContractSigned_, sh, rowNum); break;
      case 'nurture':
        R.set('Current Stage', 'Long-Term Nurture');
        if (params.due) R.set('Next Action Due Date', new Date(params.due));
        if (params.nextAction) R.set('Next Action', params.nextAction);
        stamp_(R); R.flush(); runHandler_(onStageManual_, sh, rowNum); break;
      case 'setNextAction':
        if (params.nextAction) R.set('Next Action', params.nextAction);
        if (params.due) R.set('Next Action Due Date', new Date(params.due));
        if (params.owner) R.set('Assigned Owner', params.owner);
        stamp_(R); R.flush(); break;
      case 'updateRecord': {
        // edit any INPUT field from the full-record view (computed columns are ignored)
        var locked = COMPUTED_HEADERS.concat(['Property ID','Created Date','Last Updated Date','Updated By']);
        Object.keys(params).forEach(function(h){
          if (HEADERS.indexOf(h) < 0 || locked.indexOf(h) >= 0) return;
          var val = params[h];
          if (h.indexOf('Date') >= 0) R.set(h, val ? new Date(val) : '');
          else if (h === 'Approved Offer Amount' || h === 'Counteroffer Amount' || h === 'Asking Price' || h === 'Price Expectation') R.set(h, val === '' || val == null ? '' : Number(val));
          else R.set(h, val == null ? '' : val);
        });
        stamp_(R); R.flush(); syncVisitCalendar_(sh, rowNum); break;
      }
      case 'deleteRecord':
        softDelete_(sh, rowNum); break;           // move to Trash sheet (restorable), then clear the row
      default:
        return { ok: false, error: 'Unknown action: ' + action };
    }
    SpreadsheetApp.flush();
    return { ok: true, data: webGetData() };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * SLA / service-failure detection. Returns a short reason string (or '') for a record.
 * Thresholds: no contact > 48h (>=2 business days) on active-engagement stages;
 * offer promised but not sent within 1 business day; backstop when no promised date
 * is set but the record sits in a decision/prep stage past 1 business day with no offer.
 */
/**
 * Run an automation handler for one row and PERSIST its changes.
 *
 * The handlers were written for onEdit, where onEditInstallable flushes at the end. Called directly
 * from webAction they were never flushed, so a quick-action saved its own field but silently lost the
 * cascade — "Mark visit completed" set Visit Status but not Current Stage, leaving the card stuck in
 * Upcoming Visits. Always flush here, then keep the calendar in step with the new state.
 */
function runHandler_(handler, sh, rowNum) {
  var R = new RowAccessor_(sh, rowNum);
  handler(R);
  R.flush();
  syncVisitCalendar_(sh, rowNum);
  return R;
}

/**
 * Make the calendar match the row's current state.
 *   Canceled / closed / no visit date -> remove the event
 *   Scheduled with a visit date       -> ensure the event exists on that date
 * Called after every dashboard write so rescheduling or cancelling in the dashboard is reflected on
 * the calendar without anyone editing it by hand.
 */
function syncVisitCalendar_(sh, rowNum) {
  try {
    var R = new RowAccessor_(sh, rowNum);
    var addr = R.get('Property Address');
    if (!addr) return '';
    var status = String(R.get('Visit Status') || '');
    var stage = String(R.get('Current Stage') || '');
    var visitDate = R.get('Visit Date');
    var cancelled = status === 'Canceled' || status === 'Reschedule Needed' || stage === 'Lost / Closed Out';

    if (cancelled || !visitDate) {
      var removed = deleteVisitEvents_(addr, visitDate);
      logAuto_('CALENDAR', R.get('Property ID'), 'Visit event removed (' + (cancelled ? status || stage : 'no visit date') + ') · ' + removed);
      return removed;
    }
    // Re-point the event at the current date: drop any stale copy, then create it fresh.
    deleteVisitEvents_(addr, null);
    var res = maybeCreateVisitEvent_({
      'Property Address': addr, 'Seller Name': R.get('Seller Name'), 'Phone': R.get('Phone'),
      'REI BlackBook Link': R.get('REI BlackBook Link'), 'Lead Source': R.get('Lead Source'),
      'Visit Date': visitDate
    }, addr);
    logAuto_('CALENDAR', R.get('Property ID'), 'Visit event synced to ' + fmt_(new Date(visitDate)) + ' · ' + res);
    return res;
  } catch (e) {
    logAuto_('ERROR', 'syncVisitCalendar', String(e));
    return 'error: ' + e;
  }
}

/**
 * Realign Current Stage with the row's own evidence.
 *
 * Half-applied dashboard actions (and earlier automation) left rows whose Current Stage contradicts
 * their other fields - e.g. Visit Status=Completed but stage still "Visit Scheduled", so the card sat
 * in Upcoming Visits with no button able to move it. Derive the stage from the strongest signal
 * present and rewrite only the rows that disagree. Menu: "Fix mismatched stages".
 */
function repairStages() {
  var sh = dataSheet_();
  var last = sh.getLastRow();
  if (last < CFG.FIRST_DATA_ROW) return;
  var fixed = [];
  for (var r = CFG.FIRST_DATA_ROW; r <= last; r++) {
    var R = new RowAccessor_(sh, r);
    if (!R.get('Property Address')) continue;
    var stage = String(R.get('Current Stage') || '');
    // Terminal stages are the operator's decision - never second-guess them.
    if (stage === 'Lost / Closed Out' || stage === 'Long-Term Nurture' || stage === 'Contract Signed') continue;

    var want = '';
    if (R.get('Contract Signed Date')) want = 'Contract Signed';
    else if (R.get('Contract Sent Date')) want = 'Contract Sent';
    else if (R.get('Counteroffer Amount')) want = 'Active Negotiation';
    else if (R.get('Offer Sent Date')) want = 'Offer Sent';
    else if (R.get('Approved Offer Amount')) want = 'Offer Preparation';
    else if (String(R.get('Visit Status')) === 'Completed') want = 'Visit Completed — Needs Review';
    else if (String(R.get('Visit Status')) === 'Canceled') want = '';   // leave for a human to close out
    else if (String(R.get('Visit Status')) === 'Scheduled') want = 'Visit Scheduled';

    if (want && want !== stage) {
      R.set('Current Stage', want);
      if (want === 'Visit Completed — Needs Review') {
        R.setIfBlank('Assigned Owner', 'Jonathan');
        R.setIfBlank('Next Action', 'Review completed visit: make offer or pass');
        R.setIfBlank('Next Action Due Date', today_());
      }
      R.flush();
      syncVisitCalendar_(sh, r);
      fixed.push(R.get('Property ID') + ': "' + stage + '" -> "' + want + '"');
    }
  }
  SpreadsheetApp.flush();
  logAuto_('REPAIR', '', 'repairStages fixed ' + fixed.length + ' row(s). ' + fixed.join(' | '));
  SpreadsheetApp.getActive().toast(
    fixed.length ? ('Fixed ' + fixed.length + ' mismatched stage(s): ' + fixed.join(' · ')) : 'No mismatched stages found.',
    'repairStages', 15);
}

function slaFor_(rec) {
  var stage = rec['Current Stage'] || '';
  if (stage === 'Lost / Closed Out' || stage === 'Contract Signed' || stage === 'Long-Term Nurture') return '';
  var t = today_();
  function d(v){ return v ? new Date(v) : null; }
  function maxD(){ var m=null; for (var i=0;i<arguments.length;i++){ var x=d(arguments[i]); if(x&&(!m||x>m)) m=x; } return m; }
  var reasons = [];
  // 1) offer promised but not sent
  var promised = d(rec['Offer Promised Date']), sent = d(rec['Offer Sent Date']);
  if (promised && !sent && bizDaysBetween_(promised, t) >= 1) reasons.push('Offer promised, not sent');
  else if (!promised && !sent && (stage === 'Visit Completed — Needs Review' || stage === 'Offer Preparation')) {
    var since = maxD(rec['Visit Date'], rec['Last Updated Date']);       // backstop: no promised date recorded
    if (since && bizDaysBetween_(since, t) >= 1) reasons.push('Offer decision overdue');
  }
  // 2) no contact > 48h on an active-engagement stage
  var engage = ['Offer Sent','Active Negotiation','Verbal Agreement','Contract Sent','Visit Completed — Needs Review'];
  if (engage.indexOf(stage) >= 0) {
    var last = maxD(rec['Last Contact Date'], rec['Last Updated Date'], rec['Visit Date']);
    if (last && bizDaysBetween_(last, t) >= 2) reasons.push('No contact 48h+');
  }
  return reasons.join(' · ');
}

/* ---------------- Lead intake (REI BlackBook webhook → tracker + calendar) ---------------- */
function intakeNorm_(s){ return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24); }
function intakeDigits_(s){ return String(s || '').replace(/\D/g, ''); }

/** Find an existing live record by normalized address or phone (dedupe). */
function findByAddressOrPhone_(addr, phone) {
  const sh = dataSheet_(); const last = sh.getLastRow();
  if (last < CFG.FIRST_DATA_ROW) return null;
  const n = last - CFG.FIRST_DATA_ROW + 1;
  const A = sh.getRange(CFG.FIRST_DATA_ROW, col('Property Address'), n, 1).getValues();
  const P = sh.getRange(CFG.FIRST_DATA_ROW, col('Phone'), n, 1).getValues();
  const ID = sh.getRange(CFG.FIRST_DATA_ROW, col('Property ID'), n, 1).getValues();
  const na = intakeNorm_(addr), np = intakeDigits_(phone);
  for (var i = 0; i < n; i++) {
    if ((na && intakeNorm_(A[i][0]) === na) || (np && np.length >= 7 && intakeDigits_(P[i][0]) === np))
      return { rowNum: CFG.FIRST_DATA_ROW + i, id: ID[i][0] };
  }
  return null;
}

/** Office→property drive time in minutes (Apps Script Maps service). 0 if unavailable. */
function driveMinutes_(dest) {
  try {
    const d = Maps.newDirectionFinder().setOrigin(CFG.OFFICE_ORIGIN).setDestination(dest).getDirections();
    return Math.ceil(d.routes[0].legs[0].duration.value / 60);
  } catch (e) { return 0; }
}

/** Create Juan's calendar event with a drive-time "leave by" reminder. Sandbox-gated. */
function visitCalendar_() {
  // Prefer the named calendar. getCalendarsByName covers calendars shared WITH this account, so
  // "Juan's Official Calendar" resolves without anyone copying an ID out of Calendar settings.
  var name = CFG.VISIT_CALENDAR_NAME;
  if (name) {
    var byName = CalendarApp.getCalendarsByName(name) || [];
    if (byName.length) return byName[0];
    logAuto_('ERROR', 'calendar', 'No calendar named "' + name + '" is visible to this account. ' +
      'Confirm it is shared with edit rights, or clear VISIT_CALENDAR_NAME to use VISIT_CALENDAR_ID.');
    return null;
  }
  var id = CFG.VISIT_CALENDAR_ID;
  if (!id) return null;
  return (id === 'default' || id === 'me') ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(id);
}
function maybeCreateVisitEvent_(map, addr) {
  if (!CFG.VISIT_CALENDAR_ID && !CFG.VISIT_CALENDAR_NAME) return 'skipped (no calendar configured)';
  try {
    const cal = visitCalendar_();
    if (!cal) return 'calendar not found / not shared';
    if (!map['Visit Date']) return 'no visit date — event skipped';
    const start = new Date(map['Visit Date']); start.setHours(9, 0, 0, 0);   // default 9:00 window if no time given
    const end = new Date(start.getTime() + 60 * 60000);
    const desc = 'Seller: ' + (map['Seller Name'] || '') + '\nPhone: ' + (map['Phone'] || '') +
                 '\nREI: ' + (map['REI BlackBook Link'] || '') + '\nLead source: ' + (map['Lead Source'] || '');
    const ev = cal.createEvent('Property Visit - ' + addr, start, end, { description: desc, location: addr });
    const mins = driveMinutes_(addr);
    ev.removeAllReminders();
    if (mins) ev.addPopupReminder(mins);   // "leave office by" — mins before start (never shifts the event itself)
    ev.addPopupReminder(30);
    return 'event created (' + (mins ? mins + 'm drive reminder' : '30m only') + ')';
  } catch (e) { return 'error: ' + e; }
}

/**
 * Delete the "Property Visit - <addr>" event(s) from the calendar (used when a record is
 * deleted in the dashboard). Searches a window around the visit date (±2 days to absorb any
 * timezone offset); falls back to a broad search if no visit date. Only removes exact-title matches.
 */
function deleteVisitEvents_(addr, visitDate) {
  if ((!CFG.VISIT_CALENDAR_ID && !CFG.VISIT_CALENDAR_NAME) || !addr) return 'no calendar / address';
  try {
    var cal = visitCalendar_();
    if (!cal) return 'calendar not found';
    var title = 'Property Visit - ' + addr;
    var from, to;
    if (visitDate) { var d = new Date(visitDate); from = new Date(d.getTime() - 2*864e5); to = new Date(d.getTime() + 3*864e5); }
    else { var n = new Date(); from = new Date(n.getTime() - 120*864e5); to = new Date(n.getTime() + 365*864e5); }
    var evs = cal.getEvents(from, to, { search: addr });
    var removed = 0;
    // Match BOTH producers: this script writes "Property Visit - <addr>", while the local scraper
    // writes "Property Visit | <seller> | <addr>". Anything starting "Property Visit" that carries
    // this address is ours, so a cancel/reschedule cleans up either one.
    // NB: use a FULL-length key here, not intakeNorm_ (which truncates to 24 chars and would drop
    // the address out of a "Property Visit | Seller | Address" title).
    var keyOf = function(s){ return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
    var addrKey = keyOf(addr);
    evs.forEach(function(e){
      var t = e.getTitle() || '';
      var mine = (t === title) || (/^Property Visit\b/i.test(t) && addrKey && keyOf(t).indexOf(addrKey) >= 0);
      if (mine) { e.deleteEvent(); removed++; }
    });
    return removed ? ('removed ' + removed + ' event(s)') : 'no matching event';
  } catch (e) { return 'error: ' + e; }
}

/**
 * Create a tracker row from an inbound lead (REI BlackBook webhook). Dedupes by address/phone,
 * never creates duplicates, sets stage = Visit Scheduled. In SANDBOX, no real calendar event is
 * created (reported instead). Accepts either sheet-header keys or short keys.
 */
/**
 * Parse an REI BlackBook task body ("Booked appointment on Jul 24" style) for the fields that
 * live in free text: seller name, property address, and the real appointment date/time.
 * Used as a fallback so intake works even when REI only sends the task text (not clean fields).
 */
function parseReiTaskBody_(text) {
  var t = String(text || '').replace(/<[^>]+>/g, '\n');   // strip HTML tags -> newlines
  var out = {}, m;
  m = t.match(/Lead:\s*([^\n<]+)/i);              if (m) out.seller  = m[1].trim();
  m = t.match(/Property address:\s*([^\n<]+)/i);  if (m) out.address = m[1].trim();
  m = t.match(/(?:visit scheduled|booked appointment)[^:\n]*:\s*([^\n<]+)/i);   // "...: Friday, Jul 24, 11:00 AM"
  if (m) {
    var s = m[1].trim().replace(/^[A-Za-z]+day,\s*/, '');           // drop leading weekday
    var tm = s.match(/(\d{1,2}:\d{2}\s*[AP]M)/i); if (tm) out.visitTime = tm[1].toUpperCase().replace(/\s+/g, ' ');
    var dm = s.match(/([A-Za-z]{3,9}\.?\s+\d{1,2})(?:,?\s*(\d{4}))?/);   // "Jul 24" or "July 24, 2026"
    if (dm) { var yr = dm[2] || String(new Date().getFullYear()); out.visitDate = dm[1] + ', ' + yr + (out.visitTime ? ' ' + out.visitTime : ''); }
  }
  out.summary = t.replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
  return out;
}

function webIntake_(lead) {
  lead = lead || {};
  const g = function(a, b){ return lead[a] != null && lead[a] !== '' ? lead[a] : (lead[b] != null ? lead[b] : ''); };
  // REI tasks carry the appointment time + address inside the task body — parse it as a fallback for missing fields.
  var _body = g('Task Body', 'body') || g('Description', 'description') || lead.taskBody || '';
  var _p = _body ? parseReiTaskBody_(_body) : {};
  if (_p.seller    && !g('Seller Name', 'seller'))   lead['Seller Name'] = _p.seller;
  if (_p.visitDate && !g('Visit Date', 'visitDate')) lead['Visit Date']  = _p.visitDate;
  if (_p.visitTime && !g('Visit Time', 'visitTime')) lead['Visit Time']  = _p.visitTime;
  if (_body && !g('Last Contact Result', 'note') && !g('Notes', 'notes')) lead['Notes'] = _p.summary || _body;
  const addr = g('Property Address', 'address') || _p.address || '';
  const phone = g('Phone', 'phone');
  if (!addr) return { ok: false, error: 'Property Address is required (not in fields or task body)' };
  if (!lead['Property Address'] && !lead.address) lead['Property Address'] = addr;   // so downstream g() sees it
  const sh = dataSheet_(); ensureRows_(sh, CFG.MAX_ROWS);
  // UPSERT: if this lead already exists, auto-update its note / status / stage (never sends anything)
  const dup = findByAddressOrPhone_(addr, phone);
  if (dup) {
    const U = new RowAccessor_(sh, dup.rowNum);
    var updated = [];
    var up = function(h, v){ if (v !== '' && v != null) { if (h.indexOf('Date') >= 0) U.set(h, new Date(v)); else U.set(h, v); updated.push(h); } };
    up('Last Contact Result', g('Last Contact Result', 'note') || g('Notes', 'notes') || g('Status update', 'statusUpdate'));
    up('Visit Status', g('Visit Status', 'visitStatus'));
    up('Current Stage', g('Current Stage', 'stage'));
    up('Next Action', g('Next Action', 'next'));
    up('Visit Date', g('Visit Date', 'visitDate'));
    up('Assigned Visitor', g('Assigned Visitor', 'visitor'));
    U.set('Last Contact Date', today_());
    U.set('Updated By', 'Apps Script'); U.set('Last Updated Date', today_());
    U.flush();
    var calMap = { 'Property Address': addr, 'Seller Name': U.get('Seller Name'), 'Phone': U.get('Phone'),
                   'REI BlackBook Link': U.get('REI BlackBook Link'), 'Lead Source': U.get('Lead Source'), 'Visit Date': U.get('Visit Date') };
    var calU = maybeCreateVisitEvent_(calMap, addr);
    SpreadsheetApp.flush();
    logAuto_('INTAKE', dup.id, 'Lead updated from REI webhook · ' + addr +
      (updated.length ? ' · fields: ' + updated.join(', ') : ' · no field changes') + ' · calendar: ' + calU);
    return { ok: true, updated: true, id: dup.id, fields: updated, calendar: calU };
  }
  var row = 0;
  const addrs = sh.getRange(CFG.FIRST_DATA_ROW, col('Property Address'), CFG.MAX_ROWS - 1, 1).getValues();
  for (var i = 0; i < addrs.length; i++) { if (String(addrs[i][0]).trim() === '') { row = CFG.FIRST_DATA_ROW + i; break; } }
  if (!row) return { ok: false, error: 'No empty rows available (increase MAX_ROWS)' };

  const map = {
    'Property Address': addr, 'Seller Name': g('Seller Name', 'seller'), 'Phone': phone,
    'Email': g('Email', 'email'), 'Lead Source': g('Lead Source', 'lead'),
    'REI BlackBook Link': g('REI BlackBook Link', 'rei'),
    'Visit Date': g('Visit Date', 'visitDate'), 'Visit Time': g('Visit Time', 'visitTime'),
    'Assigned Visitor': g('Assigned Visitor', 'visitor'),
    'Visit Status': 'Scheduled', 'Current Stage': 'Visit Scheduled',
    'Next Action': 'Conduct scheduled visit & log outcome',
    'Next Action Due Date': g('Visit Date', 'visitDate')
  };
  const R = new RowAccessor_(sh, row);
  Object.keys(map).forEach(function(h){ var v = map[h]; if (v === '' || v == null) return; if (h.indexOf('Date') >= 0) R.set(h, new Date(v)); else R.set(h, v); });
  R.set('Property ID', nextPropertyId_());
  R.set('Source', CFG.SANDBOX ? 'Intake-Sandbox' : 'Intake');
  R.set('Created Date', today_());
  stamp_(R); R.flush();
  const cal = maybeCreateVisitEvent_(map, addr);
  SpreadsheetApp.flush();
  logAuto_('INTAKE', R.get('Property ID'), 'New lead created from REI webhook · ' + addr +
    ' · visitor: ' + (map['Assigned Visitor'] || '(none)') + ' · visit: ' + (map['Visit Date'] ? fmt_(new Date(map['Visit Date'])) : '(none)') +
    ' · source: ' + (CFG.SANDBOX ? 'Intake-Sandbox' : 'Intake') + ' · calendar: ' + cal);
  return { ok: true, created: true, id: R.get('Property ID'), sandbox: !!CFG.SANDBOX, calendar: cal };
}

/** Editor test: simulate an REI webhook end-to-end, then clean up. Run and read the log. */
function testIntake() {
  const sample = {
    'Property Address': '123 Sandbox Test Ave, Testville, CA 90000',
    'Seller Name': 'Intake Test', 'Phone': '(000) 000-1234', 'Lead Source': 'PPC',
    'Visit Date': Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
  };
  var res = webIntake_(sample);
  Logger.log('INTAKE RESULT: ' + JSON.stringify(res));
  var res2 = webIntake_(sample);   // second call should dedupe
  Logger.log('UPSERT CHECK (should say updated:true): ' + JSON.stringify(res2));
  if (res.ok && res.created) { var rn = findRowById_(res.id); if (rn) clearRecordRow_(dataSheet_(), rn); }
  SpreadsheetApp.getActive().toast(
    'Intake test: ' + (res.ok ? 'PASS' : 'FAIL ' + res.error) + ' · created ' + (res.id || '-') +
    ' · calendar: ' + (res.calendar || '-') + ' · upsert: ' + ((res2.updated||res2.duplicate) ? 'OK' : 'FAILED') +
    ' · CHECK YOUR CALENDAR today for "Property Visit - 123 Sandbox Test Ave" (delete it after).', 'testIntake', 15);
}

/**
 * Same as testIntake but KEEPS the sandbox row so you can watch it appear in the LIVE dashboard.
 * Run it, open the live web-app dashboard, and you'll see the "123 Sandbox Test Ave" card.
 * Delete it from the dashboard (goes to Trash) when you're done — that also tests soft-delete.
 */
function testIntakeKeep() {
  const sample = {
    'Property Address': '123 Sandbox Test Ave, Testville, CA 90000',
    'Seller Name': 'Intake Test (delete me)', 'Phone': '(000) 000-1234', 'Lead Source': 'PPC',
    'Visit Date': Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
  };
  var res = webIntake_(sample);   // upserts if it already exists; row is NOT removed
  Logger.log('INTAKE (kept) RESULT: ' + JSON.stringify(res));
  SpreadsheetApp.getActive().toast(
    'Intake test (KEPT): ' + (res.ok ? 'PASS' : 'FAIL ' + res.error) + ' · ' + (res.id || '-') +
    ' · calendar: ' + (res.calendar || '-') +
    ' · Open the LIVE dashboard — you\'ll see "123 Sandbox Test Ave". Delete it there when done.', 'testIntakeKeep', 15);
}

/**
 * Simulate a REAL REI BlackBook task (the "Booked appointment" format), where the address +
 * appointment time live inside the task body. Proves the body parser. Keeps the row so you can
 * see it in the dashboard — delete it there when done. Sandbox only; nothing sent to anyone.
 */
function testReiTaskIntake() {
  var lead = {
    'Seller Name': 'Cyn Ku', 'Phone': '(510) 000-0000', 'Assigned Owner': 'Jonathan',
    'Lead Source': 'PPL - Property Leads',
    'Task Body': '<p>Lead: Cyn Ku</p>' +
      '<p>Booked appointment / visit scheduled: Friday, Jul 24, 11:00 AM</p>' +
      '<p>Property address: 2607 Gimelli Place #115, San Jose (Berryessa)</p>' +
      '<ul><li>Create a WhatsApp group</li><li>Add to calendar</li><li>Prepare document - contract</li></ul>'
  };
  var res = webIntake_(lead);
  Logger.log('REI TASK INTAKE: ' + JSON.stringify(res));
  SpreadsheetApp.getActive().toast(
    'REI task intake: ' + (res.ok ? 'PASS' : 'FAIL ' + res.error) + ' · ' + (res.id || '-') +
    ' · calendar: ' + (res.calendar || '-') +
    ' · Parsed address "2607 Gimelli Place #115" + visit Jul 24 from the task body. See it in the dashboard; delete when done.',
    'testReiTaskIntake', 15);
}

/* ---------------- Trash: soft delete + restore ---------------- */
function trashSheet_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(CFG.TRASH_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CFG.TRASH_SHEET);
    sh.setTabColor('#9aa0a6');
    sh.getRange(1, 1, 1, HEADERS.length + 2).setValues([['Deleted Date', 'Deleted By'].concat(HEADERS)])
      .setFontWeight('bold').setBackground('#eeeeee');
    sh.setFrozenRows(1);
  }
  return sh;
}
/** Move a Data row into the Trash sheet (full snapshot), then clear it in place. */
function softDelete_(sh, rowNum) {
  var vals = sh.getRange(rowNum, 1, 1, HEADERS.length).getValues()[0];
  if (!vals[col('Property Address') - 1]) return;      // empty row — nothing to trash
  var email = ''; try { email = Session.getActiveUser().getEmail() || ''; } catch (e) {}
  trashSheet_().appendRow([new Date(), email].concat(vals));
  deleteVisitEvents_(vals[col('Property Address') - 1], vals[col('Visit Date') - 1]);   // also remove its calendar event
  clearRecordRow_(sh, rowNum);
}
/** Restore a Trash row back into the first empty Data row (input columns; formulas recompute). */
function restoreFromTrash_(trashRow) {
  var t = trashSheet_();
  if (!trashRow || trashRow < 2 || trashRow > t.getLastRow()) return { ok: false, error: 'Trash entry not found' };
  var row = t.getRange(trashRow, 3, 1, HEADERS.length).getValues()[0];   // skip Deleted Date/By
  var sh = dataSheet_();
  ensureRows_(sh, CFG.MAX_ROWS);
  var addrs = sh.getRange(CFG.FIRST_DATA_ROW, col('Property Address'), CFG.MAX_ROWS - 1, 1).getValues();
  var dest = 0;
  for (var i = 0; i < addrs.length; i++) { if (String(addrs[i][0]).trim() === '') { dest = CFG.FIRST_DATA_ROW + i; break; } }
  if (!dest) return { ok: false, error: 'No empty rows to restore into' };
  var R = new RowAccessor_(sh, dest);
  HEADERS.forEach(function(h, j){ if (COMPUTED_HEADERS.indexOf(h) < 0 && row[j] !== '' && row[j] != null) R.set(h, row[j]); });
  R.flush();
  t.deleteRow(trashRow);
  var addr = row[col('Property Address') - 1];
  if (addr && row[col('Visit Date') - 1]) {   // put the calendar event back
    maybeCreateVisitEvent_({ 'Property Address': addr, 'Seller Name': row[col('Seller Name') - 1],
      'Phone': row[col('Phone') - 1], 'REI BlackBook Link': row[col('REI BlackBook Link') - 1],
      'Lead Source': row[col('Lead Source') - 1], 'Visit Date': row[col('Visit Date') - 1] }, addr);
  }
  SpreadsheetApp.flush();
  return { ok: true };
}
/** Compact list of trashed records for the dashboard's Trash view. */
function trashList_() {
  var t = trashSheet_();
  var last = t.getLastRow();
  var out = [];
  if (last >= 2) {
    var vals = t.getRange(2, 1, last - 1, HEADERS.length + 2).getValues();
    var pi = col('Property ID') + 1, si = col('Seller Name') + 1, ai = col('Property Address') + 1, ci = col('Current Stage') + 1;
    vals.forEach(function(v, i){
      if (!v[ai]) return;
      out.push({ trashRow: 2 + i, deletedDate: fmt_(v[0]), deletedBy: v[1] || '',
                 id: v[pi] || '', seller: v[si] || '', address: v[ai] || '', stage: v[ci] || '' });
    });
  }
  return out;
}

/* ---------------- the dashboard page (self-contained HTML) ---------------- */

function dashboardHtml_() {
  return [
'<!DOCTYPE html><html><head><base target="_top"><meta charset="utf-8">',
'<style>',
'*{box-sizing:border-box} body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#f4f6f9;color:#222}',
'header{background:#1f4e79;color:#fff;padding:12px 16px;position:sticky;top:0;z-index:5}',
'header h1{margin:0;font-size:17px} header .sub{font-size:12px;opacity:.85;margin-top:2px}',
'.bar{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px;background:#fff;border-bottom:1px solid #e2e6ea;position:sticky;top:52px;z-index:4}',
'.chip{border:1px solid #cdd6df;background:#fff;border-radius:16px;padding:5px 12px;font-size:12px;cursor:pointer}',
'.chip.on{background:#1f4e79;color:#fff;border-color:#1f4e79}',
'select{padding:5px 8px;border:1px solid #cdd6df;border-radius:8px;font-size:12px}',
'.wrap{padding:10px 12px 60px}',
'.sec{margin:14px 0 6px;font-size:13px;font-weight:bold;color:#1f4e79;display:flex;align-items:center;gap:8px}',
'.sec .n{background:#1f4e79;color:#fff;border-radius:10px;padding:0 8px;font-size:11px}',
'.card{background:#fff;border:1px solid #e2e6ea;border-left:4px solid #9aa7b4;border-radius:8px;padding:10px 12px;margin:8px 0;box-shadow:0 1px 2px rgba(0,0,0,.04)}',
'.card.overdue{border-left-color:#c0392b} .card.stalled{border-left-color:#e08e0b} .card.ok{border-left-color:#2e7d32} .card.exc{border-left-color:#c0392b}',
'.card .top{display:flex;justify-content:space-between;gap:8px} .card .seller{font-weight:bold;font-size:14px} .card .addr{font-size:12px;color:#555}',
'.stg{font-size:11px;background:#eef2f6;border-radius:10px;padding:2px 8px;white-space:nowrap}',
'.meta{font-size:12px;color:#444;margin-top:6px;display:flex;flex-wrap:wrap;gap:10px}',
'.meta b{color:#111} .due.od{color:#c0392b;font-weight:bold} .flag{color:#c0392b;font-size:11px;margin-top:4px}',
'.na{font-size:12px;margin-top:6px} .acts{margin-top:8px;display:flex;flex-wrap:wrap;gap:6px}',
'button.act{font-size:11px;border:1px solid #1f4e79;color:#1f4e79;background:#fff;border-radius:6px;padding:5px 9px;cursor:pointer}',
'button.act.p{background:#1f4e79;color:#fff} a.rei{font-size:11px;color:#1565c0;text-decoration:none;border:1px solid #90caf9;border-radius:6px;padding:5px 9px}',
'#toast{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);background:#222;color:#fff;padding:9px 14px;border-radius:8px;font-size:13px;display:none;z-index:20}',
'.empty{color:#8a97a3;font-size:12px;padding:4px 2px}',
'</style></head><body>',
'<header><h1>🏠 Twin Visit Logger</h1><div class="sub" id="sub">Loading…</div></header>',
'<div class="bar">',
'<span class="chip on" data-f="all" onclick="setFilter(this)">All</span>',
'<span class="chip" data-f="today" onclick="setFilter(this)">Due Today</span>',
'<span class="chip" data-f="overdue" onclick="setFilter(this)">Overdue</span>',
'<span class="chip" data-f="stalled" onclick="setFilter(this)">Stalled</span>',
'<select id="owner" onchange="draw()"><option value="">All owners</option></select>',
'<span class="chip" onclick="loadData()">↻ Refresh</span>',
'</div>',
'<div class="wrap" id="wrap"></div>',
'<div id="toast"></div>',
'<script>',
'var DATA=null, FILTER="all";',
'function toast(m){var t=document.getElementById("toast");t.textContent=m;t.style.display="block";setTimeout(function(){t.style.display="none";},2600);}',
'function setFilter(el){FILTER=el.getAttribute("data-f");var c=document.querySelectorAll(".bar .chip[data-f]");for(var i=0;i<c.length;i++)c[i].classList.remove("on");el.classList.add("on");draw();}',
'function loadData(){document.getElementById("sub").textContent="Loading…";google.script.run.withSuccessHandler(function(d){DATA=d;fillOwners();document.getElementById("sub").textContent=d.generatedAt+" · "+d.totalLive+" live records";draw();}).withFailureHandler(function(e){toast("Error: "+e.message);}).webGetData();}',
'function fillOwners(){var s=document.getElementById("owner");if(s.options.length>1)return;DATA.owners.forEach(function(o){var op=document.createElement("option");op.value=o;op.textContent=o;s.appendChild(op);});}',
'function todayStr(){var d=new Date();return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);}',
'function keep(r){var own=document.getElementById("owner").value;if(own&&r.owner!==own)return false;if(FILTER==="overdue")return r.daysOverdue>0;if(FILTER==="today")return r.due===todayStr();if(FILTER==="stalled")return r.stalled;return true;}',
'function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}',
'function actsFor(r){var a=[];',
'  if(r.visitStatus!=="Completed"&&r.stage==="Visit Scheduled")a.push(["visitCompleted","Mark visit completed",true]);',
'  if(r.stage==="Visit Completed — Needs Review"){a.push(["recordOfferSent","Record offer sent",true]);a.push(["nurture","Move to nurture",false]);}',
'  if(r.stage==="Offer Sent"){a.push(["logContact","Log follow-up",true]);a.push(["sellerCounter","Seller countered",false]);a.push(["contractSent","Contract sent",false]);}',
'  if(r.stage==="Active Negotiation"){a.push(["logContact","Log follow-up",true]);a.push(["contractSent","Contract sent",false]);}',
'  if(r.stage==="Verbal Agreement"||r.stage==="Contract Sent"){a.push(["contractSigned","Contract signed",true]);a.push(["logContact","Log follow-up",false]);}',
'  a.push(["setNextAction","Set next action",false]);',
'  return a;}',
'function card(r){var cls="card";if(r.daysOverdue>0)cls+=" overdue";else if(r.stalled)cls+=" stalled";else if(r.dq==="Exception"||r.dq==="Incomplete")cls+=" exc";else if(r.stage==="Contract Signed")cls+=" ok";',
'  var h="<div class=\\""+cls+"\\">";',
'  h+="<div class=\\"top\\"><div><div class=\\"seller\\">"+esc(r.seller)+"</div><div class=\\"addr\\">"+esc(r.address)+"</div></div><div class=\\"stg\\">"+esc(r.stage)+"</div></div>";',
'  h+="<div class=\\"meta\\"><span>👤 <b>"+esc(r.owner||"—")+"</b></span>";',
'  h+="<span class=\\"due"+(r.daysOverdue>0?" od":"")+"\\">📅 "+esc(r.due||"—")+(r.daysOverdue>0?(" ("+r.daysOverdue+"d over)"):"")+"</span>";',
'  if(r.blocker)h+="<span>⛔ "+esc(r.blocker)+"</span>";if(r.stalled)h+="<span>🟠 stalled</span>";',
'  h+="</div>";',
'  if(r.nextAction)h+="<div class=\\"na\\">➡ "+esc(r.nextAction)+"</div>";',
'  if(r.lastResult)h+="<div class=\\"na\\" style=\\"color:#666\\">🗒 "+esc(r.lastResult)+"</div>";',
'  if(r.missing||r.exceptionReason)h+="<div class=\\"flag\\">⚠ "+esc(r.exceptionReason||("Missing: "+r.missing))+"</div>";',
'  h+="<div class=\\"acts\\">";',
'  if(r.rei)h+="<a class=\\"rei\\" href=\\""+esc(r.rei)+"\\" target=\\"_blank\\">REI ↗</a>";',
'  actsFor(r).forEach(function(a){h+="<button class=\\"act"+(a[2]?" p":"")+"\\" onclick=\\"doAct(\\x27"+a[0]+"\\x27,\\x27"+esc(r.id)+"\\x27)\\">"+a[1]+"</button>";});',
'  h+="</div></div>";return h;}',
'function draw(){if(!DATA)return;var w=document.getElementById("wrap");var html="";DATA.sections.forEach(function(s){var rows=s.rows.filter(keep);if(!rows.length&&FILTER!=="all")return;html+="<div class=\\"sec\\">"+esc(s.title)+"<span class=\\"n\\">"+rows.length+"</span></div>";if(!rows.length){html+="<div class=\\"empty\\">— none —</div>";}else{rows.forEach(function(r){html+=card(r);});}});w.innerHTML=html;}',
'function doAct(action,id){var p={};',
'  if(action==="recordOfferSent"){p.amount=prompt("Approved offer amount (numbers only):");if(p.amount===null)return;p.date=prompt("Offer sent date (YYYY-MM-DD):",todayStr());if(p.date===null)return;}',
'  else if(action==="sellerCounter"){p.amount=prompt("Counteroffer amount (numbers only):");if(p.amount===null)return;p.result=prompt("What did the seller say? (Last Contact Result):","");}',
'  else if(action==="contractSent"){p.date=prompt("Contract sent date (YYYY-MM-DD):",todayStr());if(p.date===null)return;}',
'  else if(action==="contractSigned"){p.date=prompt("Contract signed date (YYYY-MM-DD):",todayStr());if(p.date===null)return;}',
'  else if(action==="logContact"){p.result=prompt("Result of contact:","");if(p.result===null)return;p.nextAction=prompt("Next action:","");p.due=prompt("Next action due date (YYYY-MM-DD):",todayStr());}',
'  else if(action==="nurture"){p.due=prompt("Future follow-up date (YYYY-MM-DD):","");if(!p.due)return;p.nextAction=prompt("Next action:","Nurture check-in");}',
'  else if(action==="setNextAction"){p.nextAction=prompt("Next action:","");if(p.nextAction===null)return;p.due=prompt("Due date (YYYY-MM-DD):",todayStr());p.owner=prompt("Assigned owner (Jonathan/Kyle/Cherry/Juan), blank=keep:","");}',
'  toast("Saving…");google.script.run.withSuccessHandler(function(res){if(res&&res.ok){DATA=res.data;draw();toast("Saved ✔");}else{toast("Error: "+(res&&res.error));}}).withFailureHandler(function(e){toast("Error: "+e.message);}).webAction(action,id,p);}',
'loadData();',
'</script></body></html>'
  ].join('\n');
}
