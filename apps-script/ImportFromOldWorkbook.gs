/**
 * Twin Visit Logger — one-click import straight from the old "Property Visit Tracking" workbook.
 *
 * No CSV, no copy-paste, no "Legacy Import" tab. You give it the link to the old workbook in your
 * Drive and it reads the Data tab itself.
 *
 *   Menu: 🏠 Twin Visit Logger → 📦 Import from the old workbook
 *
 * The mapping is a port of build/migrate_legacy_data.py and is verified against that script's
 * output row-for-row by tests/import-from-drive.test.mjs, so both paths produce identical records.
 *
 * Safety — the same guarantees as the CSV importer:
 *   - Read-only on the source workbook. It is opened, read, and closed. Nothing is written there.
 *   - The 9 computed columns are never written; their formulas are re-applied to each new row.
 *   - A record whose address is already in Data is SKIPPED, so a second run adds nothing.
 *   - Nothing is deleted and no existing row is modified. This only appends.
 *   - No calendar events. Historical visits are history; 153 past events would spam the calendar.
 *   - Where the old sheet never recorded a stage, the cell is left BLANK rather than given an
 *     invented one. Those records surface under "⚑ Unrouted — Needs Attention".
 */

/** The old workbook in Jonathan's Drive. Offered as the default; any link can be pasted instead. */
var OLD_WORKBOOK_ID = '1Wp3uWe-pp0fhWDfvBIZPBlzUUYaoA5J7_zqrQYuNjZk';
var OLD_WORKBOOK_TAB = 'Data';

/** Legacy Data tab column order (1-based), as found in the live workbook. */
var LEGACY_COL = {
  created: 1, name: 2, phone: 3, address: 4, city: 5, inspection: 6, source: 7, contract: 8,
  stage: 9, status: 10, appointment: 11, inspector: 12, closer: 13, golden: 14, agent: 15,
  notes: 16, market: 17, lastupdate: 18
};

var LEGACY_VISIT_STATUS = {
  'inspected': 'Completed',
  'cancelled': 'Canceled',          // the tracker spells it with one L
  'canceled': 'Canceled',
  'pending inspection': 'Scheduled',
  'skipped - offer made': 'Skipped — Offer Made'
};

var LEGACY_DEAL_STAGE = {
  'active': 'Active', 'on hold': 'On Hold', 'won (closed)': 'Won', 'won': 'Won', 'lost': 'Lost'
};

/** Canonical spelling, from the workbook's own "Ref (Deals) - Tags definition" tab. */
var LEGACY_DEAL_STATUS = {
  'lead received': 'Lead Received', 'appointment scheduled': 'Appointment Scheduled',
  'pending reschedule': 'Pending Reschedule', 'under review': 'Under Review',
  'offer made': 'Offer Made', 'under contract': 'Under Contract',
  'on hold - follow up scheduled': 'On Hold - Follow Up Scheduled',
  'on hold - nurture': 'On Hold - Nurture', 'on hold - awaiting seller': 'On Hold - Awaiting Seller',
  'on hold - probate/legal': 'On Hold - Probate/Legal',
  'on hold - seller timeline': 'On Hold - Seller Timeline',
  'acquired': 'Acquired', 'acquired - in rehab': 'Acquired - In Rehab',
  'acquired - listed': 'Acquired - Listed', 'acquired - sold': 'Acquired - Sold',
  'wholesale - buyer assigned': 'Wholesale - Buyer Assigned',
  'wholesale - deal closed': 'Wholesale - Deal Closed',
  'not qualified': 'Not Qualified', "we're passing": "We're Passing",
  'contract cancelled': 'Contract Cancelled', 'seller rejected offer': 'Seller Rejected Offer',
  'did not proceed': 'Did Not Proceed', 'sold to competitor': 'Sold to Competitor',
  'sold with realtor': 'Sold with Realtor', 'referred to realtor': 'Referred to Realtor',
  'already listed': 'Already listed', 'sold (unknown buyer)': 'Sold (unknown buyer)'
};

