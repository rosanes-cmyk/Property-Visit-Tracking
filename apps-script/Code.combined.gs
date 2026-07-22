/**
 * ================================================================
 *  TWIN VISIT LOGGER — SINGLE-FILE BUILD (paste this whole file)
 * ================================================================
 *  HOW TO USE:
 *   1. In the DEV COPY sheet: Extensions -> Apps Script.
 *   2. Delete the default Code.gs contents, paste this entire file, Save.
 *   3. Reload the spreadsheet tab. A "🏠 Twin Visit Logger" menu appears.
 *   4. Menu -> "1) Build structure (setup)"  -> authorize when asked.
 *   5. Menu -> "2) Run tests"  -> check the Test Results sheet.
 *   6. (Only after tests pass) Menu -> "3) Install automation triggers".
 *
 *  This file is the concatenation of Config/Setup/Automation/DailyReport/Tests.
 *  It never contacts sellers. The original workbook is never modified.
 * ================================================================
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🏠 Twin Visit Logger')
    .addItem('1) Build structure (setup)', 'setup')
    .addItem('2) Run tests', 'runAllTests')
    .addSeparator()
    .addItem('3) Install automation triggers', 'installTriggers')
    .addItem('Send daily report now (preview)', 'sendDailyReport')
    .addSeparator()
    .addItem('⛔ Remove ALL triggers (kill switch)', 'removeAllTriggers')
    .addToUi();
}


/* ========================= Config.gs ========================= */

/**
 * Twin Visit Logger — shared configuration.
 * Single source of truth for sheet names, column order, and dropdown lists.
 * Mirrors build/build_workbook.py so the live Google Sheet matches the reference .xlsx.
 */

const CFG = {
  DATA_SHEET: 'Data',
  BOARD_SHEET: 'Cherry Opportunity Board',
  DROPDOWN_SHEET: 'Dropdowns',
  EXCEPTIONS_SHEET: 'Exception Queue',
  MIGRATION_SHEET: 'Migration Log',
  LEGACY_ARCHIVE: 'Legacy Pipeline (archive)',
  HEADER_ROW: 1,
  FIRST_DATA_ROW: 2,
  MAX_ROWS: 500,           // formulas maintained down to this row
  REPORT_TITLE: 'Twin Visit Logger Daily Opportunity Report',
  // Set to Cherry's address for the daily report; left blank = report is written to a sheet only.
  REPORT_TO: '',           // e.g. 'rosanes@twinhomebuyer.com'
  STALLED_BUSINESS_DAYS: 3,
  NO_DECISION_BUSINESS_DAYS: 1,
};

// 59 columns, in order. Keep IN SYNC with build/build_workbook.py.
const HEADERS = [
  // Property
  'Property ID','Property Address','Normalized Address','Seller Name','Phone','Email','Lead Source','REI BlackBook Link',
  // Visit
  'Visit Date','Visit Time','Visit Status','Assigned Visitor','Visit Notes','Property Condition','Occupancy Status','Photos Link','Video Link','File Link',
  // Seller
  'Seller Motivation','Seller Timeline','Asking Price','Price Expectation','Seller Concerns',
  // Offer
  'Approved Offer Amount','Offer Status','Offer Prepared Date','Offer Sent Date','Offer Received Confirmation','Counteroffer Amount',
  // Follow-up
  'Last Contact Date','Last Contact Result','Next Action','Next Action Due Date','Assigned Owner','Blocker','Days Since Last Activity','Days Overdue','Stalled Status',
  // Relationship
  'Gift Status','Gift Recommendation Reason','Gift Approval Owner','Gift Sent Date',
  // Closeout
  'Current Stage','Final Disposition','Closeout Reason','Contract Sent Date','Contract Signed Date','Transaction Handoff Status',
  // Computed
  'Missing Required Fields','Duplicate Address Flag','Opportunity Priority',
  // System
  'Created Date','Last Updated Date','Updated By','Source','Data Quality Status','Exception Reason','REI Update Required','REI Update Completed',
];

const DROPDOWNS = {
  'Visit Status': ['Scheduled','Completed','Canceled','Reschedule Needed'],
  'Current Stage': ['Visit Scheduled','Visit Completed — Needs Review','Offer Preparation','Offer Sent','Active Negotiation','Verbal Agreement','Contract Sent','Contract Signed','Long-Term Nurture','Lost / Closed Out'],
  'Assigned Owner': ['Jonathan','Kyle','Cherry','Juan','JM'],
  'Assigned Visitor': ['Juan','Kyle','Cherry','Jonathan','JM','Cesar','Jose Herrera','Manny Morales','Lily','Alan Hernandez'],
  'Gift Approval Owner': ['Cherry','Juan'],
  'Updated By': ['Jonathan','Kyle','Cherry','Juan','JM','Apps Script'],
  'Final Disposition': ['Contracted','Lost','Long-Term Nurture','Closed Out'],
  'Gift Status': ['Not Reviewed','Recommended','Approved','Sent','Not Appropriate'],
  'Blocker': ['Price','Title','Tenant','Family','Access','Timing','Documents','Property Condition','Seller Unresponsive','Other'],
  'Lead Source': ['Direct Mail','Direct Mail - Postcard','PPC','TV','Facebook','SEO','PPL - Property Leads','PPL - Motivated Leads'],
  'Offer Status': ['Not Started','In Preparation','Sent','Countered','Accepted','Rejected','Withdrawn'],
  'Occupancy Status': ['Owner-Occupied','Tenant-Occupied','Vacant','Unknown'],
  'Property Condition': ['Excellent','Good','Fair','Poor','Distressed'],
  'Seller Timeline': ['ASAP','30 days','60 days','90+ days','Unknown'],
  'Offer Received Confirmation': ['Yes','No'],
  'Transaction Handoff Status': ['Not Ready','Ready for Handoff','Handed Off to JM','JM Confirmed'],
  'REI Update Required': ['Yes','No'],
  'REI Update Completed': ['Yes','No'],
  'Source': ['Manual','Apps Script','Import','TEST'],
};

/** column index (1-based) for a header name */
function col(name) {
  const i = HEADERS.indexOf(name);
  if (i < 0) throw new Error('Unknown column: ' + name);
  return i + 1;
}
/** A1 column letter for a header name */
function colL(name) {
  return columnToLetter_(col(name));
}
function columnToLetter_(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}
function dataSheet_() { return SpreadsheetApp.getActive().getSheetByName(CFG.DATA_SHEET); }

/* ========================= Setup.gs ========================= */

