/**
 * Twin Visit Logger — SAVE ROUND-TRIP TEST.
 *
 * Proves that "adding/updating from the dashboard" actually writes to the Google
 * Sheet, WITHOUT deploying anything. Run testSaveRoundTrip() in the Apps Script
 * editor (DEV COPY) and read the Execution log.
 *
 * It: (1) adds a record via the same backend the dashboard uses (webAddRecord_),
 * (2) reads it back from the Data sheet to confirm it landed and automation ran,
 * (3) then removes that test row so nothing is left behind. Safe & repeatable.
 */
function testSaveRoundTrip() {
  var log = [];
  function ok(name, cond, detail){ log.push((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); }

  var sh = dataSheet_();
  if (!sh) { Logger.log('FAIL — run "Build structure (setup)" first.'); return; }

  // 1) ADD a record exactly the way the dashboard does.
  var addr = 'TEST ROUND-TRIP — 1 Verify Way, Testville, CA 90000';
  var res = webAddRecord_({
    'Property Address': addr,
    'Seller Name': 'Round Trip Test',
    'Phone': '(000) 000-0000',
    'Lead Source': 'PPC',
    'Visit Status': 'Scheduled',
    'Current Stage': 'Visit Scheduled',
    'Assigned Owner': 'Cherry',
    'Next Action': 'Confirm the save worked',
    'Next Action Due Date': Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
  });
  ok('webAddRecord_ returned ok', res && res.ok, res && res.error ? res.error : '');
  if (!res || !res.ok) { Logger.log(log.join('\n')); return; }
  var newId = res.newId;
  ok('got a new Property ID', !!newId, newId);

  SpreadsheetApp.flush();

  // 2) READ IT BACK straight from the sheet (independent of the return value).
  var rowNum = findRowById_(newId);
  ok('row exists in the Data sheet', !!rowNum, 'row ' + rowNum);
  if (rowNum) {
    var R = new RowAccessor_(sh, rowNum);
    ok('address saved', R.get('Property Address') === addr);
    ok('seller saved', R.get('Seller Name') === 'Round Trip Test');
    ok('owner saved', R.get('Assigned Owner') === 'Cherry');
    ok('stage saved', R.get('Current Stage') === 'Visit Scheduled');
    ok('Source stamped Manual', R.get('Source') === 'Manual');
    // computed columns should have recalculated (proves formulas fire on write)
    var dq = R.get('Data Quality Status');
    ok('Data Quality computed', dq !== '' && dq !== null, 'Data Quality = ' + dq);
  }

  // 3) CLEAN UP — remove the test row in place (keeps grid + formulas).
  if (rowNum) { clearRecordRow_(sh, rowNum); SpreadsheetApp.flush(); }
  ok('cleanup: test row cleared', rowNum ? (new RowAccessor_(sh, rowNum).get('Property Address') === '') : false);

  var passed = log.filter(function(l){ return l.indexOf('PASS') === 0; }).length;
  log.unshift('SAVE ROUND-TRIP: ' + passed + '/' + log.length + ' checks passed');
  Logger.log(log.join('\n'));
  SpreadsheetApp.getActive().toast(passed + '/' + log.length + ' checks passed. See View → Logs for detail.', 'Save round-trip test', 8);
}