/** Deal Status → Current Stage, for rows whose Deal Stage is "Active". */
var LEGACY_ACTIVE_STAGE = {
  'Under Contract': 'Contract Signed',
  'Offer Made': 'Offer Sent',
  'Under Review': 'Offer Preparation',
  'Lead Received': 'Visit Scheduled',
  'Appointment Scheduled': 'Visit Scheduled',
  'Pending Reschedule': 'Visit Scheduled',
  'Seller Rejected Offer': 'Lost / Closed Out',
  'Did Not Proceed': 'Lost / Closed Out'
};

/**
 * The legacy "Agent" column is free text; a few cells carry an explanation rather than a name
 * ("Matt-since it was Juan"). Assigned Owner is a validated dropdown, so the name is extracted and
 * the explanation kept in Visit Notes — nothing lost, nothing failing validation.
 * Compound names first, so "Matt/Arly" is not matched as "Matt".
 */
var LEGACY_AGENTS = ['Matt/Arly', 'Matt/Juan', 'Cherry/Matt', 'Jonathan', 'Danica', 'Darius',
                     'Cherry', 'Team', 'Arly', 'Matt', 'Kyle', 'Juan'];

function legacyText_(value) {
  if (value == null) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') return legacyDate_(value);
  if (typeof value === 'number' && value === Math.floor(value)) return String(value);
  return String(value).replace(/[ \t]+/g, ' ').trim();
}