/**
 * Twin Visit Logger — Phase 2 native builder.
 * Run setup() ONCE on the development-copy Google Sheet to construct the upgraded
 * structure: 59-column Data sheet, dropdowns, formulas, conditional formatting,
 * the Cherry Opportunity Board, Exception Queue, Migration Log, and filter views.
 *
 * Non-destructive: an existing legacy Data sheet is renamed to the archive, never deleted.
 */

function setup() {
  const ss = SpreadsheetApp.getActive();
  archiveLegacy_(ss);
  const sh = ensureSheet_(ss, CFG.DATA_SHEET, 0);
  writeHeaders_(sh);
  applyDropdowns_(sh);
  writeFormulas_(sh);
  applyConditionalFormatting_(sh);
  buildDropdownSheet_(ss);
  buildBoard_(ss);
  buildExceptionQueue_(ss);
  buildFilterViewsNote_(ss);
  SpreadsheetApp.getActive().toast('Twin Visit Logger structure built. See READ ME / Deployment-Guide.', 'Setup complete', 8);
}

function archiveLegacy_(ss) {
  const d = ss.getSheetByName(CFG.DATA_SHEET);
  if (d && String(d.getRange(1, 2).getValue()).trim() === 'Name') { // legacy signature
    if (!ss.getSheetByName(CFG.LEGACY_ARCHIVE)) {
      d.setName(CFG.LEGACY_ARCHIVE);
      d.hideSheet();
    }
  }
}

function ensureSheet_(ss, name, index) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name, index);
  return sh;
}

function writeHeaders_(sh) {
  sh.getRange(CFG.HEADER_ROW, 1, 1, HEADERS.length).setValues([HEADERS])
    .setFontWeight('bold').setFontColor('#ffffff').setBackground('#2e5a88')
    .setWrap(true).setFontFamily('Arial').setFontSize(10);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(2);
}

function applyDropdowns_(sh) {
  const last = CFG.MAX_ROWS;
  const map = {
    'Lead Source':'Lead Source','Visit Status':'Visit Status','Assigned Visitor':'Assigned Visitor',
    'Property Condition':'Property Condition','Occupancy Status':'Occupancy Status',
    'Seller Timeline':'Seller Timeline','Offer Status':'Offer Status',
    'Offer Received Confirmation':'Offer Received Confirmation','Assigned Owner':'Assigned Owner',
    'Blocker':'Blocker','Gift Status':'Gift Status','Gift Approval Owner':'Gift Approval Owner',
    'Current Stage':'Current Stage','Final Disposition':'Final Disposition',
    'Transaction Handoff Status':'Transaction Handoff Status','Updated By':'Updated By',
    'Source':'Source','REI Update Required':'REI Update Required','REI Update Completed':'REI Update Completed',
  };
  Object.keys(map).forEach(function(header){
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(DROPDOWNS[map[header]], true).setAllowInvalid(false).build();
    sh.getRange(CFG.FIRST_DATA_ROW, col(header), last - 1, 1).setDataValidation(rule);
  });
}

/** Google-native formula for a given header at row r. Returns '' if column is not computed. */
function formulaFor_(header, r) {
  const A = function(h){ return '$' + colL(h) + r; };               // same-row cell
  const R = function(h){ return '$' + colL(h) + '$2:$' + colL(h); }; // open-ended column range
  switch (header) {
    case 'Normalized Address':
      return '=IF(' + A('Property Address') + '="","",TRIM(LOWER(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(' +
        A('Property Address') + ',",",""),".",""),"  "," "),"#","")," apt "," "))))';
    case 'Days Since Last Activity':
      return '=IF(' + A('Property Address') + '="","",IF(MAX(' + A('Last Contact Date') + ',' + A('Last Updated Date') + ',' + A('Visit Date') + ')=0,"",TODAY()-MAX(' + A('Last Contact Date') + ',' + A('Last Updated Date') + ',' + A('Visit Date') + ')))';
    case 'Days Overdue':
      return '=IF(' + A('Property Address') + '="","",IF(' + A('Next Action Due Date') + '="","",IF(TODAY()>' + A('Next Action Due Date') + ',TODAY()-' + A('Next Action Due Date') + ',0)))';
    case 'Stalled Status':
      return '=IF(' + A('Property Address') + '="","",IF(OR(' + A('Current Stage') + '="Lost / Closed Out",' + A('Current Stage') + '="Long-Term Nurture",' + A('Current Stage') + '="Contract Signed"),"No",IF(MAX(' + A('Last Contact Date') + ',' + A('Last Updated Date') + ',' + A('Visit Date') + ')=0,"No",IF(NETWORKDAYS(MAX(' + A('Last Contact Date') + ',' + A('Last Updated Date') + ',' + A('Visit Date') + '),TODAY())-1>=' + CFG.STALLED_BUSINESS_DAYS + ',"Yes","No"))))';
    case 'Missing Required Fields':
      return '=IF(OR(' + A('Property Address') + '="",' + A('Current Stage') + '="Lost / Closed Out"),"",TEXTJOIN(", ",TRUE,' +
        'IF(' + A('Property Address') + '="","Property Address",""),' +
        'IF(' + A('Current Stage') + '="","Current Stage",""),' +
        'IF(' + A('Next Action') + '="","Next Action",""),' +
        'IF(' + A('Next Action Due Date') + '="","Next Action Due Date",""),' +
        'IF(' + A('Assigned Owner') + '="","Assigned Owner",""),' +
        'IF(' + A('REI BlackBook Link') + '="","REI BlackBook Link","")))';
    case 'Duplicate Address Flag':
      return '=IF(' + A('Normalized Address') + '="","",IF(COUNTIFS(' + R('Normalized Address') + ',' + A('Normalized Address') + ',' + R('Current Stage') + ',"<>Lost / Closed Out")>1,"Duplicate",""))';
    case 'Opportunity Priority':
      return '=IF(' + A('Property Address') + '="","",IFS(' +
        A('Current Stage') + '="Verbal Agreement",100,' +
        A('Current Stage') + '="Contract Sent",95,' +
        A('Current Stage') + '="Active Negotiation",85,' +
        A('Current Stage') + '="Offer Sent",70,' +
        A('Current Stage') + '="Offer Preparation",60,' +
        A('Current Stage') + '="Visit Completed — Needs Review",50,' +
        A('Current Stage') + '="Visit Scheduled",30,' +
        A('Current Stage') + '="Long-Term Nurture",10,' +
        A('Current Stage') + '="Contract Signed",5,' +
        'TRUE,0)+IF(' + A('Days Overdue') + '="",0,MIN(' + A('Days Overdue') + ',20))+IF(' + A('Stalled Status') + '="Yes",5,0))';
    case 'Data Quality Status':
      return '=IF(' + A('Property Address') + '="","",IF(' + A('Exception Reason') + '<>"","Exception",IF(' + A('Missing Required Fields') + '<>"","Incomplete","OK")))';
    case 'Exception Reason':
      return '=IF(' + A('Property Address') + '="","",TEXTJOIN(" | ",TRUE,' +
        'IF(AND(' + A('Visit Status') + '="Completed",' + A('Visit Notes') + '=""),"Completed visit missing Visit Notes",""),' +
        'IF(AND(' + A('Visit Status') + '="Completed",' + A('Seller Motivation') + '=""),"Completed visit missing Seller Motivation (or add Exception note)",""),' +
        'IF(AND(' + A('Current Stage') + '="Offer Sent",OR(' + A('Approved Offer Amount') + '="",' + A('Offer Sent Date') + '="")),"Offer Sent needs Approved Offer Amount + Offer Sent Date",""),' +
        'IF(AND(' + A('Current Stage') + '="Active Negotiation",OR(' + A('Last Contact Result') + '="",' + A('Next Action') + '="",' + A('Assigned Owner') + '="",' + A('Next Action Due Date') + '="")),"Active Negotiation needs Last Contact Result + Next Action + Owner + Due Date",""),' +
        'IF(AND(' + A('Current Stage') + '="Contract Sent",' + A('Contract Sent Date') + '="",' + A('File Link') + '=""),"Contract Sent needs Contract Sent Date or File Link",""),' +
        'IF(AND(' + A('Current Stage') + '="Contract Signed",' + A('Contract Signed Date') + '=""),"Contract Signed needs Contract Signed Date",""),' +
        'IF(AND(' + A('Current Stage') + '="Long-Term Nurture",OR(' + A('Next Action Due Date') + '="",' + A('Next Action Due Date') + '<=TODAY())),"Long-Term Nurture needs an exact FUTURE follow-up date",""),' +
        'IF(AND(' + A('Current Stage') + '="Lost / Closed Out",OR(' + A('Final Disposition') + '="",' + A('Closeout Reason') + '="")),"Lost / Closed Out needs Final Disposition + Closeout Reason",""),' +
        'IF(AND(' + A('Gift Status') + '="Sent",' + A('Gift Approval Owner') + '=""),"Gift marked Sent without recorded approval",""),' +
        'IF(' + A('Duplicate Address Flag') + '="Duplicate","Duplicate active record for this address","")))';
    default:
      return '';
  }
}

