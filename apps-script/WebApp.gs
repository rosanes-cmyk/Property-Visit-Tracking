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
    /*
     * Read the WHOLE width and map values by column NAME.
     *
     * This read HEADERS.length columns and zipped them onto HEADERS by position. The live tab has 74
     * columns against the 72 declared, and is shifted by one from 'REI BlackBook Link' onward, so every
     * field from there on took its neighbour's value — visitDate got the REI link, visitStatus got the
     * date — and the last two columns were never read at all. Two real visits sat in the sheet and could
     * not be found on the board.
     *
     * A name lookup is immune to that: an unexpected extra column is ignored, a heading this code does
     * not know about is ignored, and a declared column the sheet does not have yet reads as blank
     * instead of silently borrowing the cell next to it.
     */
    const idx = headerIndex_();
    const width = Math.max(sh.getLastColumn(), HEADERS.length);
    const vals = sh.getRange(CFG.FIRST_DATA_ROW, 1, last - CFG.FIRST_DATA_ROW + 1, width).getValues();
    vals.forEach(function(v, i){
      const rec = {};
      HEADERS.forEach(function(h){ const c = idx[h]; rec[h] = c ? v[c - 1] : ''; });
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
        /*
         * Sent so the board can show how long a parked row has been waiting, and say something honest
         * once that becomes unreasonable. An ISO string rather than a formatted date: the page does
         * arithmetic with it, and "08/08/2026" cannot be subtracted from anything.
         */
        created: rec['Created Date'] instanceof Date ? rec['Created Date'].toISOString() : '',
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
  // Sent so the booking form offers exactly what the sheet accepts — an illegal value fails the row write.
  const visitors = DROPDOWNS['Assigned Visitor'];
  var email = ''; try { email = Session.getActiveUser().getEmail() || ''; } catch (e) {}
  return { generatedAt: fmt_(today_()), owners: owners, visitors: visitors,
    bookingOwners: bookingList_(BOOKING_OWNERS, owners),
    bookingVisitors: bookingList_(BOOKING_VISITORS, visitors),
    leadSources: DROPDOWNS['Lead Source'],
    /*
     * Visit Status and Current Stage are sent for the same reason Lead Source is, and were not.
     *
     * The booking form kept its own copies of these two, so the sheet could never correct them — and it had
     * drifted: the workbook accepts five visit statuses and the form offered four. 'Skipped — Offer Made' was
     * simply unreachable from the dashboard, permanently, with nothing to reveal it. That is worse than the
     * MLS gap, which at least came right once the page loaded.
     *
     * Every list the form can write is now sent from DROPDOWNS, which is the same list data validation is
     * built from — so the form offers exactly what the sheet accepts, and an added value reaches both at once.
     */
    visitStatuses: DROPDOWNS['Visit Status'],
    stages: DROPDOWNS['Current Stage'],
    sections: sections, records: rows, trash: trashList_(), userEmail: email, totalLive: rows.length };
}

/* ---------------- server: safe write actions ---------------- */

/**
 * The sheet row a dashboard action refers to. 0 = not found, and the caller must not write.
 *
 * Two things this now refuses to do, both of which it used to do silently:
 *
 *   A BLANK identifier no longer matches anything. Property ID is empty on every imported row, so
 *   String(ids[i][0]) === String('') matched the FIRST blank-ID row — and a Save or Delete aimed at one
 *   record landed on another. A blank id is a bug in the caller, so it returns 0 rather than guessing.
 *
 *   A ROW NUMBER is accepted directly. The dashboard now sends rowNum, which comes from the sheet and
 *   is always unique, instead of a Property ID that may not exist. A plain integer inside the data
 *   range is treated as that row; anything else still falls back to matching Property ID, so an older
 *   deployment of the page keeps working.
 */
function findRowById_(id) {
  const sh = dataSheet_();
  const last = sh.getLastRow();
  if (last < CFG.FIRST_DATA_ROW) return 0;

  const raw = String(id == null ? '' : id).trim();
  if (!raw) return 0;                                    // never guess from a blank identifier

  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n >= CFG.FIRST_DATA_ROW && n <= last) return n;   // it is a row number
  }

  const ids = sh.getRange(CFG.FIRST_DATA_ROW, col('Property ID'), last - CFG.FIRST_DATA_ROW + 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    const v = String(ids[i][0]).trim();
    if (v && v === raw) return CFG.FIRST_DATA_ROW + i;     // a blank cell can never be the match
  }
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
/*
 * How a row that still needs its address from REI is marked.
 *
 * Read by scripts/fill-pending-rei.mjs on the PC, which is the half of this that CAN open REI. Change it
 * in both places or rows will sit here forever looking like finished records with an odd address.
 */
/*
 * Who the BOOKING FORM offers — a curated shortlist, not the workbook's whole validation list.
 *
 * The client, on the Book / reschedule form: "for visitior should only juan an cesar only; for assigneg
 * owener should thea, cherry, genesis."
 *
 * Two different lists on purpose. DROPDOWNS above is what the SHEET accepts, and it has to stay long —
 * dozens of existing rows hold Kyle, Matt, Arly and the rest, and a value outside the validation fails the
 * whole row write. These are what a person is offered when booking today, so the common case is two taps
 * instead of scrolling past people who left.
 *
 * Filtered against DROPDOWNS before being sent, so a name added here and forgotten there cannot reach the
 * form and produce a row write that throws.
 */
