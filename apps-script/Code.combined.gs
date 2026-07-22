/**
 * ================================================================
 *  TWIN VISIT LOGGER — SINGLE-FILE BUILD (paste this whole file)
 * ================================================================
 *  HOW TO USE:
 *   1. In the DEV COPY sheet: Extensions -> Apps Script.
 *   2. Delete the default Code.gs contents, paste this entire file, Save.
 *   3. Reload the spreadsheet tab. A "🏠 Twin Visit Logger" menu appears.
 *   4. Menu -> "1) Build structure (setup)"  (or "Repair sheet" if already built).
 *   5. Menu -> "2) Load pilot + test data".
 *   6. Menu -> "3) Run tests"  -> check the Test Results sheet.
 *   7. (Only after tests pass, and only when YOU approve) "4) Install automation triggers".
 *
 *  Concatenation of Config/Setup/LoadData/Automation/DailyReport/Tests.
 *  Never contacts sellers. The original workbook is never modified.
 *  Triggers are NEVER installed automatically.
 * ================================================================
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🏠 Twin Visit Logger')
    .addItem('1) Build structure (setup)', 'setup')
    .addItem('2) Load pilot + test data', 'loadPilotData')
    .addItem('3) Run tests', 'runAllTests')
    .addSeparator()
    .addItem('4) Install automation triggers', 'installTriggers')
    .addItem('Send daily report now (preview)', 'sendDailyReport')
    .addSeparator()
    .addItem('Repair sheet (formulas / validation / formatting)', 'repairSheet')
    .addItem('Remove test data (Source = TEST)', 'removeTestData')
    .addItem('Clear all data rows', 'clearAllData')
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
  TASK_QUEUE_SHEET: 'Task Queue',   // visible internal task delivery (pilot)
  TEST_DATA_SHEET: 'Test Data',     // Source=TEST records live here, not on the live Board
};

// Internal task recipients. Blank = deliver via the visible Task Queue sheet only (pilot default).
// Set an INTERNAL address to also email that person their tasks. NEVER a seller address.
const OWNER_EMAILS = { Jonathan: '', Kyle: '', Cherry: '', Juan: '', JM: '' };

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
  // Relationship (appended so the original 59 columns keep their positions on the live sheet)
  'Gift Approved By','Gift Approval Date',
];

const DROPDOWNS = {
  'Visit Status': ['Scheduled','Completed','Canceled','Reschedule Needed'],
  'Current Stage': ['Visit Scheduled','Visit Completed — Needs Review','Offer Preparation','Offer Sent','Active Negotiation','Verbal Agreement','Contract Sent','Contract Signed','Long-Term Nurture','Lost / Closed Out'],
  'Assigned Owner': ['Jonathan','Kyle','Cherry','Juan','JM'],
  'Assigned Visitor': ['Juan','Kyle','Cherry','Jonathan','JM','Cesar','Jose Herrera','Manny Morales','Lily','Alan Hernandez'],
  'Gift Approval Owner': ['Cherry','Juan'],
  'Gift Approved By': ['Cherry','Juan'],
  'Updated By': ['Jonathan','Kyle','Cherry','Juan','JM','Apps Script','Import'],
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
  buildMigrationLog_(ss);
  buildTestDataSheet_(ss);
  ensureTaskQueue_(ss);
  SpreadsheetApp.getActive().toast('Twin Visit Logger structure built. See READ ME / Deployment-Guide.', 'Setup complete', 8);
}

/**
 * Reapply formulas, dropdown validations, number formats, and conditional formatting
 * through row MAX_ROWS WITHOUT changing user-entered data. Safe to run anytime
 * (e.g. after clearing test rows, or if a range shrank). Rebuilds the view sheets too.
 */
function repairSheet() {
  const ss = SpreadsheetApp.getActive();
  const sh = dataSheet_();
  if (!sh) { SpreadsheetApp.getUi().alert('Run "Build structure (setup)" first.'); return; }
  writeHeaders_(sh);            // row 1 only (idempotent)
  applyDropdowns_(sh);          // rows 2..MAX_ROWS
  writeFormulas_(sh);           // rewrites ONLY the 9 computed columns (never user data)
  applyConditionalFormatting_(sh);
  buildDropdownSheet_(ss);
  buildBoard_(ss);
  buildExceptionQueue_(ss);
  buildMigrationLog_(ss);
  buildTestDataSheet_(ss);
  ensureTaskQueue_(ss);
  SpreadsheetApp.getActive().toast('Repaired: formulas, validations, formats & views reapplied to row ' + CFG.MAX_ROWS + '.', 'Twin Visit Logger', 8);
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
    'Gift Approved By':'Gift Approved By',
    'Current Stage':'Current Stage','Final Disposition':'Final Disposition',
    'Transaction Handoff Status':'Transaction Handoff Status','Updated By':'Updated By',
    'Source':'Source','REI Update Required':'REI Update Required','REI Update Completed':'REI Update Completed',
  };
  // 'Updated By' is an identity field (editor names / email prefixes vary), so it is a
  // SOFT dropdown (suggests values but accepts any) — otherwise automation stamping the
  // editor's name would violate the rule and throw on every edit.
  const SOFT = {'Updated By': true};
  Object.keys(map).forEach(function(header){
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(DROPDOWNS[map[header]], true).setAllowInvalid(!!SOFT[header]).build();
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
        'IF(AND(' + A('Gift Status') + '="Sent",OR(' + A('Gift Approved By') + '="",' + A('Gift Approval Date') + '="")),"Gift marked Sent without recorded approval (needs Gift Approved By + Gift Approval Date)",""),' +
        'IF(' + A('Duplicate Address Flag') + '="Duplicate","Duplicate active record for this address","")))';
    default:
      return '';
  }
}

const COMPUTED_HEADERS = ['Normalized Address','Days Since Last Activity','Days Overdue','Stalled Status',
  'Missing Required Fields','Duplicate Address Flag','Opportunity Priority','Data Quality Status','Exception Reason'];