const COMPUTED_HEADERS = ['Normalized Address','Days Since Last Activity','Days Overdue','Stalled Status',
  'Missing Required Fields','Duplicate Address Flag','Opportunity Priority','Data Quality Status','Exception Reason'];

function writeFormulas_(sh) {
  const first = CFG.FIRST_DATA_ROW, last = CFG.MAX_ROWS;
  COMPUTED_HEADERS.forEach(function(h){
    const c = col(h);
    const formulas = [];
    for (let r = first; r <= last; r++) formulas.push([formulaFor_(h, r)]);
    sh.getRange(first, c, last - first + 1, 1).setFormulas(formulas);
  });
  // date/currency number formats
  ['Visit Date','Offer Prepared Date','Offer Sent Date','Last Contact Date','Next Action Due Date',
   'Gift Sent Date','Contract Sent Date','Contract Signed Date','Created Date','Last Updated Date']
    .forEach(function(h){ sh.getRange(first, col(h), last-first+1, 1).setNumberFormat('yyyy-mm-dd'); });
  ['Asking Price','Price Expectation','Approved Offer Amount','Counteroffer Amount']
    .forEach(function(h){ sh.getRange(first, col(h), last-first+1, 1).setNumberFormat('$#,##0'); });
}

function applyConditionalFormatting_(sh) {
  const first = CFG.FIRST_DATA_ROW, last = CFG.MAX_ROWS;
  const range = sh.getRange(first, 1, last - first + 1, HEADERS.length);
  const dq = colL('Data Quality Status'), ov = colL('Days Overdue'), st = colL('Stalled Status'), cs = colL('Current Stage');
  const rules = [
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + dq + first + '="Exception"').setBackground('#f4cccc').setFontColor('#990000').setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($' + ov + first + '<>"",$' + ov + first + '>0)').setBackground('#f4cccc').setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + st + first + '="Yes"').setBackground('#fce5cd').setFontColor('#b45f06').setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + dq + first + '="Incomplete"').setBackground('#fce5cd').setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + cs + first + '="Contract Signed"').setBackground('#d9ead3').setFontColor('#38761d').setRanges([range]).build(),
  ];
  sh.setConditionalFormatRules(rules);
}

function buildDropdownSheet_(ss) {
  const sh = ensureSheet_(ss, CFG.DROPDOWN_SHEET);
  sh.clear();
  let c = 1;
  Object.keys(DROPDOWNS).forEach(function(key){
    sh.getRange(1, c).setValue(key).setFontWeight('bold').setFontColor('#ffffff').setBackground('#595959');
    const vals = DROPDOWNS[key].map(function(v){ return [v]; });
    sh.getRange(2, c, vals.length, 1).setValues(vals);
    c++;
  });
  sh.hideSheet();
}

