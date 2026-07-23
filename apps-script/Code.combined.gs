/**
 * ================================================================
 *  TWIN VISIT LOGGER — SINGLE-FILE BUILD (paste this whole file)
 * ================================================================
 *  Setup:  paste into the DEV COPY's Apps Script -> Save -> reload sheet.
 *  Sheet menu "🏠 Twin Visit Logger" runs setup / load / tests / triggers.
 *  WEB DASHBOARD (built-in): Deploy -> New deployment -> Web app.
 *  JSON API (for the external Vercel website): set CFG.API_TOKEN, deploy Web app access "Anyone",
 *    then GET ?api=data&token=... and POST {token,action,id,params}.
 *  Concatenation of Config/Setup/LoadData/Automation/DailyReport/WebApp/Tests.
 *  Never contacts sellers. Original workbook never modified. Triggers never auto-install.
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
    .addItem('Remove test artifacts (go-live cleanup)', 'removeTestArtifacts')
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
  TRASH_SHEET: 'Trash',             // soft-deleted records (restorable from the dashboard)
  // Shared secret for the external website's JSON API (set the SAME value in Vercel APPS_SCRIPT_TOKEN).
  // Leave '' to disable the API (HTML dashboard still works). Use a long random string.
  API_TOKEN: '',
  SANDBOX: true,
  VISIT_CALENDAR_ID: '',
  OFFICE_ORIGIN: '170 Glenn Way, San Carlos, CA 94070',
};

// Internal task recipients. Blank = deliver via the visible Task Queue sheet only (pilot default).
// Set an INTERNAL address to also email that person their tasks. NEVER a seller address.
const OWNER_EMAILS = { Jonathan: '', Kyle: '', Cherry: '', Juan: '' };

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
  'Offer Promised Date',
  'Seller Floor','Our Max',
];

const DROPDOWNS = {
  'Visit Status': ['Scheduled','Completed','Canceled','Reschedule Needed'],
  'Current Stage': ['Visit Scheduled','Visit Completed — Needs Review','Offer Preparation','Offer Sent','Active Negotiation','Verbal Agreement','Contract Sent','Contract Signed','Long-Term Nurture','Lost / Closed Out'],
  'Assigned Owner': ['Jonathan','Kyle','Cherry','Juan'],
  'Assigned Visitor': ['Juan','Kyle','Cherry','Jonathan','Cesar','Jose Herrera','Manny Morales','Lily','Alan Hernandez'],
  'Gift Approval Owner': ['Cherry','Juan'],
  'Gift Approved By': ['Cherry','Juan'],
  'Updated By': ['Jonathan','Kyle','Cherry','Juan','Apps Script','Import'],
  'Final Disposition': ['Contracted','Lost','Long-Term Nurture','Closed Out'],
  'Gift Status': ['Not Reviewed','Recommended','Approved','Sent','Not Appropriate'],
  'Blocker': ['Price','Title','Tenant','Family','Access','Timing','Documents','Property Condition','Seller Unresponsive','Other'],
  'Lead Source': ['Direct Mail','Direct Mail - Postcard','PPC','TV','Facebook','SEO','PPL - Property Leads','PPL - Motivated Leads'],
  'Offer Status': ['Not Started','In Preparation','Sent','Countered','Accepted','Rejected','Withdrawn'],
  'Occupancy Status': ['Owner-Occupied','Tenant-Occupied','Vacant','Unknown'],
  'Property Condition': ['Excellent','Good','Fair','Poor','Distressed'],
  'Seller Timeline': ['ASAP','30 days','60 days','90+ days','Unknown'],
  'Offer Received Confirmation': ['Yes','No'],
  'Transaction Handoff Status': ['Not Ready','Ready for Handoff','Handed Off','Handoff Confirmed'],
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
  ensureRows_(sh, CFG.MAX_ROWS);
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
  ensureRows_(sh, CFG.MAX_ROWS);   // <-- guarantees the grid reaches row 500 before writing
  writeHeaders_(sh);               // row 1 only (idempotent)
  applyDropdowns_(sh);             // rows 2..MAX_ROWS
  writeFormulas_(sh);              // rewrites ONLY the 9 computed columns (never user data)
  applyConditionalFormatting_(sh);
  buildDropdownSheet_(ss);
  buildBoard_(ss);                 // every section excludes Source = TEST
  buildExceptionQueue_(ss);        // live queue excludes Source = TEST
  buildMigrationLog_(ss);
  buildTestDataSheet_(ss);         // Source = TEST records shown here only
  ensureTaskQueue_(ss);

  // ---- coverage + counts for the summary toast ----
  const fRow = lastFormulaRow_(sh, 'Normalized Address');
  const vRow = lastValidationRow_(sh, 'Current Stage');
  const data = sh.getRange(CFG.FIRST_DATA_ROW, 1, CFG.MAX_ROWS - 1, HEADERS.length).getValues();
  const si = col('Source') - 1, ai = col('Property Address') - 1, di = col('Data Quality Status') - 1;
  var live = 0, liveExc = 0, tests = 0;
  data.forEach(function(row){
    if (!row[ai]) return;
    if (String(row[si]).trim() === 'TEST') { tests++; return; }
    live++;
    if (row[di] === 'Incomplete' || row[di] === 'Exception') liveExc++;
  });
  SpreadsheetApp.getActive().toast(
    'Repair complete — formulas → row ' + fRow + ' | validation → row ' + vRow +
    ' | live records ' + live + ' | live exceptions ' + liveExc +
    ' | test records isolated ' + tests + ' (in Test Data). Grid rows: ' + sh.getMaxRows() + '.',
    'repairSheet', 15);
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

/** Guarantee the sheet grid has at least n rows (a prior deleteRow may have shrunk it below 500). */
function ensureRows_(sh, n) {
  const have = sh.getMaxRows();
  if (have < n) sh.insertRowsAfter(have, n - have);
}