/** Rewrite the 9 computed-column formulas for a single row. */
function restoreFormulasRow_(sh, r) {
  COMPUTED_HEADERS.forEach(function(h){ sh.getRange(r, col(h)).setFormula(formulaFor_(h, r)); });
}

/**
 * Clear ONE record in place: wipe user (non-computed) columns + the automation note marker,
 * then restore the computed formulas. Never deletes the row, so the formula range,
 * conditional-format range and dropdown-validation range never shrink.
 */
function clearRecordRow_(sh, r) {
  for (var i = 0; i < HEADERS.length; i++) {
    if (COMPUTED_HEADERS.indexOf(HEADERS[i]) < 0) sh.getRange(r, i + 1).clearContent();
  }
  try { sh.getRange(r, 1).clearNote(); } catch (e) {}
  restoreFormulasRow_(sh, r);
}

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
   'Gift Sent Date','Gift Approval Date','Contract Sent Date','Contract Signed Date','Created Date','Last Updated Date']
    .forEach(function(h){ sh.getRange(first, col(h), last-first+1, 1).setNumberFormat('yyyy-mm-dd'); });
  ['Asking Price','Price Expectation','Approved Offer Amount','Counteroffer Amount']
    .forEach(function(h){ sh.getRange(first, col(h), last-first+1, 1).setNumberFormat('$#,##0'); });
  // integer columns (must NOT inherit a date format)
  ['Days Since Last Activity','Days Overdue','Opportunity Priority']
    .forEach(function(h){ sh.getRange(first, col(h), last-first+1, 1).setNumberFormat('0'); });
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
        addr = colL('Property Address'), src = colL('Source');

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
    // live Board excludes Source=TEST records (they live in the Test Data sheet)
    const q = '=IFERROR(QUERY(' + CFG.DATA_SHEET + '!A' + CFG.FIRST_DATA_ROW + ':BZ' + CFG.MAX_ROWS + ',' +
      '"select ' + sel + ' where ' + addr + ' is not null and ' + src + " <> 'TEST' and " + s[1] + ' order by ' + s[2] +
      ' limit 50",0),"— none —")';
    sh.getRange(row,1).setFormula(q);
    row += 8;
  });
  // Deterministic display formats: Due (display col 6/F) as a date, Days Overdue (col 7/G) as integer.
  sh.getRange(1, 6, sh.getMaxRows(), 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(1, 7, sh.getMaxRows(), 1).setNumberFormat('0');
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
  const dq = colL('Data Quality Status'), addr = colL('Property Address'), src = colL('Source');
  // live Exception Queue excludes Source=TEST (test exceptions show only in the Test Data sheet)
  const q = '=IFERROR(QUERY(' + CFG.DATA_SHEET + '!A' + CFG.FIRST_DATA_ROW + ':BZ' + CFG.MAX_ROWS + ',' +
    '"select ' + sel + ' where ' + addr + ' is not null and ' + src + " <> 'TEST' and (" + dq + "='Incomplete' or " + dq + "='Exception') order by " + dq + '",0),"— none —")';
  sh.getRange(4,1).setFormula(q);
  sh.setTabColor('#990000');
}

/** Documents the legacy -> new field mapping used during pilot migration. */
function buildMigrationLog_(ss) {
  const sh = ensureSheet_(ss, CFG.MIGRATION_SHEET);
  sh.clear();
  sh.setTabColor('#bf9000');
  const rows = [
    ['Legacy field','New field(s)','Mapping rule','Confidence / notes'],
    ['Address','Property Address (+ Normalized Address)','Copied verbatim; Normalized Address computed','High'],
    ['Name','Seller Name','Copied verbatim','High'],
    ['Phone','Phone','Copied verbatim','High'],
    ['Lead Source','Lead Source','Values already match the new dropdown','High'],
    ['Appointment date / col A','Visit Date','Copied','High'],
    ['Inspection Status','Visit Status','Inspected→Completed; Pending Inspection→Scheduled; Cancelled→Canceled; Skipped-offer-made→Completed','High'],
    ['Inspector','Assigned Visitor','Juan Diaz→Juan; Cesar→Cesar; others kept in visitor list','Medium'],
    ['Closer / Agent','Assigned Owner','Cherry→Cherry; Juan Diaz→Juan; blank/other left blank → Exception Queue','Low where blank'],
    ['Deal Stage + Deal Status','Current Stage (+ Final Disposition)','See docs/Data-Dictionary.md stage table','Medium — uncertain → Exception Queue'],
    ['Status Update (prose)','Last Contact Result / Next Action / Visit Notes','Clear next-step → Next Action; full text → Visit Notes; ambiguous → Exception','Low — never guessed'],
    ['Notes','Visit Notes / Seller Motivation','Notes→Visit Notes; motivation only when explicit','Medium'],
    ['Golden Needle (unused)','(dropped)','Audit-flagged unused; not migrated','n/a'],
    ['Contract (dropdown)','Final Disposition / Transaction Handoff Status','Acquired→Contracted; Cancelled Contract→Lost; Under Contract→context','Medium'],
    ['', '', '', ''],
    ['PILOT ROWS WITH INTENTIONALLY-MISSING DATA (complete manually from REI BlackBook):','','',''],
    ['TVL-0001 / TVL-0002','REI BlackBook Link','Not present in legacy data — DO NOT invent; enter from REI BlackBook','Manual'],
    ['TVL-0003 / TVL-0009','REI BlackBook Link, Approved Offer Amount, Offer Sent Date','Not present in legacy data — DO NOT invent; enter from REI BlackBook','Manual'],
  ];
  sh.getRange(1,1,rows.length,4).setValues(rows);
  sh.getRange(1,1,1,4).setFontWeight('bold').setFontColor('#ffffff').setBackground('#bf9000');
  sh.getRange(16,1,1,4).setFontWeight('bold');
  sh.setColumnWidth(1,26*8); sh.setColumnWidth(2,34*8); sh.setColumnWidth(3,52*8); sh.setColumnWidth(4,30*8);
  sh.getRange(1,1,rows.length,4).setWrap(true).setVerticalAlignment('top');
}