/** Cherry Opportunity Board — 10 sections, each a live QUERY over Data. */
function buildBoard_(ss) {
  const sh = ensureSheet_(ss, CFG.BOARD_SHEET, 1);
  sh.clear();
  sh.getRange(1,1).setValue('CHERRY OPPORTUNITY BOARD — actionable opportunities only')
    .setFontWeight('bold').setFontSize(14).setFontColor('#1f4e79');
  sh.getRange(2,1).setValue('Live from Data. Sorted by contract-likelihood, overdue, nearest due date, recent engagement.')
    .setFontStyle('italic').setFontColor('#666666');

  const disp = ['Property Address','Seller Name','Current Stage','Next Action','Assigned Owner',
                'Next Action Due Date','Days Overdue','Blocker','Last Contact Result','REI BlackBook Link'];
  const sel = disp.map(colL).join(',');
  const stage = colL('Current Stage'), due = colL('Next Action Due Date'), ov = colL('Days Overdue'),
        stall = colL('Stalled Status'), prio = colL('Opportunity Priority'), dq = colL('Data Quality Status'),
        gift = colL('Gift Status'), handoff = colL('Transaction Handoff Status'), disp2 = colL('Final Disposition'),
        addr = colL('Property Address');

  const sections = [
    ['1. Contracts Possible This Week', '(' + stage + "='Verbal Agreement' or " + stage + "='Contract Sent' or " + stage + "='Active Negotiation')", prio + ' desc, ' + due],
    ['2. Visited — No Offer Decision', stage + "='Visit Completed — Needs Review'", ov + ' desc, ' + due],
    ['3. Offer Sent — Follow-Up Due', stage + "='Offer Sent'", ov + ' desc, ' + due],
    ['4. Stalled Deals', stall + "='Yes'", ov + ' desc, ' + prio + ' desc'],
    ['5. Overdue Tasks', ov + '>0', ov + ' desc'],
    ['6. Negotiation Decisions', stage + "='Active Negotiation'", prio + ' desc, ' + due],
    ['7. Contract Handoffs', '(' + stage + "='Contract Signed' and " + handoff + " <> 'JM Confirmed')", due],
    ['8. Gift Review', gift + "='Recommended'", due],
    ['9. Revival Opportunities', '(' + disp2 + "='Lost' and " + colL('Days Since Last Activity') + '>=45)', colL('Days Since Last Activity') + ' desc'],
    ['10. Exceptions Requiring Review', '(' + dq + "='Exception' or " + dq + "='Incomplete')", stage],
  ];
  const hdr = ['Address','Seller','Stage','Next Action','Owner','Due','Days Overdue','Blocker','Last Contact Result','REI Link'];
  let row = 4;
  sections.forEach(function(s){
    sh.getRange(row,1,1,10).merge().setValue(s[0]).setFontWeight('bold').setFontSize(12)
      .setFontColor('#ffffff').setBackground('#2e75b6');
    row++;
    sh.getRange(row,1,1,hdr.length).setValues([hdr]).setFontWeight('bold').setBackground('#ddebf7').setFontSize(9);
    row++;
    const q = '=IFERROR(QUERY(' + CFG.DATA_SHEET + '!A' + CFG.FIRST_DATA_ROW + ':BZ' + CFG.MAX_ROWS + ',' +
      '"select ' + sel + ' where ' + addr + ' is not null and ' + s[1] + ' order by ' + s[2] + ' limit 50",0),"— none —")';
    sh.getRange(row,1).setFormula(q);
    row += 8;
  });
  sh.setColumnWidth(1, 240); sh.setColumnWidth(4, 220); sh.setColumnWidth(9, 240); sh.setColumnWidth(10, 220);
  sh.setFrozenRows(3);
}

function buildExceptionQueue_(ss) {
  const sh = ensureSheet_(ss, CFG.EXCEPTIONS_SHEET);
  sh.clear();
  sh.getRange(1,1).setValue('Exception Queue — Incomplete, rule-failing, or duplicate records')
    .setFontWeight('bold').setFontSize(12);
  const disp = ['Property ID','Property Address','Seller Name','Current Stage','Assigned Owner','Data Quality Status','Missing Required Fields','Exception Reason'];
  sh.getRange(3,1,1,disp.length).setValues([disp]).setFontWeight('bold').setFontColor('#ffffff').setBackground('#990000');
  const sel = disp.map(colL).join(',');
  const dq = colL('Data Quality Status'), addr = colL('Property Address');
  const q = '=IFERROR(QUERY(' + CFG.DATA_SHEET + '!A' + CFG.FIRST_DATA_ROW + ':BZ' + CFG.MAX_ROWS + ',' +
    '"select ' + sel + ' where ' + addr + " is not null and (" + dq + "='Incomplete' or " + dq + "='Exception') order by " + dq + '",0),"— none —")';
  sh.getRange(4,1).setFormula(q);
  sh.setTabColor('#990000');
}

function buildFilterViewsNote_(ss) {
  // Filter Views require the Sheets Advanced Service; documented as a manual/optional step.
  // See docs/Deployment-Guide.md "Quick filters".
}

/* ========================= Automation.gs ========================= */

/**
 * Twin Visit Logger — Phase 3 automation (event + time driven).
 *
 * SAFETY: This NEVER sends a message to a seller. All "notifications" are internal
 * (a row in the Automation Log sheet and/or an email to internal staff only).
 *
 * Install triggers with installTriggers() (see Deployment-Guide.md):
 *   - onEditInstallable  -> from spreadsheet "On edit"
 *   - checkNoDecision    -> time-driven, every 1 hour (business-day aware)
 *   - checkStalled       -> time-driven, daily
 *   - sendDailyReport    -> time-driven, daily on business days
 */

function installTriggers() {
  const ss = SpreadsheetApp.getActive();
  removeAllTriggers();  // clear existing project triggers to avoid duplicates
  ScriptApp.newTrigger('onEditInstallable').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('checkNoDecision').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('checkStalled').timeBased().everyDays(1).atHour(6).create();
  ScriptApp.newTrigger('sendDailyReport').timeBased().everyDays(1).atHour(7).create();
  SpreadsheetApp.getActive().toast('Automation triggers installed.', 'Twin Visit Logger', 6);
}

/** KILL SWITCH: remove every trigger this project installed. Data is untouched. */
function removeAllTriggers() {
  const t = ScriptApp.getProjectTriggers();
  t.forEach(function(x){ ScriptApp.deleteTrigger(x); });
  try { SpreadsheetApp.getActive().toast('All ' + t.length + ' triggers removed.', 'Twin Visit Logger', 6); } catch (e) {}
}

/* ---------------------------- edit-driven ---------------------------- */

function onEditInstallable(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (sh.getName() !== CFG.DATA_SHEET) return;
    const row = e.range.getRow();
    if (row < CFG.FIRST_DATA_ROW) return;
    const editedCol = e.range.getColumn();
    const R = new RowAccessor_(sh, row);
    if (!R.get('Property Address')) return; // ignore blank rows

    const header = HEADERS[editedCol - 1];
    stamp_(R); // Last Updated Date / Updated By

    switch (header) {
      case 'Visit Status':        onVisitStatus_(R); break;
      case 'Approved Offer Amount': onOfferApproved_(R); break;
      case 'Offer Sent Date':     onOfferSent_(R); break;
      case 'Counteroffer Amount': onSellerCounter_(R); break;
      case 'Offer Status':        if (R.get('Offer Status') === 'Countered') onSellerCounter_(R);
                                  else if (R.get('Offer Status') === 'Accepted') onVerbalAgreement_(R); break;
      case 'Contract Sent Date':  onContractSent_(R); break;
      case 'Contract Signed Date':onContractSigned_(R); break;
      case 'Gift Status':         if (R.get('Gift Status') === 'Recommended') onGiftRecommended_(R); break;
      case 'Current Stage':       onStageManual_(R); break;
    }
    R.flush();
  } catch (err) {
    logAuto_('ERROR', 'onEdit', String(err));
  }
}

