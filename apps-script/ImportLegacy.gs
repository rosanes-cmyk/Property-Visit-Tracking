/**
 * Twin Visit Logger — bulk import of the historical "Property Visit Tracking" workbook.
 *
 * How it is used:
 *   1. Open build/legacy-import.csv (produced by build/migrate_legacy_data.py), select all, copy.
 *   2. In the DEV workbook create a tab named exactly  Legacy Import  and paste into cell A1.
 *   3. Menu: Twin Visit Logger → 📦 Import legacy rows.
 *
 * The paste's column ORDER does not matter — every value is placed by matching the pasted header
 * text to a tracker header. Anything the tracker does not have a column for is reported, not
 * silently dropped.
 *
 * Safety:
 *   - The 9 computed columns are never written; their formulas are re-applied to each new row.
 *   - A record whose Normalized Address already exists in Data is SKIPPED, so running the import
 *     twice cannot duplicate anything.
 *   - Nothing is deleted. Existing rows are never modified — this only appends.
 *   - No calendar events are created. Historical visits are history; the calendar is for upcoming
 *     visits only, and creating 153 past events would spam Juan's calendar.
 */

var LEGACY_IMPORT_SHEET = 'Legacy Import';

/** Same nine columns Setup.gs owns. Writing them would replace a formula with a dead value. */
var IMPORT_SKIP_COLUMNS = [
  'Normalized Address', 'Days Since Last Activity', 'Days Overdue', 'Stalled Status',
  'Missing Required Fields', 'Duplicate Address Flag', 'Opportunity Priority',
  'Data Quality Status', 'Exception Reason'
];