/** Read-only view of Source=TEST records, kept OFF the live Board/Exception Queue. */
function buildTestDataSheet_(ss) {
  const sh = ensureSheet_(ss, CFG.TEST_DATA_SHEET);
  sh.clear();
  sh.setTabColor('#999999');
  sh.getRange(1,1).setValue('Test Data — Source = TEST records only (excluded from the live Board, Exception Queue & Daily Report)')
    .setFontWeight('bold').setFontSize(12);
  const disp = ['Property ID','Property Address','Seller Name','Current Stage','Assigned Owner',
                'Next Action Due Date','Days Overdue','Stalled Status','Data Quality Status','Exception Reason'];
  sh.getRange(3,1,1,disp.length).setValues([disp]).setFontWeight('bold').setBackground('#ddebf7');
  const sel = disp.map(colL).join(',');
  const src = colL('Source'), addr = colL('Property Address');
  const q = '=IFERROR(QUERY(' + CFG.DATA_SHEET + '!A' + CFG.FIRST_DATA_ROW + ':BZ' + CFG.MAX_ROWS + ',' +
    '"select ' + sel + ' where ' + addr + ' is not null and ' + src + " = 'TEST' order by " + colL('Current Stage') + '",0),"— none —")';
  sh.getRange(4,1).setFormula(q);
  sh.getRange(1, 6, sh.getMaxRows(), 1).setNumberFormat('yyyy-mm-dd'); // Due
  sh.getRange(1, 7, sh.getMaxRows(), 1).setNumberFormat('0');          // Days Overdue
}

/** Visible internal task-delivery sheet (the pilot task inbox for the team). */
function ensureTaskQueue_(ss) {
  let sh = ss.getSheetByName(CFG.TASK_QUEUE_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CFG.TASK_QUEUE_SHEET);
    sh.appendRow(['Created','Owner','Property ID','Address','Task','Due','Status']);
    sh.getRange(1,1,1,7).setFontWeight('bold').setFontColor('#ffffff').setBackground('#38761d');
    sh.setFrozenRows(1);
    sh.setColumnWidth(4, 240); sh.setColumnWidth(5, 320);
  }
  sh.setTabColor('#38761d');
  return sh;
}

/* ========================= LoadData.gs ========================= */

/**
 * Twin Visit Logger — pilot/test data loader (menu: "Load pilot + test data").
 * Writes the 10 migrated pilot records + demo test records into the Data sheet,
 * leaving the formula columns intact (they recompute). Idempotent: it overwrites
 * from row 2 down for exactly the SEED rows. Use clearAllData() to wipe them.
 */