var BOOKING_OWNERS = ['Thea', 'Cherry', 'Genesis'];
var BOOKING_VISITORS = ['Juan', 'Cesar'];

function bookingList_(wanted, allowed) {
  return wanted.filter(function (name) { return allowed.indexOf(name) >= 0; });
}

/*
 * How a row that still needs its details from REI is marked.
 *
 * Read by scripts/fill-pending-rei.mjs on the PC, which is the half of this that CAN open REI. Change it
 * in both places or rows will sit here forever looking like finished records with an odd address.
 */
var PENDING_REI_PREFIX = 'PENDING REI LOOKUP —';

/** Last ten digits, so (650) 620-4017 and 6506204017 are the same number. */
function phoneKey_(value) {
  var digits = String(value == null ? '' : value).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

/**
 * Find the row this booking already belongs to, if any.
 *
 * Returns { row, reason, ambiguous }. `ambiguous` means the phone matched more than one record — a
 * seller with two properties has one number and two rows — and in that case NOTHING is edited. Guessing
 * which property to reschedule silently moves the wrong visit; a duplicate card somebody merges by hand
 * is the recoverable mistake of the two.
 *
 * Order matters: a REI link is an identity, a phone is a strong hint, an address is a last resort.
 */
function findRowForBooking_(params) {
  var sh = dataSheet_();
  var last = sh.getLastRow();
  if (last < CFG.FIRST_DATA_ROW) return { row: 0, reason: 'the tab is empty' };
  var n = last - CFG.FIRST_DATA_ROW + 1;

  var link = String(params['REI BlackBook Link'] || '').trim();
  if (link) {
    var links = sh.getRange(CFG.FIRST_DATA_ROW, col('REI BlackBook Link'), n, 1).getValues();
    for (var i = 0; i < links.length; i++) {
      if (String(links[i][0]).trim() === link) {
        return { row: CFG.FIRST_DATA_ROW + i, reason: 'same REI link' };
      }
    }
  }

  var wanted = phoneKey_(params['Phone']);
  if (wanted) {
    var phones = sh.getRange(CFG.FIRST_DATA_ROW, col('Phone'), n, 1).getValues();
    var stages = sh.getRange(CFG.FIRST_DATA_ROW, col('Current Stage'), n, 1).getValues();
    var hits = [];
    for (var p = 0; p < phones.length; p++) {
      if (phoneKey_(phones[p][0]) !== wanted) continue;
      /*
       * A closed-out lead does not count as "already there". The same seller coming back months later
       * is a NEW opportunity, and reviving the dead row would bury why it was closed.
       */
      if (String(stages[p][0]).trim() === 'Lost / Closed Out') continue;
      hits.push(CFG.FIRST_DATA_ROW + p);
    }
    if (hits.length === 1) return { row: hits[0], reason: 'same phone number' };
    if (hits.length > 1) {
      return { row: 0, ambiguous: true,
        reason: hits.length + ' records share that phone — rows ' + hits.join(', ') };
    }
  }

  var addr = String(params['Property Address'] || '').trim().toLowerCase();
  if (addr) {
    var addrs = sh.getRange(CFG.FIRST_DATA_ROW, col('Property Address'), n, 1).getValues();
    for (var a = 0; a < addrs.length; a++) {
      if (String(addrs[a][0]).trim().toLowerCase() === addr) {
        return { row: CFG.FIRST_DATA_ROW + a, reason: 'same address' };
      }
    }
  }
  return { row: 0, reason: 'no existing record' };
}

/*
 * Stages at or before a visit. Rescheduling may set Current Stage back to "Visit Scheduled" only from
 * one of these — a lead at Offer Sent that gets another visit booked stays at Offer Sent, because the
 * offer is further on than the visit and the board must not claim otherwise.
 */
var STAGES_BEFORE_OFFER = ['', 'Visit Scheduled', 'Visit Completed — Needs Review'];

/**
 * Reschedule an existing record rather than creating a second card for the same lead.
 *
 * The client, on being shown that Add always appended: "no, just edit that tab instead, edit property,
 * since that is already [there]." Right — and creating duplicates would have broken the rule this
 * project holds everywhere else, while double-counting the lead in every number at the top of the board.
 */
/**
 * A Visit Time the sheet will DISPLAY as a time.
 *
 * Sheets stores a time-only value as a fraction of a day on its 1899-12-30 epoch. Write a Date into the
 * cell and, if that column happens to carry a date format, it shows "12/30/1899" — the epoch day, with the
 * clock nowhere on screen. The client saw exactly that on a new booking, and it is the same epoch that
 * once printed "Sat Dec 30 1899" on a Chat card.
 *
 * Worse than ugly: the office PC reads DISPLAY values, so what reached it was the literal text
 * "12/30/1899" with no time in it at all. It could not build an appointment from that, so the calendar
 * event was refused and the whole row failed — for a booking whose address REI had answered perfectly.
 *
 * Storing the clock as TEXT is what a person typing on the form produces anyway, so this makes the
 * automated path match the manual one instead of quietly diverging from it. timeCell_ already handles the
 * three shapes a time arrives in (a Date, a day-fraction, or typed text) and hands back "2:00 PM".
 *
 * Anything it cannot read is passed through untouched rather than blanked — a value nobody can parse is
 * still somebody's data, and losing it would be worse than displaying it oddly.
 */
function timeValue_(v) {
  if (v === '' || v == null) return v;
  try {
    if (typeof timeCell_ === 'function') {
      var s = timeCell_(v);
      if (s) return s;
    }
  } catch (e) { /* fall through to the raw value */ }
  return v;
}

function webRescheduleRow_(row, params) {
  var sh = dataSheet_();
  var R = new RowAccessor_(sh, row);
  var changed = [];

  ['Visit Date', 'Visit Time', 'Visit Status', 'Assigned Visitor', 'Assigned Owner',
    'Lead Source', 'Next Action', 'Next Action Due Date', 'REI BlackBook Link', 'Phone'
  ].forEach(function (h) {
    if (params[h] === undefined || params[h] === '') return;
    var value = h === 'Visit Time' ? timeValue_(params[h])
      : h.indexOf('Date') >= 0 ? new Date(params[h])
      : params[h];
    var before = R.get(h);
    R.set(h, value);
    if (String(before) !== String(value)) changed.push(h);
  });

  var stage = String(R.get('Current Stage') || '').trim();
  if (STAGES_BEFORE_OFFER.indexOf(stage) >= 0 && String(params['Visit Status'] || '') === 'Scheduled') {
    if (stage !== 'Visit Scheduled') { R.set('Current Stage', 'Visit Scheduled'); changed.push('Current Stage'); }
  }

  stamp_(R);
  R.flush();
  /*
   * Through runHandler_, exactly as webAction does — and NOT `onVisitStatus_(new RowAccessor_(sh, row))`,
   * which is what stood here and was broken twice over.
   *
   * THE CALENDAR NEVER MOVED. This is the Book / reschedule form: a colleague changes the date, the board
   * shows the new date, and Juan's calendar still holds the old slot. Nothing in this function called
   * syncVisitCalendar_, and no onEdit fires for a dashboard write, so there was no path by which the event
   * could follow the row. Reported by the client as "reschedule is not working", which it was not.
   *
   * AND THE HANDLER'S WRITES WERE THROWN AWAY. onVisitStatus_ sets Current Stage, Next Action and
   * Next Action Due Date on the accessor it is given — and that accessor, created inline here, was never
   * flushed. Every one of those writes was discarded. So a reschedule also silently skipped the stage
   * cascade and the visitor's Task Queue reminder kept whatever the row had before.
   *
   * runHandler_ is the piece that gets both right: handler(R), then R.flush(), then syncVisitCalendar_.
   * The else branch matters just as much — a plain date change sends no Visit Status at all, and that is
   * the commonest reschedule there is.
   */
  if (params['Visit Status']) runHandler_(onVisitStatus_, sh, row);
  else syncVisitCalendar_(sh, row);
  SpreadsheetApp.flush();
  return { ok: true, updated: true, row: row, changed: changed,
    id: R.get('Property ID'), seller: R.get('Seller Name'), data: webGetData() };
}

function webAddRecord_(params) {
  /*
   * One booking at a time, across the whole script.
   *
   * findRowForBooking_ below is a READ, and the write that follows it is a separate call. Two people — or
   * one person whose second click lands before the first has finished — run both halves interleaved: each
   * looks, each finds nothing, each writes. The board then shows the client's own screenshot: two
   * identical Bryan Dodge cards, same number, same date, six seconds apart. The de-duplication was there
   * and correct; it was simply asking a question whose answer went stale before it was used.
   *
   * A script lock is the whole fix. Thirty seconds is generous for a look-then-write on one row and short
   * enough that a colleague who really is waiting behind somebody gets an answer rather than a hang; if it
   * cannot be had, the booking is refused with something a person can act on, because a refusal they can
   * retry beats a duplicate they have to find and merge.
   */
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { ok: false, error: 'Somebody else is saving a booking right now. Try again in a few seconds — '
      + 'nothing was saved, so nothing is duplicated.' };
  }
  try {
    return webAddRecordLocked_(params);
  } finally {
    lock.releaseLock();
  }
}

