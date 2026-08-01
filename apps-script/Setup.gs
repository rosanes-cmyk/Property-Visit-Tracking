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
    // Legacy-migration columns.
    'Deal Stage':'Deal Stage','Deal Status':'Deal Status','Contract Status':'Contract Status',
    'Closer':'Closer','Golden Needle':'Golden Needle',
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