var SEED = [
  {"Property ID":"TVL-0001", "Property Address":"2607 Gimelli Pl, Apt 115, San Jose, CA 95133", "Seller Name":"Cyn Ku", "Phone":"(510) 284-7867", "Lead Source":"PPL - Property Leads", "Visit Date":new Date(2026,6,24), "Visit Status":"Scheduled", "Assigned Visitor":"Juan", "Visit Notes":"Cyn still interested in selling; 2nd property she wants to sell to us.", "Current Stage":"Visit Scheduled", "Next Action":"Conduct scheduled visit & log outcome", "Next Action Due Date":new Date(2026,6,24), "Assigned Owner":"Juan", "Created Date":new Date(2026,6,24), "Last Updated Date":new Date(2026,6,24), "Updated By":"Import", "Source":"Import", "REI Update Required":"Yes"},
  {"Property ID":"TVL-0002", "Property Address":"1253 Edgewood Rd, Redwood City, CA 94062", "Seller Name":"Steve Giorgi", "Phone":"(650) 333-8189", "Lead Source":"PPL - Property Leads", "Visit Date":new Date(2026,6,22), "Visit Status":"Scheduled", "Assigned Visitor":"Juan", "Visit Notes":"Appointment booked; note outcome after visit.", "Current Stage":"Visit Scheduled", "Next Action":"Conduct scheduled visit & log outcome", "Next Action Due Date":new Date(2026,6,22), "Assigned Owner":"Juan", "Created Date":new Date(2026,6,22), "Last Updated Date":new Date(2026,6,22), "Updated By":"Import", "Source":"Import", "REI Update Required":"Yes"},
  {"Property ID":"TVL-0003", "Property Address":"519 S 17th St, Richmond, CA 94804", "Seller Name":"Carmen Green", "Phone":"(916) 752-5759", "Lead Source":"PPL - Motivated Leads", "Visit Date":new Date(2026,6,20), "Visit Status":"Completed", "Assigned Visitor":"Juan", "Visit Notes":"Offer sent via email + SignNow contract; Juan following up directly.", "Seller Motivation":"Interested in selling (motivation detail not captured in legacy)", "Current Stage":"Offer Sent", "Offer Status":"Sent", "Next Action":"Follow up on sent offer", "Next Action Due Date":new Date(2026,6,23), "Assigned Owner":"Juan", "Last Contact Date":new Date(2026,6,20), "Last Contact Result":"Offer emailed; awaiting seller response", "Created Date":new Date(2026,6,20), "Last Updated Date":new Date(2026,6,20), "Updated By":"Import", "Source":"Import", "REI Update Required":"Yes"},
  {"Property ID":"TVL-0004", "Property Address":"5 Lancaster Cir Apt 121, Bay Point, CA 94565", "Seller Name":"Dorol Conrad", "Phone":"(415) 370-9841", "Lead Source":"PPL - Property Leads", "Visit Date":new Date(2026,6,20), "Visit Status":"Canceled", "Visit Notes":"Equity 100% but property already listed on the MLS.", "Current Stage":"Lost / Closed Out", "Final Disposition":"Lost", "Closeout Reason":"We're Passing — already listed on MLS", "Created Date":new Date(2026,6,20), "Last Updated Date":new Date(2026,6,20), "Updated By":"Import", "Source":"Import"},
  {"Property ID":"TVL-0005", "Property Address":"15340 Canyon 2 Rd, Guerneville, CA 95446", "Seller Name":"Jon Box", "Phone":"(707) 481-7040", "Lead Source":"PPL - Property Leads", "Visit Date":new Date(2026,6,20), "Visit Status":"Canceled", "Assigned Visitor":"Juan", "Visit Notes":"Passing on this lead.", "Current Stage":"Lost / Closed Out", "Final Disposition":"Lost", "Closeout Reason":"We're Passing", "Created Date":new Date(2026,6,18), "Last Updated Date":new Date(2026,6,18), "Updated By":"Import", "Source":"Import"},
  {"Property ID":"TVL-0006", "Property Address":"18 Hampton Rd, Occidental, CA 95465", "Seller Name":"Chris J. Giro", "Phone":"(707) 292-9001", "Lead Source":"PPC", "Visit Date":new Date(2026,6,18), "Visit Status":"Completed", "Assigned Visitor":"Juan", "Visit Notes":"House is structurally failing; passing.", "Seller Motivation":"Motivated but property condition too poor for our criteria", "Current Stage":"Lost / Closed Out", "Final Disposition":"Lost", "Closeout Reason":"We're Passing — structural condition", "Created Date":new Date(2026,6,16), "Last Updated Date":new Date(2026,6,18), "Updated By":"Import", "Source":"Import"},
  {"Property ID":"TVL-0007", "Property Address":"4107 Randolph Ave, Oakland, CA 94602", "Seller Name":"Yvette D Rose", "Phone":"(510) 457-6727", "Lead Source":"TV", "Visit Date":new Date(2026,6,18), "Visit Status":"Completed", "Visit Notes":"Heavily tenant-occupied; City of Oakland code violations.", "Seller Motivation":"Good location but tenant/code issues; passing", "Occupancy Status":"Tenant-Occupied", "Blocker":"Tenant", "Current Stage":"Lost / Closed Out", "Final Disposition":"Lost", "Closeout Reason":"We're Passing — tenant-occupied + code violations", "Created Date":new Date(2026,6,16), "Last Updated Date":new Date(2026,6,17), "Updated By":"Import", "Source":"Import"},
  {"Property ID":"TVL-0008", "Property Address":"16125 Bittner Rd, Occidental, CA 95465", "Seller Name":"Liam", "Phone":"(530) 545-1943", "Lead Source":"PPL - Property Leads", "Visit Date":new Date(2026,6,15), "Visit Status":"Canceled", "Visit Notes":"Internal cancellation of confirmed visit; passing.", "Current Stage":"Lost / Closed Out", "Final Disposition":"Lost", "Closeout Reason":"We're Passing — internal cancellation", "Created Date":new Date(2026,6,15), "Last Updated Date":new Date(2026,6,15), "Updated By":"Import", "Source":"Import"},
  {"Property ID":"TVL-0009", "Property Address":"39224 Guardino Dr Apt 208, Fremont, CA 94538", "Seller Name":"James White", "Phone":"(209) 221-1240", "Lead Source":"PPL - Property Leads", "Visit Date":new Date(2026,6,14), "Visit Status":"Completed", "Assigned Visitor":"Cesar", "Visit Notes":"Offer emailed; James (trustee) + sister Lisa reviewing together. Cherry following up.", "Seller Motivation":"Trustee sale; reviewing offer with family", "Current Stage":"Offer Sent", "Offer Status":"Sent", "Next Action":"Follow up on offer with James/Lisa", "Next Action Due Date":new Date(2026,6,17), "Assigned Owner":"Cherry", "Last Contact Date":new Date(2026,6,15), "Last Contact Result":"Cherry emailing offer breakdown; family reviewing", "Blocker":"Family", "Created Date":new Date(2026,6,14), "Last Updated Date":new Date(2026,6,15), "Updated By":"Import", "Source":"Import", "REI Update Required":"Yes"},
  {"Property ID":"TVL-0010", "Property Address":"1323 Oxford St, Berkeley, CA 94709", "Seller Name":"Mark Lempert", "Phone":"(510) 816-1221", "Lead Source":"Direct Mail - Postcard", "Visit Date":new Date(2026,6,13), "Visit Status":"Completed", "Assigned Visitor":"Cesar", "Visit Notes":"SERVICE FAILURE: walkthrough done 7/13 but no offer ever sent; seller displeased.", "Seller Motivation":"Was open to offer; lost due to our delay/no-offer", "Current Stage":"Lost / Closed Out", "Final Disposition":"Lost", "Closeout Reason":"Did Not Proceed — service failure (no offer sent)", "Blocker":"Documents", "Created Date":new Date(2026,6,13), "Last Updated Date":new Date(2026,6,15), "Updated By":"Import", "Source":"Import"},
  {"Property ID":"TEST-01", "Property Address":"100 Test Verbal Ln, Testville, CA 90001", "Seller Name":"Val Verbal", "Phone":"(000) 000-0001", "Lead Source":"PPC", "REI BlackBook Link":"https://app.reiblackbook.com/lead/test01", "Visit Date":new Date(2026,6,18), "Visit Status":"Completed", "Assigned Visitor":"Juan", "Visit Notes":"Great condition; seller keen.", "Seller Motivation":"Relocating for job — motivated", "Approved Offer Amount":640000, "Offer Status":"Accepted", "Offer Sent Date":new Date(2026,6,19), "Current Stage":"Verbal Agreement", "Next Action":"Prepare purchase contract", "Next Action Due Date":new Date(2026,6,23), "Assigned Owner":"Kyle", "Last Contact Date":new Date(2026,6,21), "Last Contact Result":"Seller verbally agreed to $640k", "Created Date":new Date(2026,6,18), "Last Updated Date":new Date(2026,6,21), "Updated By":"Cherry", "Source":"TEST", "REI Update Required":"Yes"},
  {"Property ID":"TEST-02", "Property Address":"200 Test Contract Sent Ave, Testville, CA 90002", "Seller Name":"Sam Sent", "Phone":"(000) 000-0002", "Lead Source":"TV", "REI BlackBook Link":"https://app.reiblackbook.com/lead/test02", "Visit Date":new Date(2026,6,15), "Visit Status":"Completed", "Assigned Visitor":"Juan", "Visit Notes":"Clean title; ready to move.", "Seller Motivation":"Downsizing — motivated", "Approved Offer Amount":720000, "Offer Status":"Accepted", "Offer Sent Date":new Date(2026,6,16), "Current Stage":"Contract Sent", "Contract Sent Date":new Date(2026,6,20), "File Link":"https://drive.google.com/test02-contract", "Next Action":"Confirm signature", "Next Action Due Date":new Date(2026,6,22), "Assigned Owner":"Cherry", "Last Contact Date":new Date(2026,6,21), "Last Contact Result":"Seller reviewing contract", "Created Date":new Date(2026,6,15), "Last Updated Date":new Date(2026,6,21), "Updated By":"Cherry", "Source":"TEST", "REI Update Required":"Yes"},
  {"Property ID":"TEST-03", "Property Address":"300 Test Signed Blvd, Testville, CA 90003", "Seller Name":"Sid Signed", "Phone":"(000) 000-0003", "Lead Source":"Direct Mail", "REI BlackBook Link":"https://app.reiblackbook.com/lead/test03", "Visit Date":new Date(2026,6,10), "Visit Status":"Completed", "Assigned Visitor":"Juan", "Visit Notes":"Signed.", "Seller Motivation":"Estate sale — motivated", "Approved Offer Amount":555000, "Offer Status":"Accepted", "Offer Sent Date":new Date(2026,6,11), "Current Stage":"Contract Signed", "Final Disposition":"Contracted", "Contract Sent Date":new Date(2026,6,14), "Contract Signed Date":new Date(2026,6,18), "Transaction Handoff Status":"Ready for Handoff", "Next Action":"Hand off signed contract to JM", "Next Action Due Date":new Date(2026,6,20), "Assigned Owner":"JM", "Last Contact Date":new Date(2026,6,18), "Last Contact Result":"Contract signed", "Created Date":new Date(2026,6,10), "Last Updated Date":new Date(2026,6,18), "Updated By":"Cherry", "Source":"TEST", "REI Update Required":"Yes"},
  {"Property ID":"TEST-04", "Property Address":"400 Test Needs Review St, Testville, CA 90004", "Seller Name":"Nia Needs-Review", "Phone":"(000) 000-0004", "Lead Source":"PPC", "REI BlackBook Link":"https://app.reiblackbook.com/lead/test04", "Visit Date":new Date(2026,6,21), "Visit Status":"Completed", "Assigned Visitor":"Juan", "Visit Notes":"Visit done; needs offer/pass decision.", "Seller Motivation":"Job relocation", "Current Stage":"Visit Completed — Needs Review", "Next Action":"Decide: make offer or pass", "Next Action Due Date":new Date(2026,6,21), "Assigned Owner":"Jonathan", "Last Contact Date":new Date(2026,6,21), "Last Contact Result":"Walkthrough complete", "Created Date":new Date(2026,6,21), "Last Updated Date":new Date(2026,6,21), "Updated By":"Jonathan", "Source":"TEST", "REI Update Required":"Yes"},
  {"Property ID":"TEST-05", "Property Address":"500 Test Nurture Way, Testville, CA 90005", "Seller Name":"Nora Nurture", "Phone":"(000) 000-0005", "Lead Source":"SEO", "REI BlackBook Link":"https://app.reiblackbook.com/lead/test05", "Visit Date":new Date(2026,5,20), "Visit Status":"Completed", "Assigned Visitor":"Juan", "Visit Notes":"Not ready yet; call back in ~60 days.", "Seller Motivation":"Will sell later this year", "Current Stage":"Long-Term Nurture", "Next Action":"Nurture check-in call", "Next Action Due Date":new Date(2026,8,20), "Assigned Owner":"Cherry", "Last Contact Date":new Date(2026,5,20), "Last Contact Result":"Asked for callback in 60 days", "Gift Status":"Recommended", "Gift Recommendation Reason":"Strong rapport; long-term seller", "Created Date":new Date(2026,5,20), "Last Updated Date":new Date(2026,5,20), "Updated By":"Cherry", "Source":"TEST", "REI Update Required":"Yes"},
  {"Property ID":"TEST-06", "Property Address":"600 Test Stalled Ct, Testville, CA 90006", "Seller Name":"Stan Stalled", "Phone":"(000) 000-0006", "Lead Source":"PPC", "REI BlackBook Link":"https://app.reiblackbook.com/lead/test06", "Visit Date":new Date(2026,6,1), "Visit Status":"Completed", "Assigned Visitor":"Juan", "Visit Notes":"Offer sent; seller gone quiet.", "Seller Motivation":"Was motivated; now unresponsive", "Approved Offer Amount":500000, "Offer Status":"Sent", "Offer Sent Date":new Date(2026,6,2), "Current Stage":"Offer Sent", "Next Action":"Re-attempt contact", "Next Action Due Date":new Date(2026,6,8), "Assigned Owner":"Juan", "Blocker":"Seller Unresponsive", "Last Contact Date":new Date(2026,6,2), "Last Contact Result":"Offer sent; no reply since", "Created Date":new Date(2026,6,1), "Last Updated Date":new Date(2026,6,2), "Updated By":"Juan", "Source":"TEST", "REI Update Required":"Yes"},
  {"Property ID":"TEST-07", "Property Address":"700 Test Negotiation Rd, Testville, CA 90007", "Seller Name":"Neil Negotiate", "Phone":"(000) 000-0007", "Lead Source":"TV", "REI BlackBook Link":"https://app.reiblackbook.com/lead/test07", "Visit Date":new Date(2026,6,16), "Visit Status":"Completed", "Assigned Visitor":"Juan", "Visit Notes":"Seller countered.", "Seller Motivation":"Motivated but wants more money", "Approved Offer Amount":610000, "Offer Status":"Countered", "Offer Sent Date":new Date(2026,6,17), "Counteroffer Amount":660000, "Current Stage":"Active Negotiation", "Next Action":"Cherry/Juan decide counter response", "Next Action Due Date":new Date(2026,6,22), "Assigned Owner":"Cherry", "Blocker":"Price", "Last Contact Date":new Date(2026,6,21), "Last Contact Result":"Seller countered at $660k", "Created Date":new Date(2026,6,16), "Last Updated Date":new Date(2026,6,21), "Updated By":"Cherry", "Source":"TEST", "REI Update Required":"Yes"},
  {"Property ID":"TEST-08", "Property Address":"700 Test Negotiation Rd., Testville, CA 90007", "Seller Name":"Duplicate Entry", "Phone":"(000) 000-0008", "Lead Source":"TV", "REI BlackBook Link":"https://app.reiblackbook.com/lead/test08", "Visit Date":new Date(2026,6,16), "Visit Status":"Scheduled", "Assigned Visitor":"Juan", "Current Stage":"Visit Scheduled", "Next Action":"Verify duplicate", "Next Action Due Date":new Date(2026,6,23), "Assigned Owner":"Cherry", "Created Date":new Date(2026,6,16), "Last Updated Date":new Date(2026,6,16), "Updated By":"Cherry", "Source":"TEST", "REI Update Required":"Yes"},
  {"Property ID":"TEST-09", "Property Address":"900 Test Revival Dr, Testville, CA 90009", "Seller Name":"Rita Revival", "Phone":"(000) 000-0009", "Lead Source":"Direct Mail", "REI BlackBook Link":"https://app.reiblackbook.com/lead/test09", "Visit Date":new Date(2026,3,1), "Visit Status":"Completed", "Assigned Visitor":"Juan", "Visit Notes":"Passed in spring; seller wanted more than numbers allowed.", "Seller Motivation":"Was motivated; timing/price gap at the time", "Current Stage":"Lost / Closed Out", "Final Disposition":"Lost", "Closeout Reason":"Seller Rejected Offer — price gap (revisit later)", "Last Contact Date":new Date(2026,3,3), "Last Contact Result":"Seller declined; open to future contact", "Created Date":new Date(2026,3,1), "Last Updated Date":new Date(2026,3,3), "Updated By":"Cherry", "Source":"TEST"}
];