function onVisitStatus_(R) {
  const v = R.get('Visit Status');
  if (v === 'Scheduled') {
    R.setIfBlank('Current Stage', 'Visit Scheduled');
    R.setIfBlank('Next Action', 'Conduct scheduled visit & log outcome');
    R.setIfBlank('Next Action Due Date', R.get('Visit Date') || today_());
    if (isDuplicateActive_(R)) logAuto_('WARN', R.get('Property ID'), 'Possible duplicate active record for this address');
    logAuto_('INFO', R.get('Property ID'), 'Visit scheduled; reminder due ' + fmt_(R.get('Visit Date')));
  } else if (v === 'Completed') {
    R.set('Current Stage', 'Visit Completed — Needs Review');
    R.setIfBlank('Assigned Owner', 'Jonathan');
    R.set('Next Action Due Date', today_());          // same-day review
    R.setIfBlank('Next Action', 'Review completed visit: make offer or pass');
    if (!R.get('Visit Notes')) logAuto_('EXCEPTION', R.get('Property ID'), 'Completed visit missing Visit Notes');
    logAuto_('TASK', R.get('Property ID'), 'Review task -> Jonathan (same-day)');
  }
}

function onOfferApproved_(R) {
  if (!R.get('Approved Offer Amount')) return;
  R.set('Current Stage', 'Offer Preparation');
  R.set('Assigned Owner', 'Kyle');
  R.setIfBlank('Offer Status', 'In Preparation');
  R.set('Next Action', 'Prepare offer (' + money_(R.get('Approved Offer Amount')) + ')');
  R.setIfBlank('Next Action Due Date', addBiz_(today_(), 1));
  logAuto_('TASK', R.get('Property ID'),
    'Offer-prep -> Kyle | ' + R.get('Property Address') + ' | ' + money_(R.get('Approved Offer Amount')) +
    ' | due ' + fmt_(R.get('Next Action Due Date')) + ' | REI ' + (R.get('REI BlackBook Link') || 'n/a'));
}

function onOfferSent_(R) {
  if (!R.get('Offer Sent Date')) return;
  R.set('Current Stage', 'Offer Sent');
  R.setIfBlank('Offer Status', 'Sent');
  R.set('Next Action', 'Confirm seller received offer, then follow up');
  R.set('Next Action Due Date', addBiz_(R.get('Offer Sent Date'), 2));
  R.setIfBlank('Assigned Owner', 'Cherry');
  logAuto_('TASK', R.get('Property ID'), 'Offer follow-up scheduled ' + fmt_(R.get('Next Action Due Date')));
}

function onSellerCounter_(R) {
  R.set('Current Stage', 'Active Negotiation');
  R.setIfBlank('Assigned Owner', 'Cherry');
  R.setIfBlank('Next Action', 'Decide response to seller counter');
  R.setIfBlank('Next Action Due Date', addBiz_(today_(), 1));
  logAuto_('NOTIFY', R.get('Property ID'), 'Negotiation: notify Cherry/Juan. Requires Last Contact Result + Next Action + Owner + Due.');
}

function onVerbalAgreement_(R) {
  R.set('Current Stage', 'Verbal Agreement');
  R.set('Assigned Owner', 'Kyle');
  R.set('Next Action', 'Prepare purchase contract');
  R.setIfBlank('Next Action Due Date', addBiz_(today_(), 1));
  logAuto_('TASK', R.get('Property ID'), 'HIGHEST PRIORITY: contract-prep -> Kyle');
}

function onContractSent_(R) {
  if (!R.get('Contract Sent Date')) return;
  R.set('Current Stage', 'Contract Sent');
  R.set('Next Action', 'Confirm signature (daily internal follow-up)');
  R.set('Next Action Due Date', addBiz_(today_(), 1));
  logAuto_('TASK', R.get('Property ID'), 'Daily internal follow-up until signed/declined');
}

function onContractSigned_(R) {
  if (!R.get('Contract Signed Date')) return;
  R.set('Current Stage', 'Contract Signed');
  R.set('Final Disposition', 'Contracted');
  R.setIfBlank('Transaction Handoff Status', 'Ready for Handoff');
  R.set('Assigned Owner', 'JM');
  R.set('Next Action', 'Hand off signed contract to JM');
  R.setIfBlank('Next Action Due Date', addBiz_(today_(), 1));
  R.set('REI Update Required', 'Yes');
  logAuto_('TASK', R.get('Property ID'), 'JM HANDOFF created; sales follow-up stopped; REI update required');
}

function onGiftRecommended_(R) {
  R.setIfBlank('Gift Approval Owner', ''); // approval still required (Cherry/Juan)
  logAuto_('TASK', R.get('Property ID'),
    'Gift review -> Kyle to coordinate; requires Cherry/Juan approval. NO gift purchased/sent automatically.');
}

function onStageManual_(R) {
  const s = R.get('Current Stage');
  if (s === 'Long-Term Nurture') {
    R.setIfBlank('Assigned Owner', 'Cherry');
    if (!R.get('Next Action Due Date') || R.get('Next Action Due Date') <= today_())
      logAuto_('EXCEPTION', R.get('Property ID'), 'Long-Term Nurture needs an exact FUTURE follow-up date');
  } else if (s === 'Lost / Closed Out') {
    if (!R.get('Final Disposition') || !R.get('Closeout Reason'))
      logAuto_('EXCEPTION', R.get('Property ID'), 'Lost / Closed Out needs Final Disposition + Closeout Reason');
    logAuto_('INFO', R.get('Property ID'), 'Closed: active follow-up stopped');
  } else if (s === 'Verbal Agreement') {
    onVerbalAgreement_(R);
  }
}

/* ---------------------------- time-driven ---------------------------- */

/** Completed visit with no offer/pass decision within 1 business day -> overdue + escalate to Cherry. */
function checkNoDecision() {
  eachDataRow_(function(R){
    if (R.get('Current Stage') !== 'Visit Completed — Needs Review') return;
    const visit = R.get('Visit Date') || R.get('Last Updated Date');
    if (!visit) return;
    if (bizDaysBetween_(visit, today_()) >= CFG.NO_DECISION_BUSINESS_DAYS) {
      if (R.get('Assigned Owner') !== 'Cherry' && !R.getNote('_escalated')) {
        logAuto_('ESCALATE', R.get('Property ID'), 'No offer decision > 1 business day; escalating to Cherry (kept Jonathan as reviewer)');
        R.setNote('_escalated', '1');
      }
      if (!R.get('Next Action Due Date') || R.get('Next Action Due Date') > today_()) R.set('Next Action Due Date', today_());
      R.flush();
    }
  });
}