function webAddRecordLocked_(params) {
  /*
   * Look before writing. An existing lead is RESCHEDULED, never duplicated.
   *
   * Without this, a colleague rebooking Sara produced a second Sara: two cards on the board, and every
   * count at the top of the page — SLA breach, Overdue, Need decision — quietly wrong by one.
   */
  const found = findRowForBooking_(params);
  if (found.row) return webRescheduleRow_(found.row, params);

  const sh = dataSheet_();
  ensureRows_(sh, CFG.MAX_ROWS);
  var row = 0;
  const addrs = sh.getRange(CFG.FIRST_DATA_ROW, col('Property Address'), CFG.MAX_ROWS - 1, 1).getValues();
  for (var i = 0; i < addrs.length; i++) { if (String(addrs[i][0]).trim() === '') { row = CFG.FIRST_DATA_ROW + i; break; } }
  if (!row) return { ok: false, error: 'No empty rows available (increase MAX_ROWS).' };
  /*
   * An address, OR something the PC can look the address up WITH.
   *
   * The client's ask: "instead of waiting in the email... just add the number and then the name of the
   * seller and date and it will do automatic." A colleague booking a visit has the phone in front of
   * them; the address is the thing they would have to go into REI to fetch, which is the errand this is
   * meant to remove.
   *
   * Apps Script cannot read REI — no browser — so the row is parked with a placeholder and the PC fills
   * it in on its next pass. The placeholder is NOT cosmetic: this function finds the next free row by
   * looking for a blank Property Address, so a genuinely blank one would be handed out again to the next
   * person who clicked Add, and their record would overwrite this one.
   */
  if (!params['Property Address']) {
    var lookupKey = String(params['Phone'] || params['REI BlackBook Link'] || '').trim();
    if (!lookupKey) {
      return { ok: false, error: 'A phone number is needed — it is what REI is searched by.' };
    }
    params['Property Address'] = PENDING_REI_PREFIX + ' ' + lookupKey;
    // Flagged, so it is visibly unfinished on the board rather than looking like a complete record.
    if (params['Data Quality Status'] === undefined) params['Data Quality Status'] = 'Incomplete';
    if (params['Exception Reason'] === undefined) {
      /*
       * The timestamp goes in the TEXT, deliberately.
       *
       * Created Date and Last Updated Date are both written by today_(), which is midnight — a date with
       * no clock on it. The board's "waiting for…" counter read one of those and showed 1009m 16s, which
       * is minutes since midnight, not since the row was made. Rather than change what those two columns
       * mean (formulas, the daily report and the legacy import all depend on them being dates), the
       * moment is carried here as an ISO instant the page can subtract.
       */
      params['Exception Reason'] = (found.ambiguous
        ? ('POSSIBLE DUPLICATE — ' + found.reason + '. Added as a new record rather than guessing which '
           + 'one to reschedule; merge them by hand if this is the same property.')
        : 'Waiting for the PC to read REI and fill in the address and details.')
        + ' [since ' + new Date().toISOString() + ']';
    }
  }
  /*
   * Next Action and its due date are filled HERE, not typed on the form.
   *
   * The client: "remove next action tab due date tab." Fair — for a visit that is being booked, both were
   * always the same two values, and a form that asks for what it already knows is a form people rush.
   *
   * They cannot simply be left empty. Next Action is one of the fields Missing Required Fields checks, so a
   * blank one flags the row on the dashboard and puts it on the work queue as incomplete — the booking
   * would arrive already looking broken. The due date follows the visit, because that is when the action is
   * actually due.
   */
  if (!params['Next Action']) params['Next Action'] = 'Conduct scheduled visit & log outcome';
  if (!params['Next Action Due Date']) {
    params['Next Action Due Date'] = params['Visit Date'] || fmt_(today_());
  }

  const R = new RowAccessor_(sh, row);
  const map = ['Property Address','Seller Name','Phone','Email','Lead Source','Visit Date','Visit Time',
    'Visit Status','Assigned Visitor','Visit Notes','Seller Motivation','Current Stage','Assigned Owner',
    'Next Action','Next Action Due Date','REI BlackBook Link','Data Quality Status','Exception Reason'];
  map.forEach(function(h){
    if (params[h] === undefined || params[h] === '') return;
    if (h === 'Visit Time') R.set(h, timeValue_(params[h]));
    else if (h.indexOf('Date') >= 0) R.set(h, new Date(params[h]));
    else R.set(h, params[h]);
  });
  R.set('Property ID', nextPropertyId_());
  R.set('Source', 'Manual');
  R.set('Created Date', today_());
  stamp_(R);
  R.flush();
  if (params['Visit Status']) onVisitStatus_(new RowAccessor_(sh, row));
  SpreadsheetApp.flush();
  return { ok: true, created: true, ambiguous: Boolean(found.ambiguous), pending: true,
    data: webGetData(), newId: R.get('Property ID') };
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
        stamp_(R); R.flush();
        /*
         * Run the SAME automation a sheet edit would.
         *
         * This only wrote the cells and synced the calendar, so editing Visit Status through the
         * full-record form gave a different result from typing it in the sheet or from pressing the
         * "Mark visit completed" button — the stage cascade and the log line were skipped. One field,
         * three doors, three outcomes. runHandler_ syncs the calendar itself, so it is not called twice.
         */
        if (params['Visit Status'] !== undefined) runHandler_(onVisitStatus_, sh, rowNum);
        else if (params['Current Stage'] !== undefined) runHandler_(onStageManual_, sh, rowNum);
        else syncVisitCalendar_(sh, rowNum);
        break;
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
    /*
     * A CANCELLED visit KEEPS its calendar event, tagged.
     *
     * This used to delete it. Cherry's rule: "if the status of the calendar is cancelled it should not
     * be removed in the calendar and this will notify as well". She is right — a visit vanishing off
     * Juan's day is indistinguishable from it never having been booked, so nobody learns that a seller
     * cancelled, and there is no record that the slot was ever held. The event stays, its title carries
     * the tag, its reminders are stripped so it cannot ping anyone, and the reason is written into the
     * description. A Chat alert goes out the first time it is tagged.
     *
     * "Reschedule Needed" gets its own tag rather than sharing the cancelled one: the slot is dead but
     * the lead is not, and those are different things to see on a calendar.
     *
     * The no-visit-date case still removes the event, because there is no date left for it to sit on.
     */
    var tag = status === 'Canceled' ? 'CANCELED'
      : status === 'Reschedule Needed' ? 'RESCHEDULE NEEDED'
        : stage === 'Lost / Closed Out' ? 'CLOSED OUT' : '';

    if (tag) {
      var marked = markVisitEvents_(addr, visitDate, tag, String(R.get('Updated By') || ''));
      logAuto_('CALENDAR', R.get('Property ID'), 'Visit event tagged ' + tag + ' (kept on the calendar) · ' + marked.detail);

      /*
       * Alert on the CANCELLATION, not on the tagging.
       *
       * This fired only when an event had just been tagged — so a lead with no calendar event produced
       * no alert and no visible sign of anything at all. That is most cancelled leads: the old
       * behaviour DELETED the event on cancel, and maybeCreateVisitEvent_ refuses to create one for a
       * past date, so a visit cancelled after its date has no event to tag. The client cancelled a
       * visit, nothing happened anywhere, and there was no way to tell why.
       *
       * A seller cancelling is news whether or not a calendar entry survived, so the alert now depends
       * on the row, and the once-only marker moved from the event title to a note on the row itself.
       * The tag is stored, not just a flag, so Canceled after Reschedule Needed alerts again — those
       * are different pieces of news.
       */
      if (R.getNote('cancelAlert') !== tag) {
        notifyVisitTagged_(R, tag, visitDate, marked);
        R.setNote('cancelAlert', tag);
      }
      return marked.detail;
    }

    // Re-booked: forget the alert marker, so if it is cancelled again that is fresh news.
    if (R.getNote('cancelAlert')) R.setNote('cancelAlert', '');

    if (!visitDate) {
      var removed = deleteVisitEvents_(addr, visitDate);
      logAuto_('CALENDAR', R.get('Property ID'), 'Visit event removed (no visit date) · ' + removed);
      return removed;
    }
    // Re-point the event at the current date: drop any stale copy, then create it fresh.
    deleteVisitEvents_(addr, null);
    var res = maybeCreateVisitEvent_({
      'Property Address': addr, 'Seller Name': R.get('Seller Name'), 'Phone': R.get('Phone'),
      'REI BlackBook Link': R.get('REI BlackBook Link'), 'Lead Source': R.get('Lead Source'),
      'Visit Date': visitDate, 'Visit Time': R.get('Visit Time')
    }, addr, R.row);
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

/**
 * Resolve the calendar that visit events go on.
 *
 * NOT sandbox-gated, whatever this comment used to claim. CFG.SANDBOX only decides the Source label
 * written on the row ('Intake-Sandbox' vs 'Intake'); events are created either way, and the only
 * switch that stops them is clearing VISIT_CALENDAR_NAME and VISIT_CALENDAR_ID. Anyone reading the
 * old line would have concluded a sandbox run could not touch a real calendar, which is the wrong
 * way round for a mistake to point.
 */
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
/**
 * Remember the event this script just created or reused, so the two producers stop being blind to
 * each other. Returns a short phrase for the caller's log line; never throws.
 *
 * Writes ONLY when the live header row actually holds the column. The declared position in HEADERS is
 * deliberately not trusted here: if the column is missing from the sheet, col() would fall back to the
 * declared index and we would write an event ID into whatever column happens to occupy it. The Node
 * writer already refuses to write an absent header for exactly that reason (src/google/sheets.mjs), and
 * a silent no-op that says so in the log beats a value in the wrong column.
 *
 * The '@google.com' suffix is stripped. Apps Script's getId() returns '<id>@google.com', but the Node
 * side stores the bare API id (response.data.id) and calls events.get({ eventId }) with it, which the
 * API rejects when the suffix is present. Storing the bare id is what makes the column mean the same
 * thing to both systems rather than merely being populated by both.
 */
function storeEventId_(rowNum, eventId) {
  if (!rowNum || !eventId) return '';
  var c = headerIndex_()['Calendar Event ID'];
  if (!c) return ' · event ID not stored (no "Calendar Event ID" column on the Data tab)';
  try {
    dataSheet_().getRange(rowNum, c).setValue(String(eventId).replace(/@google\.com$/i, ''));
    return ' · event ID stored';
  } catch (e) { return ' · event ID not stored (' + e + ')'; }
}

/**
 * Create the visit's calendar event — at the time it was booked for, and only if one is not there already.
 *
 * Two faults this fixes, both found while reviewing whether an automated booking path could safely write
 * here. Neither showed up as an error; both produced a confidently wrong calendar.
 *
 *   TIME. The start was hard-coded to 09:00 and Visit Time was never read, so a visit booked for 2pm went
 *   on the calendar at 9am. The row, the dashboard and the Chat cards all carried the right time — only the
 *   calendar did not. visitStartsAt_ is reused rather than re-deriving the parse: it already combines date
 *   and time for the 4pm card and already handles all three shapes the cell arrives in (a Date, a Sheets
 *   day-fraction, or typed text like "2:00 PM"). One parser, one set of edge cases. 09:00 remains the
 *   fallback when there is genuinely no time on the row, which is the case it was written for.
 *
 *   DUPLICATES. createEvent was called unconditionally and no event ID was stored, so the same lead written
 *   twice produced ONE row and TWO events — the row upsert protected the sheet and nothing protected the
 *   calendar. findVisitEvents_ is consulted first; it already matches the office-PC scraper's
 *   "Property Visit | seller | addr" titles as well as this script's own, so the check spans both producers.
 *
 * A reschedule MOVES the event it finds instead of adding a second one, per the project rule that a
 * reschedule must update the same event.
 *
 * An event already tagged [CANCELED] / [RESCHEDULE NEEDED] is never reused and never moved. Those are the
 * record of a visit that was called off, kept on their original date at the client's instruction, and
 * quietly repurposing one would erase that. A genuinely new booking at the same address gets its own live
 * event alongside it.
 *
 * rowNum is optional: pass it and the event ID is written back to the row (see storeEventId_).
 */
function maybeCreateVisitEvent_(map, addr, rowNum) {
  if (!CFG.VISIT_CALENDAR_ID && !CFG.VISIT_CALENDAR_NAME) return 'skipped (no calendar configured)';
  try {
    const cal = visitCalendar_();
    if (!cal) return 'calendar not found / not shared';
    if (!map['Visit Date']) return 'no visit date — event skipped';

    /*
     * A parked row has no address yet, only 'PENDING REI LOOKUP — (phone)' standing in for one.
     *
     * Without this guard an event appears on Juan's calendar titled 'Property Visit - PENDING REI
     * LOOKUP — (415) 770-8107', with that string as its location, and the drive-time lookup tries to
     * route to it. The rule is already the project's: do not create a Calendar event without a valid
     * appointment start AND a property address — and a placeholder is not an address.
     *
     * It sits at the single choke point on purpose, so it also covers a person editing Visit Date on a
     * parked row in the sheet, which fires syncVisitCalendar_ and had exactly this fault today. The
     * event is created on the PC's pass, once the real address is known.
     */
    if (typeof PENDING_REI_PREFIX === 'string' &&
        String(addr || '').indexOf(PENDING_REI_PREFIX) === 0) {
      return 'address not known yet (parked for REI lookup) — event skipped until the PC fills it in';
    }

    const day = new Date(map['Visit Date']);
    var start = (typeof visitStartsAt_ === 'function') ? visitStartsAt_(map, day) : null;
    const timed = !!start;
    if (!start) { start = new Date(day.getTime()); start.setHours(9, 0, 0, 0); }   // no time on the row

    // History never reaches the calendar. The 379 imported legacy records carry visit dates going
    // back to 2023; putting those on Juan's calendar would bury the visits that have not happened
    // yet. This is the single choke point every caller goes through, so the rule holds for the
    // import, the dashboard actions, "Fix mismatched stages", and the REI intake alike.
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    if (start < midnight) return 'visit date is in the past — event skipped (history stays off the calendar)';

    const end = new Date(start.getTime() + 60 * 60000);
    const clock = timed
      ? Utilities.formatDate(start, Session.getScriptTimeZone(), 'h:mm a')
      : '9:00 AM (no Visit Time on the row)';

    // Reuse before create. A tagged event is history, not a slot to move.
    const live = findVisitEvents_(cal, addr, start).filter(function (e) {
      return !/^\[[A-Z ]+\]/.test(String(e.getTitle() || ''));
    });
    if (live.length) {
      const ev0 = live[0];
      var moved = '';
      // A minute of slack: a reused event is not worth rewriting over sub-minute drift.
      if (Math.abs(ev0.getStartTime().getTime() - start.getTime()) > 60000) {
        ev0.setTime(start, end);
        moved = ', moved to ' + clock;
      }
      return 'event already on the calendar — reused' + moved +
        (live.length > 1 ? ' (' + live.length + ' matched; the extras predate this check)' : '') +
        storeEventId_(rowNum, ev0.getId());
    }

    const desc = 'Seller: ' + (map['Seller Name'] || '') + '\nPhone: ' + (map['Phone'] || '') +
                 '\nREI: ' + (map['REI BlackBook Link'] || '') + '\nLead source: ' + (map['Lead Source'] || '');
    const ev = cal.createEvent('Property Visit - ' + addr, start, end, { description: desc, location: addr });
    const mins = driveMinutes_(addr);
    ev.removeAllReminders();
    if (mins) ev.addPopupReminder(mins);   // "leave office by" — mins before start (never shifts the event itself)
    ev.addPopupReminder(30);
    return 'event created at ' + clock + ' (' + (mins ? mins + 'm drive reminder' : '30m only') + ')' +
      storeEventId_(rowNum, ev.getId());
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
    var evs = findVisitEvents_(cal, addr, visitDate);
    evs.forEach(function (e) { e.deleteEvent(); });
    return evs.length ? ('removed ' + evs.length + ' event(s)') : 'no matching event';
  } catch (e) { return 'error: ' + e; }
}

/**
 * Tag the visit's calendar event instead of deleting it, and keep it on the calendar.
 *
 * Returns { count, newlyTagged, detail }. newlyTagged is false when the tag was already on the title,
 * which is what stops the same cancellation being announced again on every later dashboard write.
 *
 * What it does to the event:
 *   - prefixes the title with "[TAG] " so it reads as cancelled at a glance in the calendar grid
 *   - removes every reminder, so a cancelled visit cannot ping anyone to leave the office
 *   - appends one dated line to the description, so the record of WHEN it was cancelled survives
 * It never moves the event and never changes its date: the slot that was held stays visible.
 */
function markVisitEvents_(addr, visitDate, tag, by) {
  if ((!CFG.VISIT_CALENDAR_ID && !CFG.VISIT_CALENDAR_NAME) || !addr) return { count: 0, newlyTagged: false, detail: 'no calendar / address' };
  try {
    var cal = visitCalendar_();
    if (!cal) return { count: 0, newlyTagged: false, detail: 'calendar not found' };
    var evs = findVisitEvents_(cal, addr, visitDate);
    if (!evs.length) return { count: 0, newlyTagged: false, detail: 'no matching event' };

    var prefix = '[' + tag + '] ';
    var count = 0, fresh = 0;
    evs.forEach(function (e) {
      var t = e.getTitle() || '';
      count++;
      if (t.indexOf(prefix) === 0) return;                 // already tagged — leave it entirely alone
      // Strip any OTHER tag first, so a reschedule that later cancels does not read "[CANCELED] [RESCHEDULE NEEDED] …"
      e.setTitle(prefix + t.replace(/^\[[A-Z ]+\]\s*/, ''));
      e.removeAllReminders();
      var stamp = tag + ' on ' + fmt_(today_()) + (by ? ' by ' + by : '') + ' — kept for the record.';
      var desc = e.getDescription() || '';
      if (desc.indexOf(stamp) < 0) e.setDescription((desc ? desc + '\n\n' : '') + stamp);
      fresh++;
    });
    return {
      count: count,
      newlyTagged: fresh > 0,
      detail: fresh ? ('tagged ' + fresh + ' event(s)') : ('already tagged (' + count + ')')
    };
  } catch (e) { return { count: 0, newlyTagged: false, detail: 'error: ' + e }; }
}

/**
 * Every calendar event that belongs to this property visit.
 *
 * Shared by the delete and the tag paths so they can never disagree about which events are ours — a
 * mismatch would leave a cancelled event untagged, or delete something that was not a visit.
 *
 * Matches BOTH producers and any tag already applied:
 *   "Property Visit - <addr>"                (this script)
 *   "Property Visit | <seller> | <addr>"     (the local scraper)
 *   "[CANCELED] Property Visit …"            (already tagged by markVisitEvents_)
 */
function findVisitEvents_(cal, addr, visitDate) {
  var from, to;
  if (visitDate) {
    var d = new Date(visitDate);
    from = new Date(d.getTime() - 2 * 864e5);
    to = new Date(d.getTime() + 3 * 864e5);
  } else {
    var n = new Date();
    from = new Date(n.getTime() - 120 * 864e5);
    to = new Date(n.getTime() + 365 * 864e5);
  }
  // NB: a FULL-length key, not intakeNorm_ (which truncates to 24 chars and would drop the address
  // out of a "Property Visit | Seller | Address" title).
  var keyOf = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
  var addrKey = keyOf(addr);
  return (cal.getEvents(from, to, { search: addr }) || []).filter(function (e) {
    var t = String(e.getTitle() || '').replace(/^\[[A-Z ]+\]\s*/, '');
    return /^Property Visit\b/i.test(t) && addrKey && keyOf(t).indexOf(addrKey) >= 0;
  });
}

/**
 * Tell the team a booked visit is off. One card, at the moment it happens.
 *
 * Cherry asked for this alongside keeping the event: "this will notif as well". The 3pm work queue is
 * the wrong place for it — a cancellation is news, not a task sitting in a queue, and by 3pm Juan may
 * already have driven there. Silent when no webhook is configured.
 */
function notifyVisitTagged_(R, tag, visitDate, marked) {
  try {
    if (typeof chatWebhookUrl_ !== 'function' || !chatWebhookUrl_()) return;
    var when = visitDate ? fmt_(new Date(visitDate)) : 'date not recorded';
    /*
     * timeCell_, not String().
     *
     * The client, on a live card: "there i a bug with this". It read
     *
     *   Was booked for 2026-08-15 at Sat Dec 30 1899 12:00:00 GMT-0800 (Pacific Standard Time)
     *
     * A time-only cell comes back from Sheets as a Date on 30 December 1899 — the epoch it counts times
     * from — so String() on it prints the epoch instead of the clock. Every other card in the project
     * already went through timeCell_, which handles the Date, the raw 0.5-of-a-day serial and typed text
     * alike; this one line was reading the cell raw. It is the moment a visit is called off, so the one
     * fact the reader needs is WHEN it was, and that was the part rendered as gibberish.
     */
    var time = (typeof timeCell_ === 'function'
      ? timeCell_(R.get('Visit Time'))
      : String(R.get('Visit Time') || '')).trim();
    var owner = String(R.get('Assigned Owner') || '').trim() || 'UNASSIGNED';
    var lines = [
      '<b>' + (R.get('Seller Name') || '(no name)') + '</b> · ' + R.get('Property Address'),
      'Was booked for ' + when + (time ? ' at ' + time : '') + ' · Owner: ' + owner,
      // Say honestly what happened to the calendar. "No event was found" is useful information — it
      // usually means the visit date had already passed, or an older version of this code deleted it.
      (marked && marked.count)
        ? '<i>The calendar event is still there, tagged [' + tag + '], with its reminders switched off.</i>'
        : '<i>No calendar event was found for this visit, so there was nothing to tag.</i>'
    ];
    var widgets = [{ textParagraph: { text: lines.join('<br>') } }];
    var url = (typeof dashboardUrl_ === 'function') ? dashboardUrl_() : '';
    if (url) widgets.push({ buttonList: { buttons: [{ text: 'Open dashboard', onClick: { openLink: { url: url } } }] } });
    chatPost_({ cardsV2: [{ cardId: 'visit-tagged', card: {
      header: { title: 'Visit ' + tag.toLowerCase(), subtitle: fmt_(today_()) },
      sections: [{ widgets: widgets }]
    } }] });
    logAuto_('CHAT', R.get('Property ID'), 'Visit ' + tag + ' alert posted.');
  } catch (e) { logAuto_('ERROR', 'notifyVisitTagged', String(e)); }
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
    var up = function(h, v){
      if (v === '' || v == null) return;
      if (h === 'Visit Time') U.set(h, timeValue_(v));
      else if (h.indexOf('Date') >= 0) U.set(h, new Date(v));
      else U.set(h, v);
      updated.push(h);
    };
    up('Last Contact Result', g('Last Contact Result', 'note') || g('Notes', 'notes') || g('Status update', 'statusUpdate'));
    up('Visit Status', g('Visit Status', 'visitStatus'));
    up('Current Stage', g('Current Stage', 'stage'));
    up('Next Action', g('Next Action', 'next'));
    up('Visit Date', g('Visit Date', 'visitDate'));
    // Visit Time was missing from this list while Visit Date was on it, so a reschedule to a new TIME on
    // the same day updated nothing: the row kept the old clock, and the event was then moved to match it.
    up('Visit Time', g('Visit Time', 'visitTime'));
    up('Assigned Visitor', g('Assigned Visitor', 'visitor'));
    U.set('Last Contact Date', today_());
    U.set('Updated By', 'Apps Script'); U.set('Last Updated Date', today_());
    U.flush();
    var calMap = { 'Property Address': addr, 'Seller Name': U.get('Seller Name'), 'Phone': U.get('Phone'),
                   'REI BlackBook Link': U.get('REI BlackBook Link'), 'Lead Source': U.get('Lead Source'),
                   'Visit Date': U.get('Visit Date'), 'Visit Time': U.get('Visit Time') };
    var calU = maybeCreateVisitEvent_(calMap, addr, dup.rowNum);
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
    'Next Action Due Date': g('Visit Date', 'visitDate'),
    /*
     * Pass-throughs, so a caller that parks a row can flag it the way the booking form does — Incomplete,
     * with the '[since ...]' stamp the BEING ADDED card subtracts to show how long it has been waiting.
     * The loop below skips empty values, so every existing caller is unaffected.
     */
    'Data Quality Status': g('Data Quality Status', 'dataQuality'),
    'Exception Reason': g('Exception Reason', 'exceptionReason')
  };
  const R = new RowAccessor_(sh, row);
  Object.keys(map).forEach(function(h){
    var v = map[h];
    if (v === '' || v == null) return;
    if (h === 'Visit Time') R.set(h, timeValue_(v));
    else if (h.indexOf('Date') >= 0) R.set(h, new Date(v));
    else R.set(h, v);
  });
  R.set('Property ID', nextPropertyId_());
  R.set('Source', CFG.SANDBOX ? 'Intake-Sandbox' : 'Intake');
  R.set('Created Date', today_());
  stamp_(R); R.flush();
  const cal = maybeCreateVisitEvent_(map, addr, row);
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
      'Lead Source': row[col('Lead Source') - 1], 'Visit Date': row[col('Visit Date') - 1],
      'Visit Time': row[col('Visit Time') - 1] }, addr, dest);
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