function loadPilotData() {
  const sh = dataSheet_();
  if (!sh) { SpreadsheetApp.getUi().alert('Run "Build structure (setup)" first.'); return; }
  const start = CFG.FIRST_DATA_ROW;
  var skipped = [];
  SEED.forEach(function(rec, i){
    const row = start + i;
    Object.keys(rec).forEach(function(h){
      try { sh.getRange(row, col(h)).setValue(rec[h]); }
      catch (e) { skipped.push(rec['Property ID'] + '/' + h); }  // never let one cell abort the load
    });
  });
  SpreadsheetApp.flush();
  const msg = SEED.length + ' pilot + test rows loaded.' + (skipped.length ? ' Skipped: ' + skipped.join(', ') : '');
  SpreadsheetApp.getActive().toast(msg + ' Check the Cherry Opportunity Board.', 'Twin Visit Logger', 8);
}

/**
 * Remove ONLY Source=TEST records (demo + harness rows), in place. Does NOT delete sheet
 * rows and does NOT affect formulas/validation/formatting — each matching row is cleared and
 * its computed formulas restored via clearRecordRow_. Real pilot rows (Source=Import) are kept.
 */
function removeTestData() {
  const sh = dataSheet_();
  if (!sh) return;
  const src = sh.getRange(CFG.FIRST_DATA_ROW, col('Source'), CFG.MAX_ROWS - 1, 1).getValues();
  var n = 0;
  for (var i = 0; i < src.length; i++) {
    if (String(src[i][0]).trim() === 'TEST') { clearRecordRow_(sh, CFG.FIRST_DATA_ROW + i); n++; }
  }
  SpreadsheetApp.getActive().toast('Removed ' + n + ' Source=TEST records (rows, formulas, validation & formatting preserved).', 'Twin Visit Logger', 7);
}

