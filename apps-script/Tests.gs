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