/** yyyy-mm-dd in the script's own timezone, so a date never slips a day. */
function legacyDate_(value) {
  if (Object.prototype.toString.call(value) !== '[object Date]' || isNaN(value.getTime())) return '';
  return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** Returns [assignedOwner, leftoverNote]; either may be ''. */
function legacySplitAgent_(raw) {
  if (!raw) return ['', ''];
  for (var i = 0; i < LEGACY_AGENTS.length; i++) {
    var name = LEGACY_AGENTS[i];
    if (raw.toLowerCase().indexOf(name.toLowerCase()) === 0) {
      return [name, raw.slice(name.length).replace(/^[\s\-–—:;,]+|[\s\-–—:;,]+$/g, '')];
    }
  }
  return ['', raw];   // unrecognised: keep it as a note, never as an owner
}

/**
 * Decide the tracker stage. Order matters: a contract outranks a deal stage, which outranks the
 * inspection result. Returns '' when the legacy data does not actually say.
 */
function legacyCurrentStage_(stage, status, inspection, contract) {
  if (contract === 'Acquired' || contract === 'Under Contract') return 'Contract Signed';
  if (contract === 'Cancelled Contract') return 'Lost / Closed Out';

  if (stage === 'Lost') return 'Lost / Closed Out';
  if (stage === 'Won') return 'Contract Signed';
  if (stage === 'On Hold') return 'Long-Term Nurture';
  if (stage === 'Active') {
    if (status.indexOf('On Hold') === 0) return 'Long-Term Nurture';
    if (status.indexOf('Acquired') === 0 || status.indexOf('Wholesale') === 0) return 'Contract Signed';
    if (LEGACY_ACTIVE_STAGE[status]) return LEGACY_ACTIVE_STAGE[status];
    if (inspection === 'Pending Inspection') return 'Visit Scheduled';
    if (inspection === 'Inspected') return 'Visit Completed — Needs Review';
    return '';
  }

  // No deal stage recorded. Only the unambiguous inspection results imply a stage.
  if (inspection === 'Inspected') return 'Visit Completed — Needs Review';
  if (inspection === 'Pending Inspection') return 'Visit Scheduled';
  return '';   // includes "cancelled with no deal stage" — genuinely needs a human
}

function legacyDisposition_(stage, contract) {
  if (contract === 'Acquired' || stage === 'Won') return 'Contracted';
  if (stage === 'Lost' || contract === 'Cancelled Contract') return 'Lost';
  if (stage === 'On Hold') return 'Long-Term Nurture';
  return '';
}

/** One legacy row -> a { header: value } record. Returns null for an empty row. */
function mapLegacyRow_(row, propertyId) {
  var at = function (key) { return row[LEGACY_COL[key] - 1]; };

  var name = legacyText_(at('name'));
  var address = legacyText_(at('address'));
  if (!name && !address) return null;

  var inspection = legacyText_(at('inspection'));
  var stage = LEGACY_DEAL_STAGE[legacyText_(at('stage')).toLowerCase()] || '';
  var rawStatus = legacyText_(at('status'));
  var status = LEGACY_DEAL_STATUS[rawStatus.toLowerCase()] || rawStatus;
  var contract = legacyText_(at('contract'));

  var agent = legacySplitAgent_(legacyText_(at('agent')));
  var notes = legacyText_(at('notes'));
  if (agent[1]) notes = (notes ? notes + ' | ' : '') + 'Agent note: ' + agent[1];

  var lastUpdate = legacyDate_(at('lastupdate'));

  return {
    'Property ID': propertyId,
    'Property Address': address,
    'Seller Name': name,
    'Phone': legacyText_(at('phone')),
    'Lead Source': legacyText_(at('source')),
    'Visit Date': legacyDate_(at('appointment')),
    'Visit Status': LEGACY_VISIT_STATUS[inspection.toLowerCase()] || '',
    'Assigned Visitor': legacyText_(at('inspector')),
    'Visit Notes': notes,
    'Last Contact Date': lastUpdate,
    'Assigned Owner': agent[0],
    'Current Stage': legacyCurrentStage_(stage, status, inspection, contract),
    'Final Disposition': legacyDisposition_(stage, contract),
    'Closeout Reason': stage === 'Lost' ? status : '',
    'Created Date': legacyDate_(at('created')),
    'Last Updated Date': lastUpdate || legacyDate_(at('created')),
    'Updated By': 'Import',
    'Source': 'Import',
    'City': legacyText_(at('city')),
    'Deal Stage': stage,
    'Deal Status': status,
    'Contract Status': contract,
    'Closer': legacyText_(at('closer')),
    'Golden Needle': legacyText_(at('golden')).toLowerCase() === 'true' ? 'Yes' : '',
    'Market Status Update': legacyText_(at('market'))
  };
}

/**
 * Columns whose dropdown REJECTS anything not on the list. 'Updated By' and 'Gift Approved By' are
 * deliberately excluded — Setup.gs builds those as soft rules that accept any value.
 */
var IMPORT_HARD_DROPDOWNS = ['Lead Source', 'Visit Status', 'Assigned Visitor', 'Assigned Owner',
  'Current Stage', 'Final Disposition', 'Source', 'Deal Stage', 'Deal Status', 'Contract Status',
  'Closer', 'Golden Needle'];

/** Returns [{ header, value, count }] for every value a dropdown would reject. */
function legacyIllegalValues_(records) {
  var out = [];
  IMPORT_HARD_DROPDOWNS.forEach(function (header) {
    var allowed = DROPDOWNS[header];
    if (!allowed) return;
    var legal = {};
    allowed.forEach(function (v) { legal[String(v)] = true; });

    var counts = {};                       // offending value -> how many records carry it
    records.forEach(function (rec) {
      var value = rec[header];
      if (value === '' || value === undefined || value === null) return;   // blank is always allowed
      value = String(value);
      if (legal[value]) return;
      counts[value] = (counts[value] || 0) + 1;
    });
    Object.keys(counts).forEach(function (value) {
      out.push({ header: header, value: value, count: counts[value] });
    });
  });
  return out;
}

/** Accepts a full Drive URL or a bare file ID. */
function legacyFileId_(input) {
  var text = String(input || '').trim();
  var match = text.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (match) return match[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(text) ? text : '';
}

/** Dry run. Reports exactly what a real import would do, and changes nothing. */
function previewImportFromOldWorkbook() {
  importFromOldWorkbook_(true);
}

function importFromOldWorkbook() {
  importFromOldWorkbook_(false);
}

function importFromOldWorkbook_(previewOnly) {
  var ui = SpreadsheetApp.getUi();
  var sh = dataSheet_();
  if (!sh) { ui.alert('Run "Build structure (setup)" first.'); return; }

  // ---- which workbook -----------------------------------------------------------------
  var answer = ui.prompt(
    'Import from the old workbook',
    'Paste the link to the old "Property Visit Tracking" Google Sheet.\n\n' +
    'Leave it blank to use the one already in your Drive:\n' +
    'https://docs.google.com/spreadsheets/d/' + OLD_WORKBOOK_ID + '/edit\n\n' +
    'It must be a Google Sheet, not an .xlsx file. To convert an .xlsx: open it in Drive, then\n' +
    'File → Save as Google Sheets, and paste that link here instead.',
    ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return;

  var fileId = legacyFileId_(answer.getResponseText()) || OLD_WORKBOOK_ID;

  var source;
  try {
    source = SpreadsheetApp.openById(fileId);
  } catch (err) {
    ui.alert('Cannot open that workbook.\n\n' + err.message +
             '\n\nCheck the link, and that it is a Google Sheet (not .xlsx) you have access to.');
    return;
  }

  var tab = source.getSheetByName(OLD_WORKBOOK_TAB);
  if (!tab) {
    ui.alert('"' + source.getName() + '" has no "' + OLD_WORKBOOK_TAB + '" tab.\n\nTabs found: ' +
             source.getSheets().map(function (s) { return s.getName(); }).join(', '));
    return;
  }

  // ---- sanity-check the source layout before trusting any of it -------------------------
  var values = tab.getDataRange().getValues();
  if (values.length < 2) { ui.alert('The "' + OLD_WORKBOOK_TAB + '" tab has no data rows.'); return; }
  var headerRow = values[0].map(function (h) { return legacyText_(h).toLowerCase(); });
  var expected = [
    { at: LEGACY_COL.name, want: 'name' },
    { at: LEGACY_COL.phone, want: 'phone' },
    { at: LEGACY_COL.address, want: 'address' },
    { at: LEGACY_COL.inspection, want: 'inspection status' },
    { at: LEGACY_COL.stage, want: 'deal stage' }
  ];
  var wrong = expected.filter(function (e) { return headerRow[e.at - 1] !== e.want; });
  if (wrong.length) {
    ui.alert('That tab is not laid out the way this import expects.\n\n' +
      wrong.map(function (e) {
        return 'column ' + e.at + ' should be "' + e.want + '" but is "' + (headerRow[e.at - 1] || '(blank)') + '"';
      }).join('\n') +
      '\n\nNothing was changed.');
    return;
  }

  // ---- what is already here -------------------------------------------------------------
  var lastRow = sh.getLastRow();
  var existing = {};
  var firstEmpty = CFG.FIRST_DATA_ROW;
  var highestId = 1000;   // imports start at TVL-1001, clear of the TVL-00xx pilot rows
  if (lastRow >= CFG.FIRST_DATA_ROW) {
    var block = sh.getRange(CFG.FIRST_DATA_ROW, 1, lastRow - CFG.FIRST_DATA_ROW + 1, HEADERS.length).getValues();
    var addrAt = col('Property Address') - 1;
    var idAt = col('Property ID') - 1;
    for (var i = 0; i < block.length; i++) {
      var key = importNormAddr_(block[i][addrAt]);
      if (key) { existing[key] = true; firstEmpty = CFG.FIRST_DATA_ROW + i + 1; }
      var num = String(block[i][idAt] || '').match(/TVL-(\d+)/);
      if (num && Number(num[1]) > highestId) highestId = Number(num[1]);
    }
  }

  // ---- map ------------------------------------------------------------------------------
  var records = [];
  var duplicates = 0, blanks = 0, noAddress = 0;
  var seen = {};
  for (var r = 1; r < values.length; r++) {
    var mapped = mapLegacyRow_(values[r], '');
    if (!mapped) { blanks++; continue; }
    var addrKey = importNormAddr_(mapped['Property Address']);
    if (!addrKey) { noAddress++; continue; }
    if (existing[addrKey] || seen[addrKey]) { duplicates++; continue; }
    seen[addrKey] = true;
    highestId++;
    mapped['Property ID'] = 'TVL-' + ('000' + highestId).slice(-4);
    records.push(mapped);
  }

  // ---- would any value be rejected by a dropdown? ---------------------------------------
  // Data validation is enforced on write: one bad value throws and takes the whole import with it
  // ("cell L43 violates the data validation rules"). Catch it here, name it, and say what to do —
  // rather than letting a raw exception surface after the user has already committed.
  var illegal = legacyIllegalValues_(records);
  var needRows = firstEmpty + records.length - 1;
  var unstaged = records.filter(function (rec) { return !rec['Current Stage']; }).length;
  var summary =
    'Source: "' + source.getName() + '" → tab "' + OLD_WORKBOOK_TAB + '" (' + (values.length - 1) + ' rows)\n\n' +
    '  ' + records.length + ' new record(s) will be added, starting at row ' + firstEmpty + '\n' +
    '  ' + duplicates + ' skipped — that address is already in Data\n' +
    (noAddress ? '  ' + noAddress + ' skipped — no property address\n' : '') +
    (blanks ? '  ' + blanks + ' empty row(s) ignored\n' : '') +
    '  ' + unstaged + ' will have no stage → they appear under "⚑ Unrouted — Needs Attention"\n' +
    (needRows > CFG.MAX_ROWS
      ? '\n  STOP: this needs row ' + needRows + ' but formulas only reach row ' + CFG.MAX_ROWS +
        '.\n  Run "Repair sheet" first, then import again.\n'
      : '') +
    (illegal.length
      ? '\n  These values are not on their dropdown list. The import refreshes the lists before\n' +
        '  writing, so this normally fixes itself — if it persists, the value needs adding to\n' +
        '  DROPDOWNS in the script:\n' +
        illegal.slice(0, 10).map(function (bad) {
          return '    ' + bad.header + ': "' + bad.value + '" (' + bad.count + ' record(s))';
        }).join('\n') +
        (illegal.length > 10 ? '\n    ...and ' + (illegal.length - 10) + ' more' : '') + '\n'
      : '');

  if (previewOnly) { ui.alert('Preview only — nothing was changed.\n\n' + summary); return; }
  if (needRows > CFG.MAX_ROWS) { ui.alert(summary); return; }
  if (!records.length) { ui.alert(summary + '\nNothing to do.'); return; }
  if (ui.alert(summary + '\nImport now?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  // ---- write ------------------------------------------------------------------------------
  ensureRows_(sh, needRows);

  // Refresh the dropdown rules from DROPDOWNS before writing. Data validation is enforced on write:
  // if the sheet still carries an older list, a legitimate value like "Juan Diaz" throws and takes
  // the entire import down. Doing it here means the import cannot fail for that reason, whether or
  // not "Repair sheet" was run first.
  applyDropdowns_(sh);

  var skip = {};
  IMPORT_SKIP_COLUMNS.forEach(function (h) { skip[h] = true; });

  var grid = records.map(function (rec) {
    return HEADERS.map(function (header) {
      if (skip[header]) return '';                 // the sheet owns these; formulas go back below
      var v = rec[header];
      return v === undefined || v === null ? '' : v;
    });
  });

  try {
    sh.getRange(firstEmpty, 1, grid.length, HEADERS.length).setValues(grid);
  } catch (err) {
    // Almost always a data-validation rejection naming one cell. Translate the cell reference into
    // the column and value that caused it, so the fix is obvious.
    var cell = String(err.message || '').match(/cell ([A-Z]+)(\d+)/);
    var detail = '';
    if (cell) {
      var index = 0;
      for (var c = 0; c < cell[1].length; c++) index = index * 26 + (cell[1].charCodeAt(c) - 64);
      var offender = grid[Number(cell[2]) - firstEmpty];
      detail = '\n\nColumn: "' + (HEADERS[index - 1] || cell[1]) + '"' +
               (offender ? '\nValue: "' + offender[index - 1] + '"' : '');
    }
    ui.alert('The import was rejected and NOTHING was written.\n\n' + err.message + detail +
             '\n\nAdd that value to its dropdown list in the script (DROPDOWNS), then try again.');
    logAuto_('ERROR', 'import', 'Legacy import rejected: ' + err.message);
    return;
  }
  for (var w = 0; w < grid.length; w++) restoreFormulasRow_(sh, firstEmpty + w);
  SpreadsheetApp.flush();

  logAuto_('INFO', 'import', 'Imported ' + grid.length + ' record(s) from "' + source.getName() +
    '"; skipped ' + duplicates + ' duplicate(s).');
  ui.alert('Done — ' + grid.length + ' record(s) imported.\n\n' +
    duplicates + ' duplicate address(es) skipped.\n' +
    unstaged + ' record(s) need a stage; find them in the dashboard under ' +
    '"⚑ Unrouted — Needs Attention".\n\n' +
    'Reload the dashboard to see them (Deploy → New version if you also changed code).');
}