/** Clears data values from row 2 down (keeps headers + formula columns' formulas). */
function clearAllData() {
  const sh = dataSheet_();
  const last = Math.max(sh.getLastRow(), CFG.FIRST_DATA_ROW);
  const nonFormula = [];
  for (var i = 0; i < HEADERS.length; i++) if (COMPUTED_HEADERS.indexOf(HEADERS[i]) < 0) nonFormula.push(i + 1);
  nonFormula.forEach(function(c){ sh.getRange(CFG.FIRST_DATA_ROW, c, last - 1, 1).clearContent(); });
  SpreadsheetApp.getActive().toast('Data rows cleared (headers + formulas kept).', 'Twin Visit Logger', 6);
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
    // Real reminder: a Task Queue item (not just a log line) for the visitor, due on the visit date.
    var visitor = R.get('Assigned Visitor') || R.get('Assigned Owner') || 'Juan';
    enqueueTask_(visitor, R.get('Property ID'), R.get('Property Address'),
      'Scheduled-visit reminder — conduct visit & log outcome', R.get('Visit Date') || today_());
    logAuto_('INFO', R.get('Property ID'), 'Visit scheduled; reminder queued for ' + visitor + ' due ' + fmt_(R.get('Visit Date')));
  } else if (v === 'Completed') {
    R.set('Current Stage', 'Visit Completed — Needs Review');
    R.setIfBlank('Assigned Owner', 'Jonathan');
    R.set('Next Action Due Date', today_());          // same-day review
    R.setIfBlank('Next Action', 'Review completed visit: make offer or pass');
    if (!R.get('Visit Notes')) logAuto_('EXCEPTION', R.get('Property ID'), 'Completed visit missing Visit Notes');
    enqueueTask_('Jonathan', R.get('Property ID'), R.get('Property Address'), 'Review completed visit: make offer or pass', today_());
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
  enqueueTask_('Kyle', R.get('Property ID'), R.get('Property Address'),
    'Prepare offer (' + money_(R.get('Approved Offer Amount')) + ') — REI ' + (R.get('REI BlackBook Link') || 'n/a'),
    R.get('Next Action Due Date'));
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
  enqueueTask_(R.get('Assigned Owner') || 'Cherry', R.get('Property ID'), R.get('Property Address'),
    'Follow up on sent offer', R.get('Next Action Due Date'));
  logAuto_('TASK', R.get('Property ID'), 'Offer follow-up scheduled ' + fmt_(R.get('Next Action Due Date')));
}