/** Mirrors the sheet's Normalized Address formula, so dedupe compares like with like. */
function importNormAddr_(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/,/g, '')
    .replace(/\./g, '')
    .replace(/#/g, '')
    .replace(/ apt /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Dry run — reports exactly what a real import would do, and changes nothing. */
function previewLegacyImport() {
  importLegacyRows_(true);
}

/** The real thing. */
function importLegacyRows() {
  importLegacyRows_(false);
}

function importLegacyRows_(previewOnly) {
  var ss = SpreadsheetApp.getActive();
  var ui = SpreadsheetApp.getUi();
  var src = ss.getSheetByName(LEGACY_IMPORT_SHEET);
  if (!src) {
    ui.alert('No "' + LEGACY_IMPORT_SHEET + '" tab.\n\nCreate a tab with exactly that name and ' +
             'paste the contents of legacy-import.csv into cell A1 (including the header row).');
    return;
  }
  var sh = dataSheet_();
  if (!sh) { ui.alert('Run "Build structure (setup)" first.'); return; }

  var values = src.getDataRange().getValues();
  if (values.length < 2) { ui.alert('The "' + LEGACY_IMPORT_SHEET + '" tab has no data rows.'); return; }

  // ---- map pasted headers onto tracker columns -------------------------------------------
  var pasted = values[0].map(function (h) { return String(h == null ? '' : h).trim(); });
  var skip = {};
  IMPORT_SKIP_COLUMNS.forEach(function (h) { skip[h] = true; });

  var plan = [];        // [{ from: pastedIndex, to: trackerColumn }]
  var unknown = [];     // pasted headers the tracker has no column for
  var ignored = [];     // pasted headers deliberately not written (computed columns)
  pasted.forEach(function (header, i) {
    if (!header) return;
    if (skip[header]) { ignored.push(header); return; }
    var at = HEADERS.indexOf(header);
    if (at < 0) { unknown.push(header); return; }
    plan.push({ from: i, to: at + 1 });
  });

  if (!plan.length) {
    ui.alert('None of the pasted headers match a tracker column. Did the header row get pasted?');
    return;
  }
  var addrFrom = -1;
  pasted.forEach(function (h, i) { if (h === 'Property Address') addrFrom = i; });
  if (addrFrom < 0) { ui.alert('The paste has no "Property Address" column — cannot dedupe. Aborting.'); return; }

  // ---- what is already in the sheet -------------------------------------------------------
  var lastRow = sh.getLastRow();
  var existing = {};
  var firstEmpty = CFG.FIRST_DATA_ROW;
  if (lastRow >= CFG.FIRST_DATA_ROW) {
    var addrCol = sh.getRange(CFG.FIRST_DATA_ROW, col('Property Address'), lastRow - CFG.FIRST_DATA_ROW + 1, 1).getValues();
    for (var i = 0; i < addrCol.length; i++) {
      var key = importNormAddr_(addrCol[i][0]);
      if (key) { existing[key] = true; firstEmpty = CFG.FIRST_DATA_ROW + i + 1; }
    }
  }

  // ---- decide which pasted rows to write --------------------------------------------------
  var toWrite = [];
  var duplicates = 0;
  var blankAddress = 0;
  var seenInPaste = {};
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (!row.some(function (v) { return v !== '' && v != null; })) continue;
    var addr = importNormAddr_(row[addrFrom]);
    if (!addr) { blankAddress++; continue; }
    if (existing[addr] || seenInPaste[addr]) { duplicates++; continue; }
    seenInPaste[addr] = true;
    toWrite.push(row);
  }

  var needRows = firstEmpty + toWrite.length - 1;
  var message =
    'Ready to import from "' + LEGACY_IMPORT_SHEET + '":\n\n' +
    '  ' + toWrite.length + ' new record(s) will be added, starting at row ' + firstEmpty + '\n' +
    '  ' + duplicates + ' skipped — that address is already in Data\n' +
    (blankAddress ? '  ' + blankAddress + ' skipped — no property address\n' : '') +
    '  ' + plan.length + ' column(s) will be filled\n' +
    (ignored.length ? '  ' + ignored.length + ' computed column(s) ignored (the sheet owns those formulas)\n' : '') +
    (unknown.length ? '\n  NOT IMPORTED — no such tracker column:\n    ' + unknown.join('\n    ') + '\n' : '') +
    (needRows > CFG.MAX_ROWS
      ? '\n  WARNING: this needs row ' + needRows + ' but formulas only reach row ' + CFG.MAX_ROWS +
        '.\n  Run "Repair sheet" first, then import again.\n'
      : '');

  if (previewOnly) { ui.alert('Preview only — nothing was changed.\n\n' + message); return; }
  if (needRows > CFG.MAX_ROWS) { ui.alert(message); return; }
  if (!toWrite.length) { ui.alert(message + '\nNothing to do.'); return; }
  if (ui.alert(message + '\nImport now?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  // ---- write ------------------------------------------------------------------------------
  ensureRows_(sh, needRows);

  // Build one rectangular block so this is a single write, not 379 × 62 individual setValue calls.
  var width = HEADERS.length;
  var block = toWrite.map(function (row) {
    var out = [];
    for (var i = 0; i < width; i++) out.push('');   // computed columns stay blank; formulas go back below
    plan.forEach(function (p) {
      var v = row[p.from];
      out[p.to - 1] = (v == null) ? '' : v;
    });
    return out;
  });

  var target = sh.getRange(firstEmpty, 1, block.length, width);
  target.setValues(block);

  // Put the nine formulas back over the blanks this just wrote.
  for (var w = 0; w < block.length; w++) restoreFormulasRow_(sh, firstEmpty + w);
  SpreadsheetApp.flush();

  logAuto_('INFO', 'import', 'Imported ' + block.length + ' legacy record(s); skipped ' + duplicates + ' duplicate(s).');
  ui.alert('Imported ' + block.length + ' record(s).\n\n' +
           duplicates + ' duplicate address(es) were skipped.\n\n' +
           'Records with no Current Stage appear in the dashboard under ' +
           '"⚑ Unrouted — Needs Attention" — those are the ones the old sheet never gave a stage.');
}