/** Last row (<= MAX_ROWS) that actually holds a formula in the given computed column. */
function lastFormulaRow_(sh, header) {
  const f = sh.getRange(CFG.FIRST_DATA_ROW, col(header), CFG.MAX_ROWS - 1, 1).getFormulas();
  for (var i = f.length - 1; i >= 0; i--) if (f[i][0]) return CFG.FIRST_DATA_ROW + i;
  return 0;
}

/** Last row (<= MAX_ROWS) that actually has a data-validation rule in the given column. */
function lastValidationRow_(sh, header) {
  const dv = sh.getRange(CFG.FIRST_DATA_ROW, col(header), CFG.MAX_ROWS - 1, 1).getDataValidations();
  for (var i = dv.length - 1; i >= 0; i--) if (dv[i][0]) return CFG.FIRST_DATA_ROW + i;
  return 0;
}

function writeHeaders_(sh) {
  sh.getRange(CFG.HEADER_ROW, 1, 1, HEADERS.length).setValues([HEADERS])
    .setFontWeight('bold').setFontColor('#ffffff').setBackground('#2e5a88')
    .setWrap(true).setFontFamily('Arial').setFontSize(10);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(2);
}

function applyDropdowns_(sh) {
  ensureRows_(sh, CFG.MAX_ROWS);
  const last = CFG.MAX_ROWS;
  // Clear any stale validations across the data range first, so a rule left over from an earlier
  // build (different column layout) can never mismatch the current schema (fixes BH35-type errors).
  sh.getRange(CFG.FIRST_DATA_ROW, 1, last - 1, HEADERS.length).clearDataValidations();
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
  const SOFT = {'Updated By': true, 'Gift Approved By': true};
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
  ensureRows_(sh, CFG.MAX_ROWS);
  const first = CFG.FIRST_DATA_ROW, last = CFG.MAX_ROWS;
  COMPUTED_HEADERS.forEach(function(h){
    const c = col(h);
    const formulas = [];
    for (let r = first; r <= last; r++) formulas.push([formulaFor_(h, r)]);
    sh.getRange(first, c, last - first + 1, 1).setFormulas(formulas);
  });
  // date/currency number formats
  ['Visit Date','Offer Prepared Date','Offer Sent Date','Offer Promised Date','Last Contact Date','Next Action Due Date',
   'Gift Sent Date','Gift Approval Date','Contract Sent Date','Contract Signed Date','Created Date','Last Updated Date']
    .forEach(function(h){ sh.getRange(first, col(h), last-first+1, 1).setNumberFormat('yyyy-mm-dd'); });
  ['Asking Price','Price Expectation','Approved Offer Amount','Counteroffer Amount','Seller Floor','Our Max']
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
    ['7. Contract Handoffs', '(' + stage + "='Contract Signed' and " + handoff + " <> 'Handoff Confirmed')", due],
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
  return sh;
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
  {"Property ID":"TEST-03", "Property Address":"300 Test Signed Blvd, Testville, CA 90003", "Seller Name":"Sid Signed", "Phone":"(000) 000-0003", "Lead Source":"Direct Mail", "REI BlackBook Link":"https://app.reiblackbook.com/lead/test03", "Visit Date":new Date(2026,6,10), "Visit Status":"Completed", "Assigned Visitor":"Juan", "Visit Notes":"Signed.", "Seller Motivation":"Estate sale — motivated", "Approved Offer Amount":555000, "Offer Status":"Accepted", "Offer Sent Date":new Date(2026,6,11), "Current Stage":"Contract Signed", "Final Disposition":"Contracted", "Contract Sent Date":new Date(2026,6,14), "Contract Signed Date":new Date(2026,6,18), "Transaction Handoff Status":"Ready for Handoff", "Next Action":"Hand off signed contract for transaction coordination", "Next Action Due Date":new Date(2026,6,20), "Assigned Owner":"Cherry", "Last Contact Date":new Date(2026,6,18), "Last Contact Result":"Contract signed", "Created Date":new Date(2026,6,10), "Last Updated Date":new Date(2026,6,18), "Updated By":"Cherry", "Source":"TEST", "REI Update Required":"Yes"},
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

/**
 * Full go-live cleanup of test artifacts. Safe: preserves the grid, formulas, validation and
 * conditional formatting; keeps the Test Results sheet.
 *   1. Archives the Source=TEST rows into the Test Data sheet (static values).
 *   2. Clears those rows IN PLACE in Data (formulas restored) — no row deletion.
 *   3. Removes TEST / TEST-A tasks from Task Queue (a plain log sheet).
 *   4. Removes TEST / TEST-A entries from Automation Log.
 *   5. Leaves Test Results intact.
 */
function removeTestArtifacts() {
  const ss = SpreadsheetApp.getActive();
  const sh = dataSheet_();
  if (!sh) return;
  const disp = ['Property ID','Property Address','Seller Name','Current Stage','Assigned Owner',
                'Next Action Due Date','Days Overdue','Stalled Status','Data Quality Status','Exception Reason'];
  const all = sh.getRange(CFG.FIRST_DATA_ROW, 1, CFG.MAX_ROWS - 1, HEADERS.length).getValues();
  const si = col('Source') - 1, ai = col('Property Address') - 1;
  const archive = [], clearRows = [];
  for (var i = 0; i < all.length; i++) {
    if (all[i][ai] && String(all[i][si]).trim() === 'TEST') {
      archive.push(disp.map(function(h){ return all[i][col(h) - 1]; }));
      clearRows.push(CFG.FIRST_DATA_ROW + i);
    }
  }
  // 1. archive to Test Data (static)
  const td = ensureSheet_(ss, CFG.TEST_DATA_SHEET);
  td.clear(); td.setTabColor('#999999');
  td.getRange(1,1).setValue('Test Data — archived Source=TEST demo records (isolated from all live views)').setFontWeight('bold').setFontSize(12);
  td.getRange(3,1,1,disp.length).setValues([disp]).setFontWeight('bold').setBackground('#ddebf7');
  if (archive.length) td.getRange(4,1,archive.length,disp.length).setValues(archive);
  else td.getRange(4,1).setValue('— none —');
  td.getRange(1,6,td.getMaxRows(),1).setNumberFormat('yyyy-mm-dd');
  td.getRange(1,7,td.getMaxRows(),1).setNumberFormat('0');
  // 2. clear in place (formulas restored; grid unchanged)
  clearRows.forEach(function(r){ clearRecordRow_(sh, r); });
  // 3 & 4. purge TEST/TEST-A from the log sheets (safe row deletes — not the Data grid)
  const tq = removeRowsByPrefix_(ss, CFG.TASK_QUEUE_SHEET, 3, 'TEST');
  const al = removeRowsByPrefix_(ss, 'Automation Log', 3, 'TEST');
  SpreadsheetApp.getActive().toast(
    'Removed ' + clearRows.length + ' TEST data rows (archived to Test Data), ' + tq + ' Task Queue + ' + al +
    ' Automation Log entries. Test Results kept. Grid rows: ' + sh.getMaxRows() + ' (unchanged).',
    'removeTestArtifacts', 12);
}

/** Delete rows from a plain LOG sheet where column idCol starts with prefix. Returns count. */
function removeRowsByPrefix_(ss, sheetName, idCol, prefix) {
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return 0;
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const vals = sh.getRange(2, idCol, last - 1, 1).getValues();
  var removed = 0;
  for (var r = last; r >= 2; r--) {                 // bottom-up so indices stay valid
    if (String(vals[r - 2][0]).indexOf(prefix) === 0) { sh.deleteRow(r); removed++; }
  }
  return removed;
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
  R.set('Next Action', 'Hand off signed contract for transaction coordination');
  R.setIfBlank('Next Action Due Date', addBiz_(today_(), 1));
  R.set('REI Update Required', 'Yes');
  enqueueTask_('', R.get('Property ID'), R.get('Property Address'), 'Contract handoff — signed; also confirm REI BlackBook update', R.get('Next Action Due Date'));
  logAuto_('TASK', R.get('Property ID'), 'HANDOFF created; sales follow-up stopped; REI update required');
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
      rows: f(function(r){ return r['Current Stage']==='Contract Signed' && r['Transaction Handoff Status']!=='Handoff Confirmed'; }) },
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

/* ========================= WebApp.gs ========================= */

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

function webGetData() {
  const sh = dataSheet_();
  const last = sh.getLastRow();
  const rows = [];
  if (last >= CFG.FIRST_DATA_ROW) {
    const vals = sh.getRange(CFG.FIRST_DATA_ROW, 1, last - CFG.FIRST_DATA_ROW + 1, HEADERS.length).getValues();
    vals.forEach(function(v, i){
      const rec = {}; HEADERS.forEach(function(h, j){ rec[h] = v[j]; });
      if (!rec['Property Address'] || String(rec['Source']).trim() === 'TEST') return; // live records only
      const full = {}; HEADERS.forEach(function(h){ var val = rec[h]; full[h] = (val instanceof Date) ? fmt_(val) : (val == null ? '' : val); });
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
        visitDate: fmt_(rec['Visit Date']),
        visitor: rec['Assigned Visitor'] || '',
        visitNotes: rec['Visit Notes'] || '',
        nextAction: rec['Next Action'] || '',
        due: fmt_(rec['Next Action Due Date']),
        lastContact: fmt_(rec['Last Contact Date']),
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
        offerPromised: fmt_(rec['Offer Promised Date']),
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
        onVisitStatus_(new RowAccessor_(sh, rowNum)); break;
      case 'logContact':
        R.set('Last Contact Date', today_());
        if (params.result) R.set('Last Contact Result', params.result);
        if (params.nextAction) R.set('Next Action', params.nextAction);
        if (params.due) R.set('Next Action Due Date', new Date(params.due));
        stamp_(R); R.flush(); break;
      case 'recordOfferSent':
        if (params.amount) R.set('Approved Offer Amount', Number(params.amount));
        R.set('Offer Sent Date', params.date ? new Date(params.date) : today_());
        stamp_(R); R.flush(); onOfferSent_(new RowAccessor_(sh, rowNum)); break;
      case 'sellerCounter':
        if (params.amount) R.set('Counteroffer Amount', Number(params.amount));
        if (params.result) R.set('Last Contact Result', params.result);
        stamp_(R); R.flush(); onSellerCounter_(new RowAccessor_(sh, rowNum)); break;
      case 'contractSent':
        R.set('Contract Sent Date', params.date ? new Date(params.date) : today_());
        stamp_(R); R.flush(); onContractSent_(new RowAccessor_(sh, rowNum)); break;
      case 'contractSigned':
        R.set('Contract Signed Date', params.date ? new Date(params.date) : today_());
        stamp_(R); R.flush(); onContractSigned_(new RowAccessor_(sh, rowNum)); break;
      case 'nurture':
        R.set('Current Stage', 'Long-Term Nurture');
        if (params.due) R.set('Next Action Due Date', new Date(params.due));
        if (params.nextAction) R.set('Next Action', params.nextAction);
        stamp_(R); R.flush(); onStageManual_(new RowAccessor_(sh, rowNum)); break;
      case 'setNextAction':
        if (params.nextAction) R.set('Next Action', params.nextAction);
        if (params.due) R.set('Next Action Due Date', new Date(params.due));
        if (params.owner) R.set('Assigned Owner', params.owner);
        stamp_(R); R.flush(); break;
      case 'updateRecord': {
        var locked = COMPUTED_HEADERS.concat(['Property ID','Created Date','Last Updated Date','Updated By']);
        Object.keys(params).forEach(function(h){
          if (HEADERS.indexOf(h) < 0 || locked.indexOf(h) >= 0) return;
          var val = params[h];
          if (h.indexOf('Date') >= 0) R.set(h, val ? new Date(val) : '');
          else if (h === 'Approved Offer Amount' || h === 'Counteroffer Amount' || h === 'Asking Price' || h === 'Price Expectation') R.set(h, val === '' || val == null ? '' : Number(val));
          else R.set(h, val == null ? '' : val);
        });
        stamp_(R); R.flush(); break;
      }
      case 'deleteRecord':
        softDelete_(sh, rowNum); break;
      default:
        return { ok: false, error: 'Unknown action: ' + action };
    }
    SpreadsheetApp.flush();
    return { ok: true, data: webGetData() };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function slaFor_(rec) {
  var stage = rec['Current Stage'] || '';
  if (stage === 'Lost / Closed Out' || stage === 'Contract Signed' || stage === 'Long-Term Nurture') return '';
  var t = today_();
  function d(v){ return v ? new Date(v) : null; }
  function maxD(){ var m=null; for (var i=0;i<arguments.length;i++){ var x=d(arguments[i]); if(x&&(!m||x>m)) m=x; } return m; }
  var reasons = [];
  var promised = d(rec['Offer Promised Date']), sent = d(rec['Offer Sent Date']);
  if (promised && !sent && bizDaysBetween_(promised, t) >= 1) reasons.push('Offer promised, not sent');
  else if (!promised && !sent && (stage === 'Visit Completed — Needs Review' || stage === 'Offer Preparation')) {
    var since = maxD(rec['Visit Date'], rec['Last Updated Date']);
    if (since && bizDaysBetween_(since, t) >= 1) reasons.push('Offer decision overdue');
  }
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
function driveMinutes_(dest) {
  try {
    const d = Maps.newDirectionFinder().setOrigin(CFG.OFFICE_ORIGIN).setDestination(dest).getDirections();
    return Math.ceil(d.routes[0].legs[0].duration.value / 60);
  } catch (e) { return 0; }
}
function maybeCreateVisitEvent_(map, addr) {
  if (CFG.SANDBOX) return 'skipped (sandbox on)';
  if (!CFG.VISIT_CALENDAR_ID) return 'skipped (no calendar configured)';
  try {
    const cal = CalendarApp.getCalendarById(CFG.VISIT_CALENDAR_ID);
    if (!cal) return 'calendar not found / not shared';
    if (!map['Visit Date']) return 'no visit date — event skipped';
    const start = new Date(map['Visit Date']); start.setHours(9, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60000);
    const desc = 'Seller: ' + (map['Seller Name'] || '') + '\nPhone: ' + (map['Phone'] || '') +
                 '\nREI: ' + (map['REI BlackBook Link'] || '') + '\nLead source: ' + (map['Lead Source'] || '');
    const ev = cal.createEvent('Property Visit - ' + addr, start, end, { description: desc, location: addr });
    const mins = driveMinutes_(addr);
    ev.removeAllReminders();
    if (mins) ev.addPopupReminder(mins);
    ev.addPopupReminder(30);
    return 'event created (' + (mins ? mins + 'm drive reminder' : '30m only') + ')';
  } catch (e) { return 'error: ' + e; }
}
function webIntake_(lead) {
  lead = lead || {};
  const g = function(a, b){ return lead[a] != null && lead[a] !== '' ? lead[a] : (lead[b] != null ? lead[b] : ''); };
  const addr = g('Property Address', 'address'), phone = g('Phone', 'phone');
  if (!addr) return { ok: false, error: 'Property Address is required' };
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
    U.flush(); SpreadsheetApp.flush();
    return { ok: true, updated: true, id: dup.id, fields: updated };
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
  return { ok: true, created: true, id: R.get('Property ID'), sandbox: !!CFG.SANDBOX, calendar: cal };
}
function testIntake() {
  const sample = {
    'Property Address': '123 Sandbox Test Ave, Testville, CA 90000',
    'Seller Name': 'Intake Test', 'Phone': '(000) 000-1234', 'Lead Source': 'PPC',
    'Visit Date': Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
  };
  var res = webIntake_(sample);
  Logger.log('INTAKE RESULT: ' + JSON.stringify(res));
  var res2 = webIntake_(sample);
  Logger.log('UPSERT CHECK (should say updated:true): ' + JSON.stringify(res2));
  if (res.ok && res.created) { var rn = findRowById_(res.id); if (rn) clearRecordRow_(dataSheet_(), rn); }
  SpreadsheetApp.getActive().toast(
    'Intake test: ' + (res.ok ? 'PASS' : 'FAIL ' + res.error) + ' · created ' + (res.id || '-') +
    ' · calendar: ' + (res.calendar || '-') + ' · upsert: ' + ((res2.updated||res2.duplicate) ? 'OK' : 'FAILED') +
    ' · test row cleaned up.', 'testIntake', 12);
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
function softDelete_(sh, rowNum) {
  var vals = sh.getRange(rowNum, 1, 1, HEADERS.length).getValues()[0];
  if (!vals[col('Property Address') - 1]) return;
  var email = ''; try { email = Session.getActiveUser().getEmail() || ''; } catch (e) {}
  trashSheet_().appendRow([new Date(), email].concat(vals));
  clearRecordRow_(sh, rowNum);
}
function restoreFromTrash_(trashRow) {
  var t = trashSheet_();
  if (!trashRow || trashRow < 2 || trashRow > t.getLastRow()) return { ok: false, error: 'Trash entry not found' };
  var row = t.getRange(trashRow, 3, 1, HEADERS.length).getValues()[0];
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
  SpreadsheetApp.flush();
  return { ok: true };
}
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
  cleanupTests_();          // clear any leftover TEST-A rows from a prior/interrupted run first,
  SpreadsheetApp.flush();   // so this run starts clean and test addresses stay unique (no false duplicates)
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

  // 10 & 11 contract sent -> follow-up ; contract signed -> handoff
  let g2 = newRow({'Property ID':'TEST-A6','Property Address':'6 Auto Test St, Testville, CA','Seller Name':'Auto Six','REI BlackBook Link':'https://rei/test-a6','Source':'TEST'});
  g2 = edit(g2, 'Contract Sent Date', today_());
  assert('10. Contract sent -> Contract Sent + follow-up', g2.get('Current Stage')==='Contract Sent' && !!g2.get('Next Action Due Date'), g2.get('Current Stage'));
  g2 = edit(g2, 'Contract Signed Date', today_());
  assert('11. Contract signed -> handoff + Contracted', g2.get('Current Stage')==='Contract Signed' && g2.get('Final Disposition')==='Contracted', g2.get('Current Stage'));

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

  // ---- coverage + TEST-exclusion + go-live-cleanup tests ----
  const ss2 = SpreadsheetApp.getActive();
  buildBoard_(ss2); buildExceptionQueue_(ss2); SpreadsheetApp.flush();
  // TEST seller names currently in Data (harness TEST-A rows guarantee this set is non-empty)
  const dv = sh.getRange(CFG.FIRST_DATA_ROW, 1, CFG.MAX_ROWS - 1, HEADERS.length).getValues();
  const testSellers = {};
  dv.forEach(function(row){ if (String(row[col('Source')-1]).trim() === 'TEST' && row[col('Seller Name')-1]) testSellers[String(row[col('Seller Name')-1])] = true; });

  const bSellers = columnValues_(ss2.getSheetByName(CFG.BOARD_SHEET), 2);   // Board Seller = col B
  assert('B1. Board contains zero Source=TEST records', !bSellers.some(function(v){ return testSellers[v]; }), 'board sellers checked');
  const eSellers = columnValues_(ss2.getSheetByName(CFG.EXCEPTIONS_SHEET), 3); // Exc Seller = col C
  assert('B2. Exception Queue contains zero Source=TEST records', !eSellers.some(function(v){ return testSellers[v]; }), 'queue sellers checked');

  assert('B3. Formula coverage reaches row 500', lastFormulaRow_(sh,'Normalized Address') >= CFG.MAX_ROWS && sh.getMaxRows() >= CFG.MAX_ROWS, 'fRow=' + lastFormulaRow_(sh,'Normalized Address') + ' grid=' + sh.getMaxRows());
  assert('B4. Validation coverage reaches row 500', lastValidationRow_(sh,'Current Stage') >= CFG.MAX_ROWS, 'vRow=' + lastValidationRow_(sh,'Current Stage'));

  // Gift Sent must be an Exception until Gift Approved By + Gift Approval Date are set
  let gf = newRow({'Property ID':'TEST-A14','Property Address':'14 Auto Test St','Seller Name':'Gift Test','REI BlackBook Link':'https://rei/a14','Visit Notes':'x','Seller Motivation':'m','Current Stage':'Long-Term Nurture','Assigned Owner':'Cherry','Next Action':'nurture','Next Action Due Date':addBiz_(today_(),30),'Gift Status':'Sent','Source':'TEST'});
  SpreadsheetApp.flush();
  assert('B5a. Gift Sent WITHOUT approver+date -> Exception', String(new RowAccessor_(sh,gf.row).get('Exception Reason')).indexOf('Gift') >= 0, new RowAccessor_(sh,gf.row).get('Exception Reason'));
  gf.set('Gift Approved By','Cherry'); gf.set('Gift Approval Date', today_()); gf.flush(); SpreadsheetApp.flush();
  assert('B5b. Gift Sent WITH approver+date -> no gift exception', String(new RowAccessor_(sh,gf.row).get('Exception Reason')).indexOf('Gift') < 0, new RowAccessor_(sh,gf.row).get('Exception Reason') || '(clear)');

  // removeTestArtifacts must NOT delete/shrink grid rows
  const rowsBefore = sh.getMaxRows();
  removeTestArtifacts();
  const rowsAfter = sh.getMaxRows();
  assert('B6. removeTestArtifacts does not delete/shrink rows', rowsAfter === rowsBefore && rowsAfter >= CFG.MAX_ROWS, 'before=' + rowsBefore + ' after=' + rowsAfter);

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

/** Non-empty, non-placeholder values from column c of a sheet (used to inspect rendered QUERY output). */
function columnValues_(sh, c) {
  if (!sh) return [];
  const last = sh.getLastRow();
  if (last < 1) return [];
  return sh.getRange(1, c, last, 1).getValues()
    .map(function(r){ return String(r[0]); })
    .filter(function(v){ return v && v !== '— none —'; });
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