function onSellerCounter_(R) {
  R.set('Current Stage', 'Active Negotiation');
  R.setIfBlank('Assigned Owner', 'Cherry');
  R.setIfBlank('Next Action', 'Decide response to seller counter');
  R.setIfBlank('Next Action Due Date', addBiz_(today_(), 1));
  enqueueTask_(R.get('Assigned Owner') || 'Cherry', R.get('Property ID'), R.get('Property Address'),
    'Negotiation decision — respond to seller counter (needs Last Contact Result + Next Action + Owner + Due)', R.get('Next Action Due Date'));
  logAuto_('NOTIFY', R.get('Property ID'), 'Negotiation: notify Cherry/Juan. Requires Last Contact Result + Next Action + Owner + Due.');
}

function onVerbalAgreement_(R) {
  R.set('Current Stage', 'Verbal Agreement');
  R.set('Assigned Owner', 'Kyle');
  R.set('Next Action', 'Prepare purchase contract');
  R.setIfBlank('Next Action Due Date', addBiz_(today_(), 1));
  enqueueTask_('Kyle', R.get('Property ID'), R.get('Property Address'), 'HIGHEST PRIORITY: prepare purchase contract', R.get('Next Action Due Date'));
  logAuto_('TASK', R.get('Property ID'), 'HIGHEST PRIORITY: contract-prep -> Kyle');
}

function onContractSent_(R) {
  if (!R.get('Contract Sent Date')) return;
  R.set('Current Stage', 'Contract Sent');
  R.set('Next Action', 'Confirm signature (daily internal follow-up)');
  R.set('Next Action Due Date', addBiz_(today_(), 1));
  enqueueTask_(R.get('Assigned Owner') || 'Cherry', R.get('Property ID'), R.get('Property Address'),
    'Confirm signature — daily internal follow-up until signed/declined', R.get('Next Action Due Date'));
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
  enqueueTask_('JM', R.get('Property ID'), R.get('Property Address'), 'Contract handoff — signed; also confirm REI BlackBook update', R.get('Next Action Due Date'));
  logAuto_('TASK', R.get('Property ID'), 'JM HANDOFF created; sales follow-up stopped; REI update required');
}

function onGiftRecommended_(R) {
  // Approval is recorded via Gift Approved By + Gift Approval Date; Gift Status=Sent stays an
  // Exception until both are filled (see Exception Reason rule 9). Nothing is purchased or sent.
  enqueueTask_('Kyle', R.get('Property ID'), R.get('Property Address'),
    'Coordinate gift review — requires Cherry/Juan approval (set Gift Approved By + Gift Approval Date). NO gift sent automatically.', '');
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
        enqueueTask_('Cherry', R.get('Property ID'), R.get('Property Address'),
          'ESCALATED: completed visit has no offer/pass decision after 1 business day (Jonathan still reviewer)', today_());
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
      enqueueTask_(R.get('Assigned Owner') || 'Cherry', R.get('Property ID'), R.get('Property Address'),
        'STALLED > 3 business days — re-engage this deal', R.get('Next Action Due Date') || today_());
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
function daysAgo_(n) { const d = today_(); d.setDate(d.getDate() - n); return d; }
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

/**
 * INTERNAL task delivery. Appends a visible row to the Task Queue sheet (the pilot task inbox)
 * and, only if an INTERNAL address is set in OWNER_EMAILS, emails that person. Never a seller.
 */
function enqueueTask_(owner, id, address, task, due) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(CFG.TASK_QUEUE_SHEET) || ensureTaskQueue_(ss);
  sh.appendRow([new Date(), owner || 'Unassigned', id || '', address || '', task || '', due ? fmt_(due) : '', 'Open']);
  const to = OWNER_EMAILS[owner];
  if (to) {
    try {
      MailApp.sendEmail({ to: to,
        subject: 'Twin Visit Logger task: ' + task + ' — ' + (address || id),
        body: 'Owner: ' + owner + '\nProperty: ' + (address || id) + '\nTask: ' + task +
              '\nDue: ' + (due ? fmt_(due) : '—') + '\n\n(Internal task only. No seller was contacted.)' });
    } catch (e) { logAuto_('ERROR', 'enqueueTask', String(e)); }
  }
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
  this.flush = function(){ const cols=Object.keys(this._dirty); cols.forEach(function(c){ try { this.sh.getRange(this.row, Number(c)).setValue(this._dirty[c]); } catch(e){} }, this); this._dirty={}; };
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
  // Business days only for the scheduled trigger; manual/preview runs still build the sheet.
  const sections = reportSections_();
  const total = sections.reduce(function(n,s){ return n + s.rows.length; }, 0);
  const sendEmpty = false;

  writeReportSheet_(sections, total);           // always refresh the Daily Report sheet
  let emailed = false;
  if (CFG.REPORT_TO && !(total === 0 && !sendEmpty)) {
    const html = renderReportHtml_(sections, total);
    MailApp.sendEmail({ to: CFG.REPORT_TO, subject: CFG.REPORT_TITLE + ' — ' + fmt_(today_()), htmlBody: html });
    emailed = true;
  }
  logAuto_('REPORT', '', 'Daily report built (' + total + ' actionable). Emailed=' + emailed + (CFG.REPORT_TO ? '' : ' (REPORT_TO blank — no email)'));
  return { emailed: emailed, total: total, recipient: CFG.REPORT_TO || '(none)' };
}

