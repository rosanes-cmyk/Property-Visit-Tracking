/**
 * Twin Visit Logger — header drift check. READ ONLY. Changes nothing.
 *
 * Run dumpHeaders() from the Apps Script editor and read the execution log.
 *
 * Why this exists: the live Data tab has 74 columns where HEADERS declares 72, and from
 * 'REI BlackBook Link' onward the real columns sit one to the right of where this code believed they
 * were. Everything in the project addresses columns through col(), so a drift of one puts every read
 * and every write on the neighbouring cell — the dashboard handed a reiblackbook.com URL to a field
 * expecting a visit date, and two real visits could not be found on the board at all.
 *
 * The drift comes from the Node automation: ADD_MISSING_COLUMNS=true appends a column whenever one of
 * its header aliases finds no match, so a heading that differs by a word creates a new column rather
 * than using the existing one. That is the right behaviour for not losing data, and the wrong thing to
 * leave unreconciled.
 *
 * This prints three things, which together say exactly what to do:
 *   1. every live column with its real 1-based position
 *   2. headings on the sheet that HEADERS does not declare  -> the extras
 *   3. headings HEADERS declares that the sheet does not have -> what the extras were meant to be
 */
function dumpHeaders() {
  const sh = dataSheet_();
  if (!sh) { Logger.log('No sheet named "' + CFG.DATA_SHEET + '" in this workbook.'); return; }

  const width = sh.getLastColumn();
  const live = sh.getRange(CFG.HEADER_ROW, 1, 1, width).getValues()[0]
    .map(function (v) { return String(v).trim(); });

  Logger.log('Workbook: ' + SpreadsheetApp.getActive().getName());
  Logger.log('Tab: "' + CFG.DATA_SHEET + '"  ·  rows: ' + sh.getLastRow() + '  ·  columns: ' + width);
  Logger.log('HEADERS declared in code: ' + HEADERS.length);
  Logger.log('');

  Logger.log('--- every live column, and where the code expected it ---');
  live.forEach(function (name, i) {
    const declared = HEADERS.indexOf(name);           // 0-based position in the array
    const note = !name ? '(blank heading)'
      : declared < 0 ? '<-- NOT IN HEADERS'
        : declared + 1 === i + 1 ? ''
          : '<-- code expected column ' + (declared + 1);
    Logger.log((i + 1) + '\t' + (name || '(blank)') + '\t' + note);
  });

  const extras = live.filter(function (n) { return n && HEADERS.indexOf(n) < 0; });
  const missing = HEADERS.filter(function (n) { return live.indexOf(n) < 0; });

  Logger.log('');
  Logger.log('--- on the sheet but not declared in HEADERS (' + extras.length + ') ---');
  extras.forEach(function (n) { Logger.log('  ' + n + '   (column ' + (live.indexOf(n) + 1) + ')'); });
  Logger.log('');
  Logger.log('--- declared in HEADERS but not on the sheet (' + missing.length + ') ---');
  missing.forEach(function (n) { Logger.log('  ' + n); });

  Logger.log('');
  const firstShift = (function () {
    for (var i = 0; i < live.length; i++) {
      const d = HEADERS.indexOf(live[i]);
      if (live[i] && d >= 0 && d !== i) return { name: live[i], sheet: i + 1, code: d + 1 };
    }
    return null;
  })();
  Logger.log(firstShift
    ? 'First shifted column: "' + firstShift.name + '" is at ' + firstShift.sheet +
      ', the code reads ' + firstShift.code + '. Everything from there on is off by ' +
      (firstShift.sheet - firstShift.code) + '.'
    : 'No shift: every heading the code knows about is where it expects it.');
}
