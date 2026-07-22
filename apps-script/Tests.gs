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
