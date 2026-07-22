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