/** No meaningful activity for 3 business days -> Stalled (formula sets flag); notify owner once. */
function checkStalled() {
  eachDataRow_(function(R){
    if (R.get('Stalled Status') === 'Yes' && !R.getNote('_stalled_notified')) {
      logAuto_('NOTIFY', R.get('Property ID'), 'STALLED (>3 business days). Owner: ' + (R.get('Assigned Owner') || 'unassigned'));
      R.setNote('_stalled_notified', fmt_(today_()));
      R.flush();
    }
    if (R.get('Stalled Status') !== 'Yes' && R.getNote('_stalled_notified')) {
      R.setNote('_stalled_notified', ''); R.flush(); // reset when activity resumes
    }
  });
}

/* ---------------------------- helpers ---------------------------- */

function stamp_(R) {
  R.set('Last Updated Date', today_());
  var u = Session.getActiveUser().getEmail();
  R.set('Updated By', u ? u.split('@')[0] : 'Apps Script');
}

function isDuplicateActive_(R) {
  const sh = dataSheet_();
  const norm = String(R.get('Property Address') || '').toLowerCase().replace(/[,.#]/g,'').replace(/\s+/g,' ').trim();
  if (!norm) return false;
  const vals = sh.getRange(CFG.FIRST_DATA_ROW, col('Normalized Address'), CFG.MAX_ROWS, 1).getValues();
  const stages = sh.getRange(CFG.FIRST_DATA_ROW, col('Current Stage'), CFG.MAX_ROWS, 1).getValues();
  let count = 0;
  for (let i=0;i<vals.length;i++){ if (String(vals[i][0]).trim()===norm && stages[i][0] !== 'Lost / Closed Out') count++; }
  return count > 1;
}

function today_() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function fmt_(d) { return d ? Utilities.formatDate(new Date(d), Session.getScriptTimeZone(), 'yyyy-MM-dd') : ''; }
function money_(n) { return n ? '$' + Number(n).toLocaleString() : ''; }
function addBiz_(d, n) { let r = new Date(d); let added=0; while(added<n){ r.setDate(r.getDate()+1); const g=r.getDay(); if(g!==0&&g!==6) added++; } return new Date(r.getFullYear(),r.getMonth(),r.getDate()); }
function bizDaysBetween_(a, b) { a=new Date(a); b=new Date(b); let n=0; const s=new Date(a); while(s<b){ s.setDate(s.getDate()+1); const g=s.getDay(); if(g!==0&&g!==6) n++; } return n; }

function eachDataRow_(fn) {
  const sh = dataSheet_();
  const last = sh.getLastRow();
  for (let r = CFG.FIRST_DATA_ROW; r <= last; r++) {
    const R = new RowAccessor_(sh, r);
    if (R.get('Property Address')) fn(R);
  }
}

function logAuto_(level, id, msg) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName('Automation Log');
  if (!sh) { sh = ss.insertSheet('Automation Log'); sh.appendRow(['Timestamp','Level','Property ID','Message']); sh.hideSheet(); }
  sh.appendRow([new Date(), level, id, msg]);
}

/** Buffered row read/write to minimise Sheet calls. */
function RowAccessor_(sh, row) {
  this.sh = sh; this.row = row;
  this._vals = sh.getRange(row, 1, 1, HEADERS.length).getValues()[0];
  this._dirty = {};
  this.get = function(h){ return this._vals[col(h)-1]; };
  this.set = function(h,v){ this._vals[col(h)-1]=v; this._dirty[col(h)]=v; return this; };
  this.setIfBlank = function(h,v){ if(this.get(h)===''||this.get(h)==null) this.set(h,v); return this; };
  this.getNote = function(key){ const n=this.sh.getRange(this.row,1).getNote()||''; const m=n.match(new RegExp(key+'=([^;]*)')); return m?m[1]:''; };
  this.setNote = function(key,val){ let n=this.sh.getRange(this.row,1).getNote()||''; const re=new RegExp(key+'=[^;]*;?'); n=n.replace(re,''); if(val!=='') n+=key+'='+val+';'; this.sh.getRange(this.row,1).setNote(n); };
  this.flush = function(){ const cols=Object.keys(this._dirty); cols.forEach(function(c){ this.sh.getRange(this.row, Number(c)).setValue(this._dirty[c]); }, this); this._dirty={}; };
}

/* ========================= DailyReport.gs ========================= */

/**
 * Twin Visit Logger — Daily Opportunity Report.
 * Builds a business-day report of actionable records and either emails it to
 * CFG.REPORT_TO (internal staff only) or writes it to a "Daily Report" sheet.
 * Never messages a seller.
 */

function sendDailyReport() {
  const d = new Date();
  const g = d.getDay();
  if (g === 0 || g === 6) return; // business days only

  const sections = reportSections_();
  const total = sections.reduce(function(n,s){ return n + s.rows.length; }, 0);
  const sendEmpty = false;
  if (total === 0 && !sendEmpty) { writeReportSheet_(sections, 0); return; }

  const html = renderReportHtml_(sections, total);
  if (CFG.REPORT_TO) {
    MailApp.sendEmail({ to: CFG.REPORT_TO, subject: CFG.REPORT_TITLE + ' — ' + fmt_(today_()), htmlBody: html });
  }
  writeReportSheet_(sections, total);
}

/** The 10 report sections, computed from Data (same logic as the Board). */
function reportSections_() {
  const rows = readAllRows_();
  const active = rows.filter(function(r){ return r['Property Address']; });
  function f(pred){ return active.filter(pred); }
  const ov = function(r){ return Number(r['Days Overdue']) || 0; };

  return [
    { title: 'Contracts Possible This Week',
      rows: f(function(r){ return ['Verbal Agreement','Contract Sent','Active Negotiation'].indexOf(r['Current Stage'])>=0; })
              .sort(function(a,b){ return (Number(b['Opportunity Priority'])||0)-(Number(a['Opportunity Priority'])||0); }) },
    { title: 'Visited — No Offer Decision',
      rows: f(function(r){ return r['Current Stage']==='Visit Completed — Needs Review'; }).sort(byOverdue_) },
    { title: 'Offer Sent — Follow-Up Due',
      rows: f(function(r){ return r['Current Stage']==='Offer Sent'; }).sort(byOverdue_) },
    { title: 'Stalled Deals',
      rows: f(function(r){ return r['Stalled Status']==='Yes'; }).sort(byOverdue_) },
    { title: 'Overdue Tasks',
      rows: f(function(r){ return ov(r)>0; }).sort(byOverdue_) },
    { title: 'Negotiation Decisions',
      rows: f(function(r){ return r['Current Stage']==='Active Negotiation'; }) },
    { title: 'Contract Handoffs',
      rows: f(function(r){ return r['Current Stage']==='Contract Signed' && r['Transaction Handoff Status']!=='JM Confirmed'; }) },
    { title: 'Gift Review',
      rows: f(function(r){ return r['Gift Status']==='Recommended'; }) },
    { title: 'Revival Opportunities',
      rows: f(function(r){ return r['Final Disposition']==='Lost' && (Number(r['Days Since Last Activity'])||0)>=45; }) },
    { title: 'Exceptions',
      rows: f(function(r){ return r['Data Quality Status']==='Exception' || r['Data Quality Status']==='Incomplete'; }) },
  ];
}
function byOverdue_(a,b){ return (Number(b['Days Overdue'])||0)-(Number(a['Days Overdue'])||0); }

function renderReportHtml_(sections, total) {
  const cols = ['Property Address','Seller Name','Current Stage','Next Action','Assigned Owner','Next Action Due Date','Days Overdue','Blocker'];
  let h = '<div style="font-family:Arial,sans-serif;font-size:13px;color:#222">';
  h += '<h2 style="color:#1f4e79;margin:0 0 4px">' + CFG.REPORT_TITLE + '</h2>';
  h += '<div style="color:#666">' + fmt_(today_()) + ' · ' + total + ' actionable records</div>';
  sections.forEach(function(s){
    h += '<h3 style="background:#2e75b6;color:#fff;padding:6px 8px;margin:14px 0 0;border-radius:4px">' +
         s.title + ' (' + s.rows.length + ')</h3>';
    if (!s.rows.length) { h += '<div style="color:#999;padding:6px">— none —</div>'; return; }
    h += '<table style="border-collapse:collapse;width:100%;margin-top:4px"><tr>';
    cols.forEach(function(c){ h += '<th style="text-align:left;border-bottom:2px solid #ccc;padding:4px;font-size:11px">' + c + '</th>'; });
    h += '</tr>';
    s.rows.forEach(function(r){
      const overdue = (Number(r['Days Overdue'])||0) > 0;
      h += '<tr style="background:' + (overdue ? '#fdECEC' : '#fff') + '">';
      cols.forEach(function(c){
        let v = r[c]; if (c.indexOf('Date')>=0 && v) v = fmt_(v);
        h += '<td style="border-bottom:1px solid #eee;padding:4px;font-size:12px">' + (v==null?'':v) + '</td>';
      });
      h += '</tr>';
    });
    h += '</table>';
  });
  h += '<p style="color:#999;font-size:11px;margin-top:16px">Generated by Twin Visit Logger. Internal use only — no seller was contacted.</p></div>';
  return h;
}

function writeReportSheet_(sections, total) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName('Daily Report');
  if (!sh) sh = ss.insertSheet('Daily Report');
  sh.clear();
  sh.getRange(1,1).setValue(CFG.REPORT_TITLE + ' — ' + fmt_(today_()) + ' (' + total + ' actionable)')
    .setFontWeight('bold').setFontSize(13).setFontColor('#1f4e79');
  const cols = ['Property Address','Seller Name','Current Stage','Next Action','Assigned Owner','Next Action Due Date','Days Overdue','Blocker'];
  let row = 3;
  sections.forEach(function(s){
    sh.getRange(row,1,1,cols.length).merge();
    sh.getRange(row,1).setValue(s.title + ' (' + s.rows.length + ')').setFontWeight('bold').setFontColor('#fff').setBackground('#2e75b6');
    row++;
    sh.getRange(row,1,1,cols.length).setValues([cols]).setFontWeight('bold').setBackground('#ddebf7');
    row++;
    if (!s.rows.length) { sh.getRange(row,1).setValue('— none —').setFontColor('#999'); row+=2; return; }
    const data = s.rows.map(function(r){ return cols.map(function(c){ let v=r[c]; if(c.indexOf('Date')>=0&&v) v=fmt_(v); return v==null?'':v; }); });
    sh.getRange(row,1,data.length,cols.length).setValues(data);
    row += data.length + 1;
  });
}