/** The 10 report sections, computed from Data (same logic as the Board). */
function reportSections_() {
  const rows = readAllRows_();
  // live report excludes Source=TEST demo records
  const active = rows.filter(function(r){ return r['Property Address'] && r['Source'] !== 'TEST'; });
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

/** First row (>=2, within the formula range) whose Property Address is blank. */
function firstEmptyDataRow_(sh) {
  const vals = sh.getRange(CFG.FIRST_DATA_ROW, col('Property Address'), CFG.MAX_ROWS - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]).trim() === '') return CFG.FIRST_DATA_ROW + i;
  return CFG.FIRST_DATA_ROW;
}

function runAllTests() {
  const results = [];
  const sh = dataSheet_();
  // Place test rows INSIDE the formula range (formulas fill rows 2..MAX_ROWS), not past getLastRow().
  const startRow = firstEmptyDataRow_(sh);
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

  // 5. Completed visit with no offer/pass decision after 1 business day -> escalation task/log
  let nd = newRow({'Property ID':'TEST-A11','Property Address':'11 Auto Test St','Seller Name':'No Decision','REI BlackBook Link':'https://rei/a11','Visit Notes':'done','Seller Motivation':'m','Current Stage':'Visit Completed — Needs Review','Assigned Owner':'Jonathan','Visit Date':daysAgo_(5),'Source':'TEST'});
  checkNoDecision(); SpreadsheetApp.flush();
  assert('5. No offer decision >1 biz day -> escalate to Cherry', logHas_('ESCALATE','TEST-A11'), 'Automation Log ESCALATE present');

  // 12. Stalled status + alert after 3 business days
  let stl = newRow({'Property ID':'TEST-A12','Property Address':'12 Auto Test St','Seller Name':'Stall Test','REI BlackBook Link':'https://rei/a12','Visit Notes':'x','Seller Motivation':'m','Current Stage':'Offer Sent','Assigned Owner':'Juan','Approved Offer Amount':100000,'Offer Sent Date':daysAgo_(9),'Last Contact Date':daysAgo_(9),'Next Action':'follow','Next Action Due Date':daysAgo_(4),'Source':'TEST'});
  SpreadsheetApp.flush();
  assert('12. Stalled Status = Yes after 3 biz days', new RowAccessor_(sh,stl.row).get('Stalled Status')==='Yes', new RowAccessor_(sh,stl.row).get('Stalled Status'));
  checkStalled(); SpreadsheetApp.flush();
  assert('12b. Stalled alert task queued', logHas_('NOTIFY','TEST-A12'), 'Automation Log NOTIFY present');

  // REI Update Required handling: contract signed sets it to Yes
  let rei = newRow({'Property ID':'TEST-A13','Property Address':'13 Auto Test St','Seller Name':'Rei Test','REI BlackBook Link':'https://rei/a13','Source':'TEST'});
  rei = edit(rei, 'Contract Signed Date', today_());
  assert('REI. Contract signed -> REI Update Required = Yes', rei.get('REI Update Required')==='Yes', rei.get('REI Update Required'));

  // Daily Report creation + no email while REPORT_TO blank
  const savedTo = CFG.REPORT_TO; CFG.REPORT_TO = '';
  const rep = sendDailyReport();
  const hasSheet = !!SpreadsheetApp.getActive().getSheetByName('Daily Report');
  assert('DR. Daily Report sheet created', hasSheet, 'sheet present');
  assert('NoEmail. sendDailyReport sent NO email while REPORT_TO blank', rep && rep.emailed === false, 'emailed=' + (rep && rep.emailed));
  CFG.REPORT_TO = savedTo;

  // No seller messaging: only config recipients (REPORT_TO / OWNER_EMAILS) are ever used, never seller fields
  const noSeller = (CFG.REPORT_TO === '' || CFG.REPORT_TO.indexOf('@') > 0) &&
                   Object.keys(OWNER_EMAILS).every(function(k){ return OWNER_EMAILS[k] === '' || OWNER_EMAILS[k].indexOf('@') > 0; });
  assert('18. No seller messaging (recipients are config-only, never seller Email/Phone)', noSeller, 'config recipients only');

  // Triggers: safe check (full install/remove cycle is the separate testTriggerCycle())
  removeAllTriggers();
  assert('Trig. removeAllTriggers -> 0 (run testTriggerCycle for full install/remove)', ScriptApp.getProjectTriggers().length === 0 && typeof installTriggers === 'function', 'triggers cleared');

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

/**
 * Clear TEST-A* harness rows IN PLACE (no deleteRow) so the formula/validation/format ranges
 * never shrink; computed formulas are restored for each cleared row.
 */
function cleanupTests_() {
  const sh = dataSheet_();
  const ids = sh.getRange(CFG.FIRST_DATA_ROW, col('Property ID'), CFG.MAX_ROWS - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).indexOf('TEST-A') === 0) clearRecordRow_(sh, CFG.FIRST_DATA_ROW + i);
  }
}

/** True if the Automation Log has a row with the given level for the given Property ID. */
function logHas_(level, id) {
  const sh = SpreadsheetApp.getActive().getSheetByName('Automation Log');
  if (!sh) return false;
  const v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][1]) === level && String(v[i][2]) === id) return true;
  return false;
}

/**
 * SEPARATE, opt-in test for trigger install + removal. Not part of runAllTests() because it
 * briefly creates real triggers. It installs, verifies 4 exist, then removes all and verifies 0.
 * Run manually only when you want to test the trigger lifecycle.
 */
function testTriggerCycle() {
  installTriggers();
  const mid = ScriptApp.getProjectTriggers().length;
  removeAllTriggers();
  const after = ScriptApp.getProjectTriggers().length;
  const pass = (mid >= 4 && after === 0);
  SpreadsheetApp.getActive().toast('Trigger cycle: installed=' + mid + ', afterRemove=' + after + ' => ' + (pass ? 'PASS' : 'FAIL'), 'Twin Visit Logger', 8);
  return pass;
}