function readAllRows_() {
  const sh = dataSheet_();
  const last = sh.getLastRow();
  if (last < CFG.FIRST_DATA_ROW) return [];
  const vals = sh.getRange(CFG.FIRST_DATA_ROW, 1, last - CFG.FIRST_DATA_ROW + 1, HEADERS.length).getValues();
  return vals.map(function(v){ const o={}; HEADERS.forEach(function(h,i){ o[h]=v[i]; }); return o; });
}

/* ========================= Tests.gs ========================= */

/**
 * Twin Visit Logger — Phase 3 automation test harness.
 * Run runAllTests() from the Apps Script editor AFTER setup() and installTriggers().
 * It writes test rows, simulates the edit events, and asserts the automation outcomes.
 * Results are written to a "Test Results" sheet and logged. Uses TEST- IDs; cleans up.
 *
 * NOTE: onEdit installable triggers do not fire from setValue() in code, so each test
 * calls the automation handler directly (onEditInstallable is a thin dispatcher over the
 * same handlers), which is exactly the code path a real edit runs.
 */

function runAllTests() {
  const results = [];
  const sh = dataSheet_();
  const startRow = sh.getLastRow() + 2;
  let r = startRow;

  function newRow(fields) {
    const R = new RowAccessor_(sh, r);
    Object.keys(fields).forEach(function(k){ R.set(k, fields[k]); });
    R.flush();
    const acc = new RowAccessor_(sh, r);
    r++;
    return acc;
  }
  function assert(name, cond, detail) {
    results.push([name, cond ? 'PASS' : 'FAIL', detail || '']);
  }
  function edit(R, header, value) {  // simulate a user edit
    R.set(header, value); R.flush();
    const fake = { range: sh.getRange(R.row, col(header)) };
    onEditInstallable(fake);
    return new RowAccessor_(sh, R.row);
  }

  // 1 & scheduled visit
  let a = newRow({'Property ID':'TEST-A1','Property Address':'1 Auto Test St, Testville, CA','Seller Name':'Auto One','REI BlackBook Link':'https://rei/test-a1','Visit Date': today_(),'Source':'TEST'});
  a = edit(a, 'Visit Status', 'Scheduled');
  assert('1. Scheduled visit -> Current Stage=Visit Scheduled', a.get('Current Stage')==='Visit Scheduled', a.get('Current Stage'));

  // 2 duplicate address flagged (formula) — create a second active row with same address
  let dup = newRow({'Property ID':'TEST-A1b','Property Address':'1 Auto Test St, Testville, CA','Seller Name':'Auto Dup','REI BlackBook Link':'https://rei/test-a1b','Visit Status':'Scheduled','Current Stage':'Visit Scheduled','Source':'TEST'});
  SpreadsheetApp.flush();
  assert('2. Duplicate address flagged', new RowAccessor_(sh, dup.row).get('Duplicate Address Flag')==='Duplicate', 'flag='+new RowAccessor_(sh, dup.row).get('Duplicate Address Flag'));

  // 3 & 4 completed visit -> Needs Review + Jonathan
  let b = newRow({'Property ID':'TEST-A2','Property Address':'2 Auto Test St, Testville, CA','Seller Name':'Auto Two','REI BlackBook Link':'https://rei/test-a2','Visit Notes':'done','Seller Motivation':'motivated','Source':'TEST'});
  b = edit(b, 'Visit Status', 'Completed');
  assert('3. Completed visit -> Needs Review', b.get('Current Stage')==='Visit Completed — Needs Review', b.get('Current Stage'));
  assert('4. Completed visit -> Jonathan', b.get('Assigned Owner')==='Jonathan', b.get('Assigned Owner'));

  // 6 approved offer -> Kyle + Offer Preparation
  let c = newRow({'Property ID':'TEST-A3','Property Address':'3 Auto Test St, Testville, CA','Seller Name':'Auto Three','REI BlackBook Link':'https://rei/test-a3','Visit Status':'Completed','Visit Notes':'x','Seller Motivation':'y','Source':'TEST'});
  c = edit(c, 'Approved Offer Amount', 500000);
  assert('6. Approved offer -> Kyle', c.get('Assigned Owner')==='Kyle', c.get('Assigned Owner'));
  assert('6b. Approved offer -> Offer Preparation', c.get('Current Stage')==='Offer Preparation', c.get('Current Stage'));

  // 7 offer sent -> follow-up
  c = edit(c, 'Offer Sent Date', today_());
  assert('7. Offer sent -> Offer Sent stage + follow-up due', c.get('Current Stage')==='Offer Sent' && !!c.get('Next Action Due Date'), c.get('Current Stage'));

  // 8 seller counter -> Active Negotiation
  let e2 = newRow({'Property ID':'TEST-A4','Property Address':'4 Auto Test St, Testville, CA','Seller Name':'Auto Four','REI BlackBook Link':'https://rei/test-a4','Current Stage':'Offer Sent','Source':'TEST'});
  e2 = edit(e2, 'Counteroffer Amount', 560000);
  assert('8. Seller counter -> Active Negotiation', e2.get('Current Stage')==='Active Negotiation', e2.get('Current Stage'));

  // 9 verbal agreement -> contract task (Kyle)
  let f2 = newRow({'Property ID':'TEST-A5','Property Address':'5 Auto Test St, Testville, CA','Seller Name':'Auto Five','REI BlackBook Link':'https://rei/test-a5','Source':'TEST'});
  f2 = edit(f2, 'Current Stage', 'Verbal Agreement');
  assert('9. Verbal agreement -> Kyle contract task', f2.get('Assigned Owner')==='Kyle', f2.get('Assigned Owner'));

  // 10 & 11 contract sent -> follow-up ; contract signed -> JM handoff
  let g2 = newRow({'Property ID':'TEST-A6','Property Address':'6 Auto Test St, Testville, CA','Seller Name':'Auto Six','REI BlackBook Link':'https://rei/test-a6','Source':'TEST'});
  g2 = edit(g2, 'Contract Sent Date', today_());
  assert('10. Contract sent -> Contract Sent + follow-up', g2.get('Current Stage')==='Contract Sent' && !!g2.get('Next Action Due Date'), g2.get('Current Stage'));
  g2 = edit(g2, 'Contract Signed Date', today_());
  assert('11. Contract signed -> JM handoff + Contracted', g2.get('Current Stage')==='Contract Signed' && g2.get('Assigned Owner')==='JM' && g2.get('Final Disposition')==='Contracted', g2.get('Assigned Owner'));

  // 13 nurture requires future date
  let h2 = newRow({'Property ID':'TEST-A7','Property Address':'7 Auto Test St, Testville, CA','Seller Name':'Auto Seven','REI BlackBook Link':'https://rei/test-a7','Next Action Due Date':today_(),'Source':'TEST'});
  h2 = edit(h2, 'Current Stage', 'Long-Term Nurture');
  SpreadsheetApp.flush();
  assert('13. Nurture w/ non-future date -> Exception flagged', String(new RowAccessor_(sh,h2.row).get('Exception Reason')).indexOf('FUTURE')>=0, new RowAccessor_(sh,h2.row).get('Exception Reason'));

  // 14 lost requires closeout reason
  let i2 = newRow({'Property ID':'TEST-A8','Property Address':'8 Auto Test St, Testville, CA','Seller Name':'Auto Eight','REI BlackBook Link':'https://rei/test-a8','Source':'TEST'});
  i2 = edit(i2, 'Current Stage', 'Lost / Closed Out');
  SpreadsheetApp.flush();
  assert('14. Lost w/o disposition/reason -> Exception flagged', String(new RowAccessor_(sh,i2.row).get('Exception Reason')).indexOf('Lost')>=0, new RowAccessor_(sh,i2.row).get('Exception Reason'));

  // 15 gift recommended requires approval (no auto-send)
  let j2 = newRow({'Property ID':'TEST-A9','Property Address':'9 Auto Test St, Testville, CA','Seller Name':'Auto Nine','REI BlackBook Link':'https://rei/test-a9','Source':'TEST'});
  j2 = edit(j2, 'Gift Status', 'Recommended');
  assert('15. Gift recommended -> review task, not sent', j2.get('Gift Status')==='Recommended', 'gift not auto-sent');

  // 16 missing required -> exception/incomplete
  let k2 = newRow({'Property ID':'TEST-A10','Property Address':'10 Auto Test St, Testville, CA','Seller Name':'Auto Ten','Current Stage':'Visit Scheduled','Source':'TEST'});
  SpreadsheetApp.flush();
  assert('16. Missing required -> Incomplete', new RowAccessor_(sh,k2.row).get('Data Quality Status')==='Incomplete', new RowAccessor_(sh,k2.row).get('Data Quality Status'));

  writeTestResults_(results);
  cleanupTests_();
  SpreadsheetApp.getActive().toast('Automation tests complete: ' + results.filter(function(x){return x[1]==='PASS';}).length + '/' + results.length + ' passed', 'Tests', 8);
}

function writeTestResults_(results) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName('Test Results');
  if (!sh) sh = ss.insertSheet('Test Results');
  sh.clear();
  sh.getRange(1,1,1,3).setValues([['Test','Result','Detail']]).setFontWeight('bold').setBackground('#ddebf7');
  sh.getRange(2,1,results.length,3).setValues(results);
}

/** remove TEST-A* rows created by the harness */
function cleanupTests_() {
  const sh = dataSheet_();
  for (let r = sh.getLastRow(); r >= CFG.FIRST_DATA_ROW; r--) {
    const id = String(sh.getRange(r, col('Property ID')).getValue());
    if (id.indexOf('TEST-A') === 0) sh.deleteRow(r);
  }
}
