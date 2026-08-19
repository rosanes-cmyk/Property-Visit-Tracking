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
  /*
   * Six things at the top, everything else behind a submenu.
   *
   * The client, hunting for the item that posts the work queue: "i cant see that". It was there — item five
   * of forty-five, in one flat list far taller than the screen, so reaching it meant scrolling a menu most
   * people do not realise scrolls. Two screenshots came back from different parts of the same list.
   *
   * So the split is by how often a thing is used, not by what it belongs to. The top level is the handful of
   * actions someone runs during a normal day; the schedules, the one-time setup and the destructive
   * operations sit in submenus where they are found on purpose rather than met by accident.
   *
   * Every function name below is unchanged — the triggers call these by name, so nothing needs reinstalling.
   * Two LABELS changed: the work-queue and visit-digest items now say what the cards they post are called,
   * because "needs attention digest" appears nowhere on the card it produces.
   */
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('🏠 Twin Visit Logger')
    .addItem('💬 Post the work queue now', 'sendAttentionDigestNow')
    .addItem('💬 Post the morning visit digest now', 'sendVisitDigestNow')
    .addItem('💬 Check for new bookings now', 'notifyNewBookingsNow')
    .addItem('📝 Check notes for visit outcomes now', 'auditVisitNotesNow')
    .addItem('📧 Check REI emails now', 'checkReiEmailsNow')
    .addItem('💻 Which PC is running the automation?', 'showActiveMachine')
    .addSeparator()
    .addSubMenu(ui.createMenu('💬 Chat — schedules and setup')
      .addItem('Turn ON work-queue digest (9am + 11am + 4pm)', 'installChatAttentionTrigger')
      .addItem('Turn ON morning visit digest (9am)', 'installChatDigestTrigger')
      .addItem('Turn ON new-booking alerts (every 5 min)', 'installChatNewBookingTrigger')
      .addSeparator()
      .addItem('Turn OFF work-queue digest', 'removeChatAttentionTrigger')
      .addItem('Turn OFF morning visit digest', 'removeChatDigestTrigger')
      .addItem('Turn OFF new-booking alerts', 'removeChatNewBookingTrigger')
      .addSeparator()
      .addItem('Set Google Chat webhook', 'setChatWebhook')
      .addItem('🔗 Set dashboard link (for Chat cards)', 'setDashboardUrl'))
    .addSubMenu(ui.createMenu('📝 Notes audit')
      .addItem('Check notes for visit outcomes now', 'auditVisitNotesNow')
      .addItem('Turn ON hourly notes audit', 'installNotesAuditTrigger')
      .addItem('Turn OFF notes audit', 'removeNotesAuditTrigger'))
    .addSubMenu(ui.createMenu('💻 The PC app')
      .addItem('Which PC is running the automation?', 'showActiveMachine')
      .addItem('Publish settings for the PC app', 'publishAgentSettings')
      .addItem('Release the PC (let another take over)', 'releaseActiveMachine'))
    .addSubMenu(ui.createMenu('📥 Intake Inbox')
      .addItem('Check Intake Inbox now', 'checkIntakeInboxNow')
      .addItem('Turn ON auto-check (every 10 min)', 'installInboxTrigger')
      .addItem('Turn OFF auto-check', 'removeInboxTrigger')
      .addSeparator()
      .addItem('Set up Intake Inbox (create tab)', 'setupIntakeInbox'))
    .addSubMenu(ui.createMenu('📧 Gmail auto-reader (REI tasks)')
      .addItem('Check REI emails now', 'checkReiEmailsNow')
      .addItem('Turn ON Gmail auto-reader (every minute)', 'installGmailTrigger')
      .addItem('Turn OFF Gmail auto-reader', 'removeGmailTrigger')
      .addSeparator()
      .addItem('Set up Gmail auto-reader (REI tasks)', 'setupGmailIntake'))
    .addSubMenu(ui.createMenu('📦 Import and duplicates')
      .addItem('Preview import from the old workbook (changes nothing)', 'previewImportFromOldWorkbook')
      .addItem('Import from the old workbook', 'importFromOldWorkbook')
      .addItem('Import legacy rows (from a pasted CSV tab)', 'importLegacyRows')
      .addSeparator()
      .addItem('🔎 Find duplicate records', 'findDuplicateRecords'))
    .addSubMenu(ui.createMenu('🛠 Setup and repair')
      .addItem('1) Build structure (setup)', 'setup')
      .addItem('2) Load pilot + test data', 'loadPilotData')
      .addItem('3) Run tests', 'runAllTests')
      .addItem('4) Install automation triggers', 'installTriggers')
      .addSeparator()
      .addItem('Send daily report now (preview)', 'sendDailyReport')
      .addItem('Repair sheet (formulas / validation / formatting)', 'repairSheet')
      .addItem('🔧 Fix mismatched stages (cards stuck in wrong section)', 'repairStages')
      .addItem('🗓 Remove orphaned calendar events', 'purgeOrphanCalendarEvents'))
    /*
     * On their own at the bottom, and last. Every one of these deletes something that cannot be typed back:
     * rows, calendar events, or every trigger in the project. They were previously in the same flat run as
     * "Check REI emails now", one slip of the mouse apart.
     */
    .addSubMenu(ui.createMenu('⚠️ Deletes data — be careful')
      .addItem('Remove test data (Source = TEST)', 'removeTestData')
      .addItem('Remove test artifacts (go-live cleanup)', 'removeTestArtifacts')
      .addItem('Clear all data rows (+ their calendar events)', 'clearAllData')
      .addItem('⛔ Remove ALL triggers (kill switch)', 'removeAllTriggers'))
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
  MAX_ROWS: 1200,          // formulas maintained down to this row (raised from 500 for the 379-row legacy import)
  REPORT_TITLE: 'Twin Visit Logger Daily Opportunity Report',
  // Set to Cherry's address for the daily report; left blank = report is written to a sheet only.
  REPORT_TO: '',           // e.g. 'rosanes@twinhomebuyer.com'
  STALLED_BUSINESS_DAYS: 3,
  // A "completed visit" is only nagged for missing Visit Notes / Seller Motivation this recently.
  // Older visits are history: the imported records go back to 2023 and nobody is going to fill
  // those in, so flagging them only hides the visits that genuinely need writing up.
  RECENT_VISIT_DAYS: 30,
  // A record with no activity for this long is dormant, not incomplete. The imported history has no
  // Next Action / Due Date / Owner because the old workbook never had those fields; demanding them
  // from a lead that went quiet 18 months ago flags it forever with nothing anyone will do about it.
  // Forgotten-but-live deals are caught separately by Stalled Status, which uses business days.
  DORMANT_DAYS: 90,
  NO_DECISION_BUSINESS_DAYS: 1,
  TASK_QUEUE_SHEET: 'Task Queue',   // visible internal task delivery (pilot)
  TEST_DATA_SHEET: 'Test Data',     // Source=TEST records live here, not on the live Board
  TRASH_SHEET: 'Trash',             // soft-deleted records (restorable from the dashboard)
  // Put the pre-cutover imported rows back into the 3pm work queue. Off: they stay in the sheet and
  // on the dashboard, but out of the daily message — see excludedFromDigest_.
  DIGEST_INCLUDE_IMPORTED: false,
  INTAKE_INBOX_SHEET: 'Intake Inbox', // Zapier writes appointments here; a 10-min trigger logs them (for Workspaces that block public web apps)
  // Shared secret for the external website's JSON API (set the SAME value in Vercel APPS_SCRIPT_TOKEN).
  // Leave '' to disable the API (HTML dashboard still works). Use a long random string.
  API_TOKEN: '',
  SANDBOX: true,
  VISIT_CALENDAR_ID: 'rosanes@twinhomebuyer.com',
  // Preferred target: resolved by calendar NAME at runtime, so no calendar ID has to be
  // pasted and it keeps working if the ID changes. Must be a calendar this account can
  // EDIT (view-only access cannot create events). Falls back to VISIT_CALENDAR_ID when blank.
  VISIT_CALENDAR_NAME: "Juan's Official Calendar",
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
  // Fields the live "Property Visit Tracking" workbook tracked that had no home here. Appended so
  // every existing column keeps its position on the live sheet.
  'City','Deal Stage','Deal Status','Contract Status','Closer','Golden Needle','Market Status Update',
];

const DROPDOWNS = {
  'Visit Status': ['Scheduled','Completed','Canceled','Reschedule Needed','Skipped \u2014 Offer Made'],
  'Current Stage': ['Visit Scheduled','Visit Completed — Needs Review','Offer Preparation','Offer Sent','Active Negotiation','Verbal Agreement','Contract Sent','Contract Signed','Long-Term Nurture','Lost / Closed Out'],
  // Both lists carry every real name found in the live workbook, so an import does not fail
  // validation. 'Juan Diaz' and 'Juan' are both present because the old sheet used both.
  /*
   * ADDED, never replaced: 'Thea' and 'Genesis'.
   *
   * The client wants the booking form to offer Thea, Cherry and Genesis only — but this list is the sheet's
   * DATA VALIDATION, and a value outside it fails the whole row write, not just its own cell. Deleting the
   * names already in use would break every existing row that holds one, and the next automated write to any
   * of them would throw. So the workbook keeps the long list and the FORM offers the short one
   * (BOOKING_OWNERS below).
   */
  'Assigned Owner': ['Jonathan','Kyle','Cherry','Juan','Arly','Matt','Darius','Danica','Team','Matt/Arly','Matt/Juan','Cherry/Matt','Thea','Genesis'],
  'Assigned Visitor': ['Juan','Juan Diaz','Kyle','Cherry','Jonathan','Cesar','Jose Herrera','Manny Morales','Lily','Alan Hernandez'],
  'Gift Approval Owner': ['Cherry','Juan'],
  'Gift Approved By': ['Cherry','Juan'],
  'Updated By': ['Jonathan','Kyle','Cherry','Juan','Apps Script','Import'],
  'Final Disposition': ['Contracted','Lost','Long-Term Nurture','Closed Out'],
  'Gift Status': ['Not Reviewed','Recommended','Approved','Sent','Not Appropriate'],
  'Blocker': ['Price','Title','Tenant','Family','Access','Timing','Documents','Property Condition','Seller Unresponsive','Other'],
  // 'MLS' added at the client's request. REI writes it as "MLS/ Redfin", which lead-source-map.mjs maps in.
  'Lead Source': ['Direct Mail','Direct Mail - Postcard','PPC','TV','Facebook','SEO','PPL - Property Leads','PPL - Motivated Leads','MLS'],
  'Offer Status': ['Not Started','In Preparation','Sent','Countered','Accepted','Rejected','Withdrawn'],
  'Occupancy Status': ['Owner-Occupied','Tenant-Occupied','Vacant','Unknown'],
  'Property Condition': ['Excellent','Good','Fair','Poor','Distressed'],
  'Seller Timeline': ['ASAP','30 days','60 days','90+ days','Unknown'],
  'Offer Received Confirmation': ['Yes','No'],
  'Transaction Handoff Status': ['Not Ready','Ready for Handoff','Handed Off','Handoff Confirmed'],
  'REI Update Required': ['Yes','No'],
  'REI Update Completed': ['Yes','No'],
  'Source': ['Manual','Apps Script','Import','Intake','Intake-Sandbox','TEST'],
  // The company's own taxonomy, copied verbatim from the live workbook's
  // "Ref (Deals) - Tags definition" tab. Deal Stage is the four-way bucket; Deal Status is the
  // detail. These are what the team already uses in REI BlackBook \u2014 do not re-word them.
  'Deal Stage': ['Active','On Hold','Won','Lost'],
  'Deal Status': [
    'Lead Received','Appointment Scheduled','Pending Reschedule','Under Review','Offer Made','Under Contract',
    'On Hold - Follow Up Scheduled','On Hold - Nurture','On Hold - Awaiting Seller','On Hold - Probate/Legal','On Hold - Seller Timeline',
    'Acquired','Acquired - In Rehab','Acquired - Listed','Acquired - Sold','Wholesale - Buyer Assigned','Wholesale - Deal Closed',
    'Not Qualified',"We're Passing",'Contract Cancelled','Seller Rejected Offer','Did Not Proceed','Sold to Competitor',
    'Sold with Realtor','Referred to Realtor','Already listed','Sold (unknown buyer)'
  ],
  'Contract Status': ['Under Contract','Cancelled Contract','Acquired'],
  'Closer': ['Juan Diaz','Jose Herrera','Cherry','Jonathan','Kyle'],
  'Golden Needle': ['Yes'],
};

/**
 * Where a column REALLY is, read from the sheet's own header row.
 *
 * This used to be HEADERS.indexOf(name) + 1 — the position in the array above. The live Data tab has
 * drifted to 74 columns against the 72 declared here, because the Node automation appends a column
 * whenever one of its aliases finds no match (ADD_MISSING_COLUMNS=true). From 'REI BlackBook Link'
 * onward, everything in the real sheet now sits one column to the right of where this code believed it
 * was — so every read and write was addressing the neighbouring cell. The dashboard handed a
 * reiblackbook.com URL to a field expecting a visit date, and a webAction write would have put the
 * value in the wrong column altogether.
 *
 * So the sheet is the authority on WHERE a column is; HEADERS is only the list of names this code knows
 * about. Cached for the execution: one read of the header row per run, not one per lookup.
 */
var HEADER_INDEX_ = null;
function headerIndex_() {
  if (HEADER_INDEX_) return HEADER_INDEX_;
  const map = {};
  const sh = dataSheet_();
  const width = sh ? sh.getLastColumn() : 0;
  if (width > 0) {
    const live = sh.getRange(CFG.HEADER_ROW, 1, 1, width).getValues()[0];
    live.forEach(function (name, i) {
      const key = String(name).trim();
      // First occurrence wins, so a duplicated heading further right cannot shadow the real column.
      if (key && !(key in map)) map[key] = i + 1;
    });
  }
  HEADER_INDEX_ = map;
  return map;
}

/** column index (1-based) for a header name — the sheet's position, not the array's */
function col(name) {
  const live = headerIndex_()[name];
  if (live) return live;
  // Not on the sheet yet (a fresh tab, or a column setup() has still to add): fall back to the
  // declared position, which is what a newly built sheet will have anyway.
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
      // The country suffix is stripped FIRST, while the commas are still there to anchor it. REI
      // writes ", UNITED STATES" on every address and the old workbook never did, so without this
      // the same property reads as two different ones and duplicates silently.
      return '=IF(' + A('Property Address') + '="","",TRIM(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(' +
        'LOWER(' + A('Property Address') + '),", united states",""),", usa",""),",",""),".",""),"#","")," apt "," ")," unit "," ")," ste "," ")," suite "," "),"  "," ")))';
    case 'Days Since Last Activity':
      return '=IF(' + A('Property Address') + '="","",IF(MAX(' + A('Last Contact Date') + ',' + A('Last Updated Date') + ',' + A('Visit Date') + ')=0,"",TODAY()-MAX(' + A('Last Contact Date') + ',' + A('Last Updated Date') + ',' + A('Visit Date') + ')))';
    case 'Days Overdue':
      return '=IF(' + A('Property Address') + '="","",IF(' + A('Next Action Due Date') + '="","",IF(TODAY()>' + A('Next Action Due Date') + ',TODAY()-' + A('Next Action Due Date') + ',0)))';
    case 'Stalled Status':
      // "Stalled" means a LIVE deal losing momentum, so it is a WINDOW, not just a minimum age:
      // at least STALLED_BUSINESS_DAYS of silence, but no more than DORMANT_DAYS. Without the upper
      // bound every one of the 379 imported records reads as stalled forever — a lead last touched
      // in 2024 is not stalled, it is dormant, and burying today's slipping deals under it makes the
      // signal useless.
      var LAST = 'MAX(' + A('Last Contact Date') + ',' + A('Last Updated Date') + ',' + A('Visit Date') + ')';
      return '=IF(' + A('Property Address') + '="","",IF(OR(' + A('Current Stage') + '="Lost / Closed Out",' +
        A('Current Stage') + '="Long-Term Nurture",' + A('Current Stage') + '="Contract Signed"),"No",' +
        'IF(' + LAST + '=0,"No",IF(AND(NETWORKDAYS(' + LAST + ',TODAY())-1>=' + CFG.STALLED_BUSINESS_DAYS +
        ',TODAY()-' + LAST + '<=' + CFG.DORMANT_DAYS + '),"Yes","No"))))';
    case 'Missing Required Fields':
      // Finished records are exempt, same as Exception Reason. The REI link is only required of
      // records the automation created: the imported history has no REI contact and never will, so
      // demanding one would flag 379 rows permanently with nothing anyone can do about it.
      // Only a record with recent activity is asked for the follow-up fields; see CFG.DORMANT_DAYS.
      var LASTACT = 'MAX(' + A('Last Contact Date') + ',' + A('Last Updated Date') + ',' + A('Visit Date') + ')';
      var ACTIVE = 'AND(' + LASTACT + '<>0,' + LASTACT + '>=TODAY()-' + CFG.DORMANT_DAYS + ')';
      return '=IF(OR(' + A('Property Address') + '="",' + A('Current Stage') + '="Lost / Closed Out",' +
        A('Current Stage') + '="Contract Signed"),"",TEXTJOIN(", ",TRUE,' +
        'IF(' + A('Property Address') + '="","Property Address",""),' +
        'IF(' + A('Current Stage') + '="","Current Stage",""),' +
        'IF(AND(' + ACTIVE + ',' + A('Next Action') + '=""),"Next Action",""),' +
        'IF(AND(' + ACTIVE + ',' + A('Next Action Due Date') + '=""),"Next Action Due Date",""),' +
        'IF(AND(' + ACTIVE + ',' + A('Assigned Owner') + '=""),"Assigned Owner",""),' +
        'IF(AND(' + A('Source') + '<>"Import",' + A('REI BlackBook Link') + '=""),"REI BlackBook Link","")))';
    case 'Duplicate Address Flag':
      return '=IF(' + A('Normalized Address') + '="","",IF(COUNTIFS(' + R('Normalized Address') + ',' + A('Normalized Address') + ',' + R('Current Stage') + ',"<>Lost / Closed Out")>1,"Duplicate",""))';
    case 'Opportunity Priority':
      /*
       * A visit HAPPENING TODAY outranks everything, and the bonus decays as the date recedes.
       *
       * The client, pointing at the board's booking button: "if someone added in here this should be prio
       * and work all ASAP." They are right, and the plain stage score could not express it — Visit
       * Scheduled sat at 30, below Offer Preparation, so a visit this afternoon ranked beneath paperwork.
       *
       * The bonus is TIME-based rather than a flat promotion, and that distinction matters. Simply putting
       * Visit Scheduled above Verbal Agreement would rank a visit booked for next month above a contract
       * about to be signed, which is wrong and would teach everyone to ignore the ordering. A visit today
       * is the thing that genuinely cannot slip: it is at a fixed hour, with somebody expecting you at a
       * house. A signature is not.
       *
       *   today          30 + 75 = 105   above every stage
       *   tomorrow       30 + 50 =  80   between Active Negotiation and Offer Sent
       *   within 7 days  30 + 25 =  55
       *   later          30              unchanged
       *
       * Only while Visit Status is still Scheduled — a completed or cancelled visit must not keep the
       * bonus and sit at the top of the board for the rest of the day.
       */
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
        'TRUE,0)+IF(' + A('Days Overdue') + '="",0,MIN(' + A('Days Overdue') + ',20))+IF(' + A('Stalled Status') + '="Yes",5,0)' +
        '+IF(AND(' + A('Visit Status') + '="Scheduled",' + A('Visit Date') + '<>""),' +
        'IFS(' + A('Visit Date') + '=TODAY(),75,' +
        A('Visit Date') + '=TODAY()+1,50,' +
        'AND(' + A('Visit Date') + '>TODAY(),' + A('Visit Date') + '<=TODAY()+7),25,' +
        'TRUE,0),0))';
    case 'Data Quality Status':
      return '=IF(' + A('Property Address') + '="","",IF(' + A('Exception Reason') + '<>"","Exception",IF(' + A('Missing Required Fields') + '<>"","Incomplete","OK")))';
    case 'Exception Reason':
      // Finished records are never chased. A deal that is lost or signed has nothing left to fix,
      // and nagging three years of closed history buries the handful of records that DO need work.
      // The two "completed visit" data-capture nags are also scoped to the last 30 days: they exist
      // to catch a visit Juan did last week, not one from 2023 nobody will revisit.
      return '=IF(OR(' + A('Property Address') + '="",' + A('Current Stage') + '="Lost / Closed Out",' +
        A('Current Stage') + '="Contract Signed"),"",TEXTJOIN(" | ",TRUE,' +
        'IF(AND(' + A('Visit Status') + '="Completed",' + A('Visit Date') + '>=TODAY()-' + CFG.RECENT_VISIT_DAYS + ',' + A('Visit Notes') + '=""),"Completed visit missing Visit Notes",""),' +
        'IF(AND(' + A('Visit Status') + '="Completed",' + A('Visit Date') + '>=TODAY()-' + CFG.RECENT_VISIT_DAYS + ',' + A('Seller Motivation') + '=""),"Completed visit missing Seller Motivation (or add Exception note)",""),' +
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

  const hdr = ['Address','Seller','Stage','Next Action','Owner','Due','Days Overdue','Blocker','Last Contact Result','REI Link'];
  /*
   * Section 0 exists because of a straightforward gap: every other section filters on a stage like
   * Verbal Agreement, Offer Sent, Stalled or Days Overdue > 0, and a visit that has merely been BOOKED
   * matches none of them. So the one thing this automation creates — an upcoming property visit — could
   * not appear on the board at all until it went overdue or became an exception. A visit booked for
   * tomorrow is the most actionable row in the workbook, and it was the only one with nowhere to sit.
   *
   * It carries its own select and header so the date column shows the VISIT date rather than the next
   * action due date, which is the date that matters for a visit that has not happened yet.
   */
  const upcomingSel = disp.map(function (d) {
    return colL(d === 'Next Action Due Date' ? 'Visit Date' : d);
  }).join(',');
  const upcomingHdr = hdr.map(function (h) { return h === 'Due' ? 'Visit Date' : h; });

  const sections = [
    ['0. Visits Booked — Upcoming', stage + "='Visit Scheduled'", colL('Visit Date'),
      upcomingSel, upcomingHdr],
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
  let row = 4;
  sections.forEach(function(s){
    sh.getRange(row,1,1,10).merge().setValue(s[0]).setFontWeight('bold').setFontSize(12)
      .setFontColor('#ffffff').setBackground('#2e75b6');
    row++;
    // A section may override the columns it selects and their headers (see section 0).
    const sectionSel = s[3] || sel;
    const sectionHdr = s[4] || hdr;
    sh.getRange(row,1,1,sectionHdr.length).setValues([sectionHdr])
      .setFontWeight('bold').setBackground('#ddebf7').setFontSize(9);
    row++;
    // live Board excludes Source=TEST records (they live in the Test Data sheet)
    const q = '=IFERROR(QUERY(' + CFG.DATA_SHEET + '!A' + CFG.FIRST_DATA_ROW + ':BZ' + CFG.MAX_ROWS + ',' +
      '"select ' + sectionSel + ' where ' + addr + ' is not null and ' + src + " <> 'TEST' and " + s[1] + ' order by ' + s[2] +
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

/**
 * Clear every data row, and remove the calendar events those rows created.
 *
 * Clearing rows used to leave their events behind on the calendar: the team then saw visits that no
 * longer existed anywhere in the tracker. Events are removed BEFORE the addresses are wiped, since
 * the address is what identifies an event.
 */
function clearAllData() {
  const sh = dataSheet_();
  const last = Math.max(sh.getLastRow(), CFG.FIRST_DATA_ROW);
  var removed = 0;
  if (last >= CFG.FIRST_DATA_ROW) {
    const rows = sh.getRange(CFG.FIRST_DATA_ROW, 1, last - CFG.FIRST_DATA_ROW + 1, HEADERS.length).getValues();
    rows.forEach(function (r) {
      const addr = r[col('Property Address') - 1];
      if (!addr) return;
      const res = deleteVisitEvents_(addr, r[col('Visit Date') - 1]);
      if (String(res).indexOf('removed') === 0) removed++;
    });
  }
  const nonFormula = [];
  for (var i = 0; i < HEADERS.length; i++) if (COMPUTED_HEADERS.indexOf(HEADERS[i]) < 0) nonFormula.push(i + 1);
  nonFormula.forEach(function(c){ sh.getRange(CFG.FIRST_DATA_ROW, c, last - 1, 1).clearContent(); });
  logAuto_('CLEANUP', '', 'clearAllData: rows cleared; calendar events removed for ' + removed + ' record(s).');
  SpreadsheetApp.getActive().toast('Data rows cleared · ' + removed + ' calendar event(s) removed (headers + formulas kept).', 'Twin Visit Logger', 8);
}

/**
 * Delete automation-created calendar events that no longer match any live tracker row.
 *
 * Needed because a row deleted straight from the sheet (select row -> Delete) runs no Apps Script at
 * all, so its event survives. Also cleans up after events that were written to a different calendar
 * before the target was changed. Only touches events whose title begins "Property Visit" — a real
 * meeting on the same calendar is never at risk.
 *
 * Menu: "Remove orphaned calendar events".
 */
function purgeOrphanCalendarEvents() {
  var cal = visitCalendar_();
  if (!cal) {
    SpreadsheetApp.getUi().alert('No calendar resolved. Check VISIT_CALENDAR_NAME / VISIT_CALENDAR_ID.');
    return;
  }
  var keyOf = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };

  // Addresses that still exist in the tracker (any row with an address counts as live).
  var live = {};
  var sh = dataSheet_(), last = sh.getLastRow();
  if (last >= CFG.FIRST_DATA_ROW) {
    sh.getRange(CFG.FIRST_DATA_ROW, col('Property Address'), last - CFG.FIRST_DATA_ROW + 1, 1)
      .getValues().forEach(function (r) { var k = keyOf(r[0]); if (k) live[k] = true; });
  }

  var now = new Date();
  var from = new Date(now.getTime() - 120 * 864e5);
  var to = new Date(now.getTime() + 365 * 864e5);
  var events = cal.getEvents(from, to);
  var removed = [], kept = 0;

  events.forEach(function (e) {
    var title = e.getTitle() || '';
    if (!/^Property Visit\b/i.test(title)) return;         // not ours — leave alone
    var tk = keyOf(title);
    var matches = Object.keys(live).some(function (k) { return k.length > 8 && tk.indexOf(k) >= 0; });
    if (matches) { kept++; return; }
    removed.push(Utilities.formatDate(e.getStartTime(), Session.getScriptTimeZone(), 'yyyy-MM-dd') + ' ' + title.slice(0, 60));
    e.deleteEvent();
  });

  logAuto_('CLEANUP', '', 'purgeOrphanCalendarEvents on "' + cal.getName() + '": removed ' + removed.length +
    ', kept ' + kept + '. ' + removed.join(' | '));
  SpreadsheetApp.getActive().toast(
    'Calendar "' + cal.getName() + '": removed ' + removed.length + ' orphaned event(s), kept ' + kept +
    ' matching a live row.' + (removed.length ? ' Removed: ' + removed.slice(0, 4).join(' · ') : ''),
    'Calendar cleanup', 15);
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
  /*
   * The notes audit belongs in the standard set. It is the only job that reads all ~378 rows rather than
   * the ~100 with a REI link, it needs no browser, and it runs in Google's cloud — so it keeps working when
   * the client's PC is asleep, which is exactly what he asked for: "the should be start like the auto
   * checker in calendar something."
   */
  ScriptApp.newTrigger('auditVisitNotesSilent').timeBased().everyHours(1).create();
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
    /*
   * Next Action and its due date are filled HERE, not typed on the form.
   *
   * The client: "remove next action tab due date tab." Fair — for a visit that is being booked, both were
   * always the same two values, and a form that asks for what it already knows is a form people rush.
   *
   * They cannot simply be left empty. Next Action is one of the fields Missing Required Fields checks, so a
   * blank one flags the row on the dashboard and puts it on the work queue as incomplete — the booking
   * would arrive already looking broken. The due date follows the visit, because that is when the action is
   * actually due.
   */
  if (!params['Next Action']) params['Next Action'] = 'Conduct scheduled visit & log outcome';
  if (!params['Next Action Due Date']) {
    params['Next Action Due Date'] = params['Visit Date'] || fmt_(today_());
  }

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

    /*
     * A SHEET edit must move the calendar too, not only a dashboard edit.
     *
     * The client set a visit to Canceled and nothing happened — no tag on the calendar event, no Chat
     * alert, nothing. The reason: syncVisitCalendar_ was only ever called from webAction, so cancelling
     * from the dashboard worked and cancelling by typing in the sheet did nothing at all. Two ways to
     * record the same fact, two different outcomes, and the sheet is the one people actually use.
     *
     * Visit Date and Visit Time are included even though they have no handler above: moving a visit in
     * the sheet has to move the event, or the calendar quietly keeps the old date.
     *
     * After R.flush(), so the row on the sheet already holds the new value when syncVisitCalendar_
     * re-reads it. typeof-guarded because Automation.gs is loaded without WebApp.gs in some setups.
     */
    if (header === 'Visit Status' || header === 'Current Stage' || header === 'Visit Date' || header === 'Visit Time') {
      if (typeof syncVisitCalendar_ === 'function') syncVisitCalendar_(sh, row);
    }
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
  } else if (v === 'Canceled' || v === 'Reschedule Needed') {
    /*
     * Cancelling records the fact and nothing more.
     *
     * Current Stage is deliberately NOT moved — realignStage_ leaves that for a person, because
     * "the seller cancelled" and "we are done with this lead" are different decisions and only one of
     * them is safe to make automatically. The lead therefore keeps appearing in the work queue, tagged
     * CANCELED, until somebody rebooks it or closes it out. That is the intent, not an oversight.
     *
     * The calendar event and the Chat alert are handled by syncVisitCalendar_, which onEditInstallable
     * now calls for this column. Before that, cancelling in the sheet did nothing at all.
     */
    logAuto_('INFO', R.get('Property ID'),
      'Visit ' + v + ' — calendar event tagged and kept; stage left as "' + (R.get('Current Stage') || '(blank)') +
      '" for a person to close out');
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
    { title: 'SLA / Service Failures',
      rows: f(function(r){ return !!slaFor_(r); }).sort(byOverdue_) },
    { title: 'Scheduling Conflicts',
      rows: conflictRows_(active) },
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
function conflictRows_(active){
  var byKey={}, flagged=[];
  active.forEach(function(r){
    if(r['Visit Status']!=='Scheduled' || !r['Visit Date'] || !r['Assigned Visitor']) return;
    var k=String(r['Assigned Visitor']).toLowerCase()+'|'+fmt_(r['Visit Date']);
    (byKey[k]=byKey[k]||[]).push(r);
  });
  Object.keys(byKey).forEach(function(k){ if(byKey[k].length>1) byKey[k].forEach(function(r){ flagged.push(r); }); });
  return flagged;
}

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

/**
 * Sheets stores a date/time as a serial number, and getValues() only returns a Date object when the
 * cell carries a date format. Rows written by the external automation can arrive unformatted, which
 * is why the detail view showed "46235" and "0.5833333" instead of a date and a time. Convert those
 * serials by column meaning so the UI always shows something readable.
 *   date serial 46235 -> 2026-08-01     time fraction 0.58333 -> 2:00 PM
 */
function cellDisplay_(header, val) {
  if (val == null || val === '') return '';
  var h = String(header);
  var isTime = /\bTime$/i.test(h);
  var isDate = /Date/i.test(h);

  if (val instanceof Date) {
    if (isTime) return Utilities.formatDate(val, Session.getScriptTimeZone(), 'h:mm a');
    return fmt_(val);
  }
  if (typeof val !== 'number' || !isFinite(val)) return val;

  if (isTime && val >= 0 && val < 1) {
    var mins = Math.round(val * 24 * 60);
    var hh = Math.floor(mins / 60) % 24, mm = mins % 60;
    var ap = hh >= 12 ? 'PM' : 'AM';
    var h12 = hh % 12; if (h12 === 0) h12 = 12;
    return h12 + ':' + (mm < 10 ? '0' + mm : mm) + ' ' + ap;
  }
  if (isDate && val > 1000) {
    // Sheets' serial epoch is 1899-12-30. Keep the whole-day part; ignore any time fraction.
    return fmt_(new Date(Date.UTC(1899, 11, 30) + Math.round(val) * 86400000));
  }
  return val;
}

/** Date-only helper for the flat fields: tolerates Date objects and bare serial numbers alike. */
function fmtCell_(header, val) {
  var out = cellDisplay_(header, val);
  return out === 0 ? '' : out;
}

function webGetData() {
  const sh = dataSheet_();
  const last = sh.getLastRow();
  const rows = [];
  if (last >= CFG.FIRST_DATA_ROW) {
    /*
     * Read the WHOLE width and map values by column NAME.
     *
     * This read HEADERS.length columns and zipped them onto HEADERS by position. The live tab has 74
     * columns against the 72 declared, and is shifted by one from 'REI BlackBook Link' onward, so every
     * field from there on took its neighbour's value — visitDate got the REI link, visitStatus got the
     * date — and the last two columns were never read at all. Two real visits sat in the sheet and could
     * not be found on the board.
     *
     * A name lookup is immune to that: an unexpected extra column is ignored, a heading this code does
     * not know about is ignored, and a declared column the sheet does not have yet reads as blank
     * instead of silently borrowing the cell next to it.
     */
    const idx = headerIndex_();
    const width = Math.max(sh.getLastColumn(), HEADERS.length);
    const vals = sh.getRange(CFG.FIRST_DATA_ROW, 1, last - CFG.FIRST_DATA_ROW + 1, width).getValues();
    vals.forEach(function(v, i){
      const rec = {};
      HEADERS.forEach(function(h){ const c = idx[h]; rec[h] = c ? v[c - 1] : ''; });
      if (!rec['Property Address'] || String(rec['Source']).trim() === 'TEST') return; // live records only
      const full = {}; HEADERS.forEach(function(h){ full[h] = cellDisplay_(h, rec[h]); });
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
        visitDate: fmtCell_('Visit Date', rec['Visit Date']),
        /*
         * Sent so the board can show how long a parked row has been waiting, and say something honest
         * once that becomes unreasonable. An ISO string rather than a formatted date: the page does
         * arithmetic with it, and "08/08/2026" cannot be subtracted from anything.
         */
        created: rec['Created Date'] instanceof Date ? rec['Created Date'].toISOString() : '',
        visitTime: fmtCell_('Visit Time', rec['Visit Time']),
        visitor: rec['Assigned Visitor'] || '',
        visitNotes: rec['Visit Notes'] || '',
        nextAction: rec['Next Action'] || '',
        due: fmtCell_('Next Action Due Date', rec['Next Action Due Date']),
        lastContact: fmtCell_('Last Contact Date', rec['Last Contact Date']),
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
        offerPromised: fmtCell_('Offer Promised Date', rec['Offer Promised Date']),
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
  // Sent so the booking form offers exactly what the sheet accepts — an illegal value fails the row write.
  const visitors = DROPDOWNS['Assigned Visitor'];
  var email = ''; try { email = Session.getActiveUser().getEmail() || ''; } catch (e) {}
  return { generatedAt: fmt_(today_()), owners: owners, visitors: visitors,
    bookingOwners: bookingList_(BOOKING_OWNERS, owners),
    bookingVisitors: bookingList_(BOOKING_VISITORS, visitors),
    leadSources: DROPDOWNS['Lead Source'],
    /*
     * Visit Status and Current Stage are sent for the same reason Lead Source is, and were not.
     *
     * The booking form kept its own copies of these two, so the sheet could never correct them — and it had
     * drifted: the workbook accepts five visit statuses and the form offered four. 'Skipped — Offer Made' was
     * simply unreachable from the dashboard, permanently, with nothing to reveal it. That is worse than the
     * MLS gap, which at least came right once the page loaded.
     *
     * Every list the form can write is now sent from DROPDOWNS, which is the same list data validation is
     * built from — so the form offers exactly what the sheet accepts, and an added value reaches both at once.
     */
    visitStatuses: DROPDOWNS['Visit Status'],
    stages: DROPDOWNS['Current Stage'],
    sections: sections, records: rows, trash: trashList_(), userEmail: email, totalLive: rows.length };
}

/* ---------------- server: safe write actions ---------------- */

/**
 * The sheet row a dashboard action refers to. 0 = not found, and the caller must not write.
 *
 * Two things this now refuses to do, both of which it used to do silently:
 *
 *   A BLANK identifier no longer matches anything. Property ID is empty on every imported row, so
 *   String(ids[i][0]) === String('') matched the FIRST blank-ID row — and a Save or Delete aimed at one
 *   record landed on another. A blank id is a bug in the caller, so it returns 0 rather than guessing.
 *
 *   A ROW NUMBER is accepted directly. The dashboard now sends rowNum, which comes from the sheet and
 *   is always unique, instead of a Property ID that may not exist. A plain integer inside the data
 *   range is treated as that row; anything else still falls back to matching Property ID, so an older
 *   deployment of the page keeps working.
 */
function findRowById_(id) {
  const sh = dataSheet_();
  const last = sh.getLastRow();
  if (last < CFG.FIRST_DATA_ROW) return 0;

  const raw = String(id == null ? '' : id).trim();
  if (!raw) return 0;                                    // never guess from a blank identifier

  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n >= CFG.FIRST_DATA_ROW && n <= last) return n;   // it is a row number
  }

  const ids = sh.getRange(CFG.FIRST_DATA_ROW, col('Property ID'), last - CFG.FIRST_DATA_ROW + 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    const v = String(ids[i][0]).trim();
    if (v && v === raw) return CFG.FIRST_DATA_ROW + i;     // a blank cell can never be the match
  }
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
/*
 * Who the BOOKING FORM offers — a curated shortlist, not the workbook's whole validation list.
 *
 * The client, on the Book / reschedule form: "for visitior should only juan an cesar only; for assigneg
 * owener should thea, cherry, genesis."
 *
 * Two different lists on purpose. DROPDOWNS above is what the SHEET accepts, and it has to stay long —
 * dozens of existing rows hold Kyle, Matt, Arly and the rest, and a value outside the validation fails the
 * whole row write. These are what a person is offered when booking today, so the common case is two taps
 * instead of scrolling past people who left.
 *
 * Filtered against DROPDOWNS before being sent, so a name added here and forgotten there cannot reach the
 * form and produce a row write that throws.
 */
var BOOKING_OWNERS = ['Thea', 'Cherry', 'Genesis'];
var BOOKING_VISITORS = ['Juan', 'Cesar'];

function bookingList_(wanted, allowed) {
  return wanted.filter(function (name) { return allowed.indexOf(name) >= 0; });
}

/*
 * How a row that still needs its details from REI is marked.
 *
 * Read by scripts/fill-pending-rei.mjs on the PC, which is the half of this that CAN open REI. Change it
 * in both places or rows will sit here forever looking like finished records with an odd address.
 */
var PENDING_REI_PREFIX = 'PENDING REI LOOKUP —';

/** Last ten digits, so (650) 620-4017 and 6506204017 are the same number. */
function phoneKey_(value) {
  var digits = String(value == null ? '' : value).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

/**
 * Find the row this booking already belongs to, if any.
 *
 * Returns { row, reason, ambiguous }. `ambiguous` means the phone matched more than one record — a
 * seller with two properties has one number and two rows — and in that case NOTHING is edited. Guessing
 * which property to reschedule silently moves the wrong visit; a duplicate card somebody merges by hand
 * is the recoverable mistake of the two.
 *
 * Order matters: a REI link is an identity, a phone is a strong hint, an address is a last resort.
 */
function findRowForBooking_(params) {
  var sh = dataSheet_();
  var last = sh.getLastRow();
  if (last < CFG.FIRST_DATA_ROW) return { row: 0, reason: 'the tab is empty' };
  var n = last - CFG.FIRST_DATA_ROW + 1;

  var link = String(params['REI BlackBook Link'] || '').trim();
  if (link) {
    var links = sh.getRange(CFG.FIRST_DATA_ROW, col('REI BlackBook Link'), n, 1).getValues();
    for (var i = 0; i < links.length; i++) {
      if (String(links[i][0]).trim() === link) {
        return { row: CFG.FIRST_DATA_ROW + i, reason: 'same REI link' };
      }
    }
  }

  var wanted = phoneKey_(params['Phone']);
  if (wanted) {
    var phones = sh.getRange(CFG.FIRST_DATA_ROW, col('Phone'), n, 1).getValues();
    var stages = sh.getRange(CFG.FIRST_DATA_ROW, col('Current Stage'), n, 1).getValues();
    var hits = [];
    for (var p = 0; p < phones.length; p++) {
      if (phoneKey_(phones[p][0]) !== wanted) continue;
      /*
       * A closed-out lead does not count as "already there". The same seller coming back months later
       * is a NEW opportunity, and reviving the dead row would bury why it was closed.
       */
      if (String(stages[p][0]).trim() === 'Lost / Closed Out') continue;
      hits.push(CFG.FIRST_DATA_ROW + p);
    }
    if (hits.length === 1) return { row: hits[0], reason: 'same phone number' };
    if (hits.length > 1) {
      return { row: 0, ambiguous: true,
        reason: hits.length + ' records share that phone — rows ' + hits.join(', ') };
    }
  }

  var addr = String(params['Property Address'] || '').trim().toLowerCase();
  if (addr) {
    var addrs = sh.getRange(CFG.FIRST_DATA_ROW, col('Property Address'), n, 1).getValues();
    for (var a = 0; a < addrs.length; a++) {
      if (String(addrs[a][0]).trim().toLowerCase() === addr) {
        return { row: CFG.FIRST_DATA_ROW + a, reason: 'same address' };
      }
    }
  }
  return { row: 0, reason: 'no existing record' };
}

/*
 * Stages at or before a visit. Rescheduling may set Current Stage back to "Visit Scheduled" only from
 * one of these — a lead at Offer Sent that gets another visit booked stays at Offer Sent, because the
 * offer is further on than the visit and the board must not claim otherwise.
 */
var STAGES_BEFORE_OFFER = ['', 'Visit Scheduled', 'Visit Completed — Needs Review'];

/**
 * Reschedule an existing record rather than creating a second card for the same lead.
 *
 * The client, on being shown that Add always appended: "no, just edit that tab instead, edit property,
 * since that is already [there]." Right — and creating duplicates would have broken the rule this
 * project holds everywhere else, while double-counting the lead in every number at the top of the board.
 */
function webRescheduleRow_(row, params) {
  var sh = dataSheet_();
  var R = new RowAccessor_(sh, row);
  var changed = [];

  ['Visit Date', 'Visit Time', 'Visit Status', 'Assigned Visitor', 'Assigned Owner',
    'Lead Source', 'Next Action', 'Next Action Due Date', 'REI BlackBook Link', 'Phone'
  ].forEach(function (h) {
    if (params[h] === undefined || params[h] === '') return;
    var value = h.indexOf('Date') >= 0 ? new Date(params[h]) : params[h];
    var before = R.get(h);
    R.set(h, value);
    if (String(before) !== String(value)) changed.push(h);
  });

  var stage = String(R.get('Current Stage') || '').trim();
  if (STAGES_BEFORE_OFFER.indexOf(stage) >= 0 && String(params['Visit Status'] || '') === 'Scheduled') {
    if (stage !== 'Visit Scheduled') { R.set('Current Stage', 'Visit Scheduled'); changed.push('Current Stage'); }
  }

  stamp_(R);
  R.flush();
  if (params['Visit Status']) onVisitStatus_(new RowAccessor_(sh, row));
  SpreadsheetApp.flush();
  return { ok: true, updated: true, row: row, changed: changed,
    id: R.get('Property ID'), seller: R.get('Seller Name'), data: webGetData() };
}

function webAddRecord_(params) {
  /*
   * One booking at a time, across the whole script.
   *
   * findRowForBooking_ below is a READ, and the write that follows it is a separate call. Two people — or
   * one person whose second click lands before the first has finished — run both halves interleaved: each
   * looks, each finds nothing, each writes. The board then shows the client's own screenshot: two
   * identical Bryan Dodge cards, same number, same date, six seconds apart. The de-duplication was there
   * and correct; it was simply asking a question whose answer went stale before it was used.
   *
   * A script lock is the whole fix. Thirty seconds is generous for a look-then-write on one row and short
   * enough that a colleague who really is waiting behind somebody gets an answer rather than a hang; if it
   * cannot be had, the booking is refused with something a person can act on, because a refusal they can
   * retry beats a duplicate they have to find and merge.
   */
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { ok: false, error: 'Somebody else is saving a booking right now. Try again in a few seconds — '
      + 'nothing was saved, so nothing is duplicated.' };
  }
  try {
    return webAddRecordLocked_(params);
  } finally {
    lock.releaseLock();
  }
}

function webAddRecordLocked_(params) {
  /*
   * Look before writing. An existing lead is RESCHEDULED, never duplicated.
   *
   * Without this, a colleague rebooking Sara produced a second Sara: two cards on the board, and every
   * count at the top of the page — SLA breach, Overdue, Need decision — quietly wrong by one.
   */
  const found = findRowForBooking_(params);
  if (found.row) return webRescheduleRow_(found.row, params);

  const sh = dataSheet_();
  ensureRows_(sh, CFG.MAX_ROWS);
  var row = 0;
  const addrs = sh.getRange(CFG.FIRST_DATA_ROW, col('Property Address'), CFG.MAX_ROWS - 1, 1).getValues();
  for (var i = 0; i < addrs.length; i++) { if (String(addrs[i][0]).trim() === '') { row = CFG.FIRST_DATA_ROW + i; break; } }
  if (!row) return { ok: false, error: 'No empty rows available (increase MAX_ROWS).' };
  /*
   * An address, OR something the PC can look the address up WITH.
   *
   * The client's ask: "instead of waiting in the email... just add the number and then the name of the
   * seller and date and it will do automatic." A colleague booking a visit has the phone in front of
   * them; the address is the thing they would have to go into REI to fetch, which is the errand this is
   * meant to remove.
   *
   * Apps Script cannot read REI — no browser — so the row is parked with a placeholder and the PC fills
   * it in on its next pass. The placeholder is NOT cosmetic: this function finds the next free row by
   * looking for a blank Property Address, so a genuinely blank one would be handed out again to the next
   * person who clicked Add, and their record would overwrite this one.
   */
  if (!params['Property Address']) {
    var lookupKey = String(params['Phone'] || params['REI BlackBook Link'] || '').trim();
    if (!lookupKey) {
      return { ok: false, error: 'A phone number is needed — it is what REI is searched by.' };
    }
    params['Property Address'] = PENDING_REI_PREFIX + ' ' + lookupKey;
    // Flagged, so it is visibly unfinished on the board rather than looking like a complete record.
    if (params['Data Quality Status'] === undefined) params['Data Quality Status'] = 'Incomplete';
    if (params['Exception Reason'] === undefined) {
      /*
       * The timestamp goes in the TEXT, deliberately.
       *
       * Created Date and Last Updated Date are both written by today_(), which is midnight — a date with
       * no clock on it. The board's "waiting for…" counter read one of those and showed 1009m 16s, which
       * is minutes since midnight, not since the row was made. Rather than change what those two columns
       * mean (formulas, the daily report and the legacy import all depend on them being dates), the
       * moment is carried here as an ISO instant the page can subtract.
       */
      params['Exception Reason'] = (found.ambiguous
        ? ('POSSIBLE DUPLICATE — ' + found.reason + '. Added as a new record rather than guessing which '
           + 'one to reschedule; merge them by hand if this is the same property.')
        : 'Waiting for the PC to read REI and fill in the address and details.')
        + ' [since ' + new Date().toISOString() + ']';
    }
  }
  const R = new RowAccessor_(sh, row);
  const map = ['Property Address','Seller Name','Phone','Email','Lead Source','Visit Date','Visit Time',
    'Visit Status','Assigned Visitor','Visit Notes','Seller Motivation','Current Stage','Assigned Owner',
    'Next Action','Next Action Due Date','REI BlackBook Link','Data Quality Status','Exception Reason'];
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
  return { ok: true, created: true, ambiguous: Boolean(found.ambiguous), pending: true,
    data: webGetData(), newId: R.get('Property ID') };
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
        runHandler_(onVisitStatus_, sh, rowNum); break;
      case 'logContact':
        R.set('Last Contact Date', today_());
        if (params.result) R.set('Last Contact Result', params.result);
        if (params.nextAction) R.set('Next Action', params.nextAction);
        if (params.due) R.set('Next Action Due Date', new Date(params.due));
        stamp_(R); R.flush(); break;
      case 'recordOfferSent':
        if (params.amount) R.set('Approved Offer Amount', Number(params.amount));
        R.set('Offer Sent Date', params.date ? new Date(params.date) : today_());
        stamp_(R); R.flush(); runHandler_(onOfferSent_, sh, rowNum); break;
      case 'sellerCounter':
        if (params.amount) R.set('Counteroffer Amount', Number(params.amount));
        if (params.result) R.set('Last Contact Result', params.result);
        stamp_(R); R.flush(); runHandler_(onSellerCounter_, sh, rowNum); break;
      case 'contractSent':
        R.set('Contract Sent Date', params.date ? new Date(params.date) : today_());
        stamp_(R); R.flush(); runHandler_(onContractSent_, sh, rowNum); break;
      case 'contractSigned':
        R.set('Contract Signed Date', params.date ? new Date(params.date) : today_());
        stamp_(R); R.flush(); runHandler_(onContractSigned_, sh, rowNum); break;
      case 'nurture':
        R.set('Current Stage', 'Long-Term Nurture');
        if (params.due) R.set('Next Action Due Date', new Date(params.due));
        if (params.nextAction) R.set('Next Action', params.nextAction);
        stamp_(R); R.flush(); runHandler_(onStageManual_, sh, rowNum); break;
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
        stamp_(R); R.flush();
        /*
         * Run the SAME automation a sheet edit would.
         *
         * This only wrote the cells and synced the calendar, so editing Visit Status through the
         * full-record form gave a different result from typing it in the sheet or from pressing the
         * "Mark visit completed" button — the stage cascade and the log line were skipped. One field,
         * three doors, three outcomes. runHandler_ syncs the calendar itself, so it is not called twice.
         */
        if (params['Visit Status'] !== undefined) runHandler_(onVisitStatus_, sh, rowNum);
        else if (params['Current Stage'] !== undefined) runHandler_(onStageManual_, sh, rowNum);
        else syncVisitCalendar_(sh, rowNum);
        break;
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

/**
 * Run an automation handler for one row and PERSIST its changes.
 *
 * The handlers were written for onEdit, where onEditInstallable flushes at the end. Called directly
 * from webAction they were never flushed, so a quick-action saved its own field but silently lost the
 * cascade — "Mark visit completed" set Visit Status but not Current Stage, leaving the card stuck in
 * Upcoming Visits. Always flush here, then keep the calendar in step with the new state.
 */
function runHandler_(handler, sh, rowNum) {
  var R = new RowAccessor_(sh, rowNum);
  handler(R);
  R.flush();
  syncVisitCalendar_(sh, rowNum);
  return R;
}

/**
 * Make the calendar match the row's current state.
 *   Canceled / closed / no visit date -> remove the event
 *   Scheduled with a visit date       -> ensure the event exists on that date
 * Called after every dashboard write so rescheduling or cancelling in the dashboard is reflected on
 * the calendar without anyone editing it by hand.
 */
function syncVisitCalendar_(sh, rowNum) {
  try {
    var R = new RowAccessor_(sh, rowNum);
    var addr = R.get('Property Address');
    if (!addr) return '';
    var status = String(R.get('Visit Status') || '');
    var stage = String(R.get('Current Stage') || '');
    var visitDate = R.get('Visit Date');
    /*
     * A CANCELLED visit KEEPS its calendar event, tagged.
     *
     * This used to delete it. Cherry's rule: "if the status of the calendar is cancelled it should not
     * be removed in the calendar and this will notify as well". She is right — a visit vanishing off
     * Juan's day is indistinguishable from it never having been booked, so nobody learns that a seller
     * cancelled, and there is no record that the slot was ever held. The event stays, its title carries
     * the tag, its reminders are stripped so it cannot ping anyone, and the reason is written into the
     * description. A Chat alert goes out the first time it is tagged.
     *
     * "Reschedule Needed" gets its own tag rather than sharing the cancelled one: the slot is dead but
     * the lead is not, and those are different things to see on a calendar.
     *
     * The no-visit-date case still removes the event, because there is no date left for it to sit on.
     */
    var tag = status === 'Canceled' ? 'CANCELED'
      : status === 'Reschedule Needed' ? 'RESCHEDULE NEEDED'
        : stage === 'Lost / Closed Out' ? 'CLOSED OUT' : '';

    if (tag) {
      var marked = markVisitEvents_(addr, visitDate, tag, String(R.get('Updated By') || ''));
      logAuto_('CALENDAR', R.get('Property ID'), 'Visit event tagged ' + tag + ' (kept on the calendar) · ' + marked.detail);

      /*
       * Alert on the CANCELLATION, not on the tagging.
       *
       * This fired only when an event had just been tagged — so a lead with no calendar event produced
       * no alert and no visible sign of anything at all. That is most cancelled leads: the old
       * behaviour DELETED the event on cancel, and maybeCreateVisitEvent_ refuses to create one for a
       * past date, so a visit cancelled after its date has no event to tag. The client cancelled a
       * visit, nothing happened anywhere, and there was no way to tell why.
       *
       * A seller cancelling is news whether or not a calendar entry survived, so the alert now depends
       * on the row, and the once-only marker moved from the event title to a note on the row itself.
       * The tag is stored, not just a flag, so Canceled after Reschedule Needed alerts again — those
       * are different pieces of news.
       */
      if (R.getNote('cancelAlert') !== tag) {
        notifyVisitTagged_(R, tag, visitDate, marked);
        R.setNote('cancelAlert', tag);
      }
      return marked.detail;
    }

    // Re-booked: forget the alert marker, so if it is cancelled again that is fresh news.
    if (R.getNote('cancelAlert')) R.setNote('cancelAlert', '');

    if (!visitDate) {
      var removed = deleteVisitEvents_(addr, visitDate);
      logAuto_('CALENDAR', R.get('Property ID'), 'Visit event removed (no visit date) · ' + removed);
      return removed;
    }
    // Re-point the event at the current date: drop any stale copy, then create it fresh.
    deleteVisitEvents_(addr, null);
    var res = maybeCreateVisitEvent_({
      'Property Address': addr, 'Seller Name': R.get('Seller Name'), 'Phone': R.get('Phone'),
      'REI BlackBook Link': R.get('REI BlackBook Link'), 'Lead Source': R.get('Lead Source'),
      'Visit Date': visitDate
    }, addr);
    logAuto_('CALENDAR', R.get('Property ID'), 'Visit event synced to ' + fmt_(new Date(visitDate)) + ' · ' + res);
    return res;
  } catch (e) {
    logAuto_('ERROR', 'syncVisitCalendar', String(e));
    return 'error: ' + e;
  }
}

/**
 * Realign Current Stage with the row's own evidence.
 *
 * Half-applied dashboard actions (and earlier automation) left rows whose Current Stage contradicts
 * their other fields - e.g. Visit Status=Completed but stage still "Visit Scheduled", so the card sat
 * in Upcoming Visits with no button able to move it. Derive the stage from the strongest signal
 * present and rewrite only the rows that disagree. Menu: "Fix mismatched stages".
 */
function repairStages() {
  var sh = dataSheet_();
  var last = sh.getLastRow();
  if (last < CFG.FIRST_DATA_ROW) return;
  var fixed = [];
  for (var r = CFG.FIRST_DATA_ROW; r <= last; r++) {
    var R = new RowAccessor_(sh, r);
    if (!R.get('Property Address')) continue;
    var stage = String(R.get('Current Stage') || '');
    // Terminal stages are the operator's decision - never second-guess them.
    if (stage === 'Lost / Closed Out' || stage === 'Long-Term Nurture' || stage === 'Contract Signed') continue;

    var want = '';
    if (R.get('Contract Signed Date')) want = 'Contract Signed';
    else if (R.get('Contract Sent Date')) want = 'Contract Sent';
    else if (R.get('Counteroffer Amount')) want = 'Active Negotiation';
    else if (R.get('Offer Sent Date')) want = 'Offer Sent';
    else if (R.get('Approved Offer Amount')) want = 'Offer Preparation';
    else if (String(R.get('Visit Status')) === 'Completed') want = 'Visit Completed — Needs Review';
    else if (String(R.get('Visit Status')) === 'Canceled') want = '';   // leave for a human to close out
    else if (String(R.get('Visit Status')) === 'Scheduled') want = 'Visit Scheduled';

    if (want && want !== stage) {
      R.set('Current Stage', want);
      if (want === 'Visit Completed — Needs Review') {
        R.setIfBlank('Assigned Owner', 'Jonathan');
        R.setIfBlank('Next Action', 'Review completed visit: make offer or pass');
        R.setIfBlank('Next Action Due Date', today_());
      }
      R.flush();
      syncVisitCalendar_(sh, r);
      fixed.push(R.get('Property ID') + ': "' + stage + '" -> "' + want + '"');
    }
  }
  SpreadsheetApp.flush();
  logAuto_('REPAIR', '', 'repairStages fixed ' + fixed.length + ' row(s). ' + fixed.join(' | '));
  SpreadsheetApp.getActive().toast(
    fixed.length ? ('Fixed ' + fixed.length + ' mismatched stage(s): ' + fixed.join(' · ')) : 'No mismatched stages found.',
    'repairStages', 15);
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
function visitCalendar_() {
  // Prefer the named calendar. getCalendarsByName covers calendars shared WITH this account, so
  // "Juan's Official Calendar" resolves without anyone copying an ID out of Calendar settings.
  var name = CFG.VISIT_CALENDAR_NAME;
  if (name) {
    var byName = CalendarApp.getCalendarsByName(name) || [];
    if (byName.length) return byName[0];
    logAuto_('ERROR', 'calendar', 'No calendar named "' + name + '" is visible to this account. ' +
      'Confirm it is shared with edit rights, or clear VISIT_CALENDAR_NAME to use VISIT_CALENDAR_ID.');
    return null;
  }
  var id = CFG.VISIT_CALENDAR_ID;
  if (!id) return null;
  return (id === 'default' || id === 'me') ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(id);
}
function maybeCreateVisitEvent_(map, addr) {
  if (!CFG.VISIT_CALENDAR_ID && !CFG.VISIT_CALENDAR_NAME) return 'skipped (no calendar configured)';
  try {
    const cal = visitCalendar_();
    if (!cal) return 'calendar not found / not shared';
    if (!map['Visit Date']) return 'no visit date — event skipped';
    const start = new Date(map['Visit Date']); start.setHours(9, 0, 0, 0);

    // History never reaches the calendar. The 379 imported legacy records carry visit dates going
    // back to 2023; putting those on Juan's calendar would bury the visits that have not happened
    // yet. This is the single choke point every caller goes through, so the rule holds for the
    // import, the dashboard actions, "Fix mismatched stages", and the REI intake alike.
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    if (start < midnight) return 'visit date is in the past — event skipped (history stays off the calendar)';

    const end = new Date(start.getTime() + 60 * 60000);
    const title = 'Property Visit - ' + addr;
    if (cal.getEventsForDay(start).some(function(e){ return e.getTitle() === title; })) return 'event already on calendar (no duplicate)';
    const desc = 'Seller: ' + (map['Seller Name'] || '') + '\nPhone: ' + (map['Phone'] || '') +
                 '\nREI: ' + (map['REI BlackBook Link'] || '') + '\nLead source: ' + (map['Lead Source'] || '');
    const ev = cal.createEvent(title, start, end, { description: desc, location: addr });
    const mins = driveMinutes_(addr);
    ev.removeAllReminders();
    if (mins) ev.addPopupReminder(mins);
    ev.addPopupReminder(30);
    return 'event created (' + (mins ? mins + 'm drive reminder' : '30m only') + ')';
  } catch (e) { return 'error: ' + e; }
}

/**
 * Delete the "Property Visit - <addr>" event(s) from the calendar (used when a record is
 * deleted in the dashboard). Searches a window around the visit date (±2 days to absorb any
 * timezone offset); falls back to a broad search if no visit date. Only removes exact-title matches.
 */
function deleteVisitEvents_(addr, visitDate) {
  if ((!CFG.VISIT_CALENDAR_ID && !CFG.VISIT_CALENDAR_NAME) || !addr) return 'no calendar / address';
  try {
    var cal = visitCalendar_();
    if (!cal) return 'calendar not found';
    var evs = findVisitEvents_(cal, addr, visitDate);
    evs.forEach(function (e) { e.deleteEvent(); });
    return evs.length ? ('removed ' + evs.length + ' event(s)') : 'no matching event';
  } catch (e) { return 'error: ' + e; }
}

/**
 * Tag the visit's calendar event instead of deleting it, and keep it on the calendar.
 *
 * Returns { count, newlyTagged, detail }. newlyTagged is false when the tag was already on the title,
 * which is what stops the same cancellation being announced again on every later dashboard write.
 *
 * What it does to the event:
 *   - prefixes the title with "[TAG] " so it reads as cancelled at a glance in the calendar grid
 *   - removes every reminder, so a cancelled visit cannot ping anyone to leave the office
 *   - appends one dated line to the description, so the record of WHEN it was cancelled survives
 * It never moves the event and never changes its date: the slot that was held stays visible.
 */
function markVisitEvents_(addr, visitDate, tag, by) {
  if ((!CFG.VISIT_CALENDAR_ID && !CFG.VISIT_CALENDAR_NAME) || !addr) return { count: 0, newlyTagged: false, detail: 'no calendar / address' };
  try {
    var cal = visitCalendar_();
    if (!cal) return { count: 0, newlyTagged: false, detail: 'calendar not found' };
    var evs = findVisitEvents_(cal, addr, visitDate);
    if (!evs.length) return { count: 0, newlyTagged: false, detail: 'no matching event' };

    var prefix = '[' + tag + '] ';
    var count = 0, fresh = 0;
    evs.forEach(function (e) {
      var t = e.getTitle() || '';
      count++;
      if (t.indexOf(prefix) === 0) return;                 // already tagged — leave it entirely alone
      // Strip any OTHER tag first, so a reschedule that later cancels does not read "[CANCELED] [RESCHEDULE NEEDED] …"
      e.setTitle(prefix + t.replace(/^\[[A-Z ]+\]\s*/, ''));
      e.removeAllReminders();
      var stamp = tag + ' on ' + fmt_(today_()) + (by ? ' by ' + by : '') + ' — kept for the record.';
      var desc = e.getDescription() || '';
      if (desc.indexOf(stamp) < 0) e.setDescription((desc ? desc + '\n\n' : '') + stamp);
      fresh++;
    });
    return {
      count: count,
      newlyTagged: fresh > 0,
      detail: fresh ? ('tagged ' + fresh + ' event(s)') : ('already tagged (' + count + ')')
    };
  } catch (e) { return { count: 0, newlyTagged: false, detail: 'error: ' + e }; }
}

/**
 * Every calendar event that belongs to this property visit.
 *
 * Shared by the delete and the tag paths so they can never disagree about which events are ours — a
 * mismatch would leave a cancelled event untagged, or delete something that was not a visit.
 *
 * Matches BOTH producers and any tag already applied:
 *   "Property Visit - <addr>"                (this script)
 *   "Property Visit | <seller> | <addr>"     (the local scraper)
 *   "[CANCELED] Property Visit …"            (already tagged by markVisitEvents_)
 */
function findVisitEvents_(cal, addr, visitDate) {
  var from, to;
  if (visitDate) {
    var d = new Date(visitDate);
    from = new Date(d.getTime() - 2 * 864e5);
    to = new Date(d.getTime() + 3 * 864e5);
  } else {
    var n = new Date();
    from = new Date(n.getTime() - 120 * 864e5);
    to = new Date(n.getTime() + 365 * 864e5);
  }
  // NB: a FULL-length key, not intakeNorm_ (which truncates to 24 chars and would drop the address
  // out of a "Property Visit | Seller | Address" title).
  var keyOf = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
  var addrKey = keyOf(addr);
  return (cal.getEvents(from, to, { search: addr }) || []).filter(function (e) {
    var t = String(e.getTitle() || '').replace(/^\[[A-Z ]+\]\s*/, '');
    return /^Property Visit\b/i.test(t) && addrKey && keyOf(t).indexOf(addrKey) >= 0;
  });
}

/**
 * Tell the team a booked visit is off. One card, at the moment it happens.
 *
 * Cherry asked for this alongside keeping the event: "this will notif as well". The 3pm work queue is
 * the wrong place for it — a cancellation is news, not a task sitting in a queue, and by 3pm Juan may
 * already have driven there. Silent when no webhook is configured.
 */
function notifyVisitTagged_(R, tag, visitDate, marked) {
  try {
    if (typeof chatWebhookUrl_ !== 'function' || !chatWebhookUrl_()) return;
    var when = visitDate ? fmt_(new Date(visitDate)) : 'date not recorded';
    /*
     * timeCell_, not String().
     *
     * The client, on a live card: "there i a bug with this". It read
     *
     *   Was booked for 2026-08-15 at Sat Dec 30 1899 12:00:00 GMT-0800 (Pacific Standard Time)
     *
     * A time-only cell comes back from Sheets as a Date on 30 December 1899 — the epoch it counts times
     * from — so String() on it prints the epoch instead of the clock. Every other card in the project
     * already went through timeCell_, which handles the Date, the raw 0.5-of-a-day serial and typed text
     * alike; this one line was reading the cell raw. It is the moment a visit is called off, so the one
     * fact the reader needs is WHEN it was, and that was the part rendered as gibberish.
     */
    var time = (typeof timeCell_ === 'function'
      ? timeCell_(R.get('Visit Time'))
      : String(R.get('Visit Time') || '')).trim();
    var owner = String(R.get('Assigned Owner') || '').trim() || 'UNASSIGNED';
    var lines = [
      '<b>' + (R.get('Seller Name') || '(no name)') + '</b> · ' + R.get('Property Address'),
      'Was booked for ' + when + (time ? ' at ' + time : '') + ' · Owner: ' + owner,
      // Say honestly what happened to the calendar. "No event was found" is useful information — it
      // usually means the visit date had already passed, or an older version of this code deleted it.
      (marked && marked.count)
        ? '<i>The calendar event is still there, tagged [' + tag + '], with its reminders switched off.</i>'
        : '<i>No calendar event was found for this visit, so there was nothing to tag.</i>'
    ];
    var widgets = [{ textParagraph: { text: lines.join('<br>') } }];
    var url = (typeof dashboardUrl_ === 'function') ? dashboardUrl_() : '';
    if (url) widgets.push({ buttonList: { buttons: [{ text: 'Open dashboard', onClick: { openLink: { url: url } } }] } });
    chatPost_({ cardsV2: [{ cardId: 'visit-tagged', card: {
      header: { title: 'Visit ' + tag.toLowerCase(), subtitle: fmt_(today_()) },
      sections: [{ widgets: widgets }]
    } }] });
    logAuto_('CHAT', R.get('Property ID'), 'Visit ' + tag + ' alert posted.');
  } catch (e) { logAuto_('ERROR', 'notifyVisitTagged', String(e)); }
}

/**
 * Parse an REI BlackBook task body ("Booked appointment on Jul 24" style) for the fields that
 * live in free text: seller name, property address, and the real appointment date/time.
 * Used as a fallback so intake works even when REI only sends the task text (not clean fields).
 */
function parseReiTaskBody_(text) {
  var t = String(text || '').replace(/<[^>]+>/g, '\n');   // strip HTML tags -> newlines
  var out = {}, m;
  m = t.match(/Lead:\s*([^\n<]+)/i);              if (m) out.seller  = m[1].trim();
  m = t.match(/Property address:\s*([^\n<]+)/i);  if (m) out.address = m[1].trim();
  m = t.match(/(?:visit scheduled|booked appointment)[^:\n]*:\s*([^\n<]+)/i);   // "...: Friday, Jul 24, 11:00 AM"
  if (m) {
    var s = m[1].trim().replace(/^[A-Za-z]+day,\s*/, '');           // drop leading weekday
    var tm = s.match(/(\d{1,2}:\d{2}\s*[AP]M)/i); if (tm) out.visitTime = tm[1].toUpperCase().replace(/\s+/g, ' ');
    var dm = s.match(/([A-Za-z]{3,9}\.?\s+\d{1,2})(?:,?\s*(\d{4}))?/);   // "Jul 24" or "July 24, 2026"
    if (dm) { var yr = dm[2] || String(new Date().getFullYear()); out.visitDate = dm[1] + ', ' + yr + (out.visitTime ? ' ' + out.visitTime : ''); }
  }
  out.summary = t.replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
  return out;
}

function webIntake_(lead) {
  lead = lead || {};
  const g = function(a, b){ return lead[a] != null && lead[a] !== '' ? lead[a] : (lead[b] != null ? lead[b] : ''); };
  // REI tasks carry the appointment time + address inside the task body — parse it as a fallback for missing fields.
  var _body = g('Task Body', 'body') || g('Description', 'description') || lead.taskBody || '';
  var _p = _body ? parseReiTaskBody_(_body) : {};
  if (_p.seller    && !g('Seller Name', 'seller'))   lead['Seller Name'] = _p.seller;
  if (_p.visitDate && !g('Visit Date', 'visitDate')) lead['Visit Date']  = _p.visitDate;
  if (_p.visitTime && !g('Visit Time', 'visitTime')) lead['Visit Time']  = _p.visitTime;
  if (_body && !g('Last Contact Result', 'note') && !g('Notes', 'notes')) lead['Notes'] = _p.summary || _body;
  const addr = g('Property Address', 'address') || _p.address || '';
  const phone = g('Phone', 'phone');
  if (!addr) return { ok: false, error: 'Property Address is required (not in fields or task body)' };
  if (!lead['Property Address'] && !lead.address) lead['Property Address'] = addr;   // so downstream g() sees it
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
    U.flush();
    var calMap = { 'Property Address': addr, 'Seller Name': U.get('Seller Name'), 'Phone': U.get('Phone'),
                   'REI BlackBook Link': U.get('REI BlackBook Link'), 'Lead Source': U.get('Lead Source'), 'Visit Date': U.get('Visit Date') };
    var calU = maybeCreateVisitEvent_(calMap, addr);
    SpreadsheetApp.flush();
    logAuto_('INTAKE', dup.id, 'Lead updated from REI webhook · ' + addr +
      (updated.length ? ' · fields: ' + updated.join(', ') : ' · no field changes') + ' · calendar: ' + calU);
    return { ok: true, updated: true, id: dup.id, fields: updated, calendar: calU };
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
  logAuto_('INTAKE', R.get('Property ID'), 'New lead created from REI webhook · ' + addr +
    ' · visitor: ' + (map['Assigned Visitor'] || '(none)') + ' · visit: ' + (map['Visit Date'] ? fmt_(new Date(map['Visit Date'])) : '(none)') +
    ' · source: ' + (CFG.SANDBOX ? 'Intake-Sandbox' : 'Intake') + ' · calendar: ' + cal);
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
    ' · CHECK YOUR CALENDAR today for "Property Visit - 123 Sandbox Test Ave" (delete it after).', 'testIntake', 15);
}

/**
 * Same as testIntake but KEEPS the sandbox row so you can watch it appear in the LIVE dashboard.
 * Run it, open the live web-app dashboard, and you'll see the "123 Sandbox Test Ave" card.
 * Delete it from the dashboard (goes to Trash) when you're done — that also tests soft-delete.
 */
function testIntakeKeep() {
  const sample = {
    'Property Address': '123 Sandbox Test Ave, Testville, CA 90000',
    'Seller Name': 'Intake Test (delete me)', 'Phone': '(000) 000-1234', 'Lead Source': 'PPC',
    'Visit Date': Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
  };
  var res = webIntake_(sample);   // upserts if it already exists; row is NOT removed
  Logger.log('INTAKE (kept) RESULT: ' + JSON.stringify(res));
  SpreadsheetApp.getActive().toast(
    'Intake test (KEPT): ' + (res.ok ? 'PASS' : 'FAIL ' + res.error) + ' · ' + (res.id || '-') +
    ' · calendar: ' + (res.calendar || '-') +
    ' · Open the LIVE dashboard — you\'ll see "123 Sandbox Test Ave". Delete it there when done.', 'testIntakeKeep', 15);
}

/**
 * Simulate a REAL REI BlackBook task (the "Booked appointment" format), where the address +
 * appointment time live inside the task body. Proves the body parser. Keeps the row so you can
 * see it in the dashboard — delete it there when done. Sandbox only; nothing sent to anyone.
 */
function testReiTaskIntake() {
  var lead = {
    'Seller Name': 'Cyn Ku', 'Phone': '(510) 000-0000', 'Assigned Owner': 'Jonathan',
    'Lead Source': 'PPL - Property Leads',
    'Task Body': '<p>Lead: Cyn Ku</p>' +
      '<p>Booked appointment / visit scheduled: Friday, Jul 24, 11:00 AM</p>' +
      '<p>Property address: 2607 Gimelli Place #115, San Jose (Berryessa)</p>' +
      '<ul><li>Create a WhatsApp group</li><li>Add to calendar</li><li>Prepare document - contract</li></ul>'
  };
  var res = webIntake_(lead);
  Logger.log('REI TASK INTAKE: ' + JSON.stringify(res));
  SpreadsheetApp.getActive().toast(
    'REI task intake: ' + (res.ok ? 'PASS' : 'FAIL ' + res.error) + ' · ' + (res.id || '-') +
    ' · calendar: ' + (res.calendar || '-') +
    ' · Parsed address "2607 Gimelli Place #115" + visit Jul 24 from the task body. See it in the dashboard; delete when done.',
    'testReiTaskIntake', 15);
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
  deleteVisitEvents_(vals[col('Property Address') - 1], vals[col('Visit Date') - 1]);   // also remove its calendar event
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
  var addr = row[col('Property Address') - 1];
  if (addr && row[col('Visit Date') - 1]) {   // put the calendar event back
    maybeCreateVisitEvent_({ 'Property Address': addr, 'Seller Name': row[col('Seller Name') - 1],
      'Phone': row[col('Phone') - 1], 'REI BlackBook Link': row[col('REI BlackBook Link') - 1],
      'Lead Source': row[col('Lead Source') - 1], 'Visit Date': row[col('Visit Date') - 1] }, addr);
  }
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

/* ========================= IntakeInbox.gs ========================= */

/**
 * Intake Inbox — Zapier bridge for Workspaces that block public web apps.
 * Zapier's "Google Sheets → Create Spreadsheet Row" writes each REI appointment into the
 * "Intake Inbox" tab (authenticated as you — no public URL). A time trigger (every 10 min) or the
 * manual runner processes new rows through webIntake_. Sandbox-safe; nothing sent to a seller.
 */

var INTAKE_INBOX_HEADERS = ['Timestamp', 'Seller Name', 'Phone', 'Email', 'Property Address',
  'Visit Date', 'Visit Time', 'Assigned Visitor', 'Lead Source', 'Task Body', 'Tags',
  'Status', 'Property ID', 'Processed At'];

// Contacts carrying any of these tags are NEVER auto-logged. Only an explicit hands-off flag.
// (Empty this array to log everything.)
var INTAKE_SKIP_TAGS = ['do not automate'];

function ensureIntakeInbox_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(CFG.INTAKE_INBOX_SHEET);
  if (!sh) { sh = ss.insertSheet(CFG.INTAKE_INBOX_SHEET); sh.setTabColor('#34a853'); }
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var existing = sh.getLastRow() >= 1
    ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); })
    : [];
  if (!existing.length || existing[0] !== 'Timestamp') {
    sh.getRange(1, 1, 1, INTAKE_INBOX_HEADERS.length).setValues([INTAKE_INBOX_HEADERS])
      .setFontWeight('bold').setBackground('#e6f4ea');
    sh.setFrozenRows(1);
    sh.setColumnWidth(5, 240); sh.setColumnWidth(10, 300); sh.setColumnWidth(11, 130);
  } else {
    var missing = INTAKE_INBOX_HEADERS.filter(function (h) { return existing.indexOf(h) < 0; });
    if (missing.length) {
      sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing])
        .setFontWeight('bold').setBackground('#e6f4ea');
    }
  }
  return sh;
}

function inboxGet_(row, idx, name) { return idx[name] != null ? row[idx[name]] : ''; }

function processIntakeInbox_() {
  var sh = ensureIntakeInbox_();
  var last = sh.getLastRow();
  if (last < 2) return { processed: 0, logged: 0, errors: 0 };
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var idx = {}; headers.forEach(function (h, i) { idx[String(h).trim()] = i; });
  if (idx['Status'] == null) return { processed: 0, logged: 0, errors: 0, note: 'no Status column' };
  var vals = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  var processed = 0, logged = 0, errors = 0, skipped = 0;
  for (var r = 0; r < vals.length; r++) {
    var row = vals[r];
    var rowNum = 2 + r;
    if (String(row[idx['Status']]).trim()) continue;
    var addr = String(inboxGet_(row, idx, 'Property Address')).trim();
    var body = String(inboxGet_(row, idx, 'Task Body')).trim();
    /*
     * A row with no address AND no body used to be skipped in silence, on the assumption that it was
     * an empty row. It is not always: three real appointments sat here for days carrying a seller
     * name, a phone and a visit date but NO Property Address, because whatever writes into this tab
     * never filled that column. Silence made them invisible — Status stayed blank, so the tab looked
     * like nothing had arrived, while the dashboard showed nothing because no Data row was ever made.
     *
     * A genuinely empty row is still skipped quietly. A row with real content but no address is now
     * MARKED, because an address is the one thing that cannot be worked around: no address means no
     * tracker row and no calendar event, and nobody can be sent to a house that was never named.
     */
    if (!addr && !body) {
      var hasSomething = ['Seller Name', 'Phone', 'Email', 'Visit Date', 'Visit Time']
        .some(function (f) { return String(inboxGet_(row, idx, f)).trim(); });
      if (hasSomething) {
        sh.getRange(rowNum, idx['Status'] + 1)
          .setValue('NOT LOGGED: no Property Address — fill it in on this row, then re-run');
        if (idx['Processed At'] != null) sh.getRange(rowNum, idx['Processed At'] + 1).setValue(new Date());
        processed++; errors++;
      }
      continue;
    }
    var tags = String(inboxGet_(row, idx, 'Tags')).toLowerCase();
    var blocked = INTAKE_SKIP_TAGS.filter(function (t) { return tags.indexOf(t) >= 0; });
    if (blocked.length) {
      sh.getRange(rowNum, idx['Status'] + 1).setValue('Skipped: ' + blocked.join(', '));
      if (idx['Processed At'] != null) sh.getRange(rowNum, idx['Processed At'] + 1).setValue(new Date());
      processed++; skipped++; continue;
    }
    var lead = {
      'Seller Name': inboxGet_(row, idx, 'Seller Name'),
      'Phone': inboxGet_(row, idx, 'Phone'),
      'Email': inboxGet_(row, idx, 'Email'),
      'Property Address': inboxGet_(row, idx, 'Property Address'),
      'Visit Date': inboxGet_(row, idx, 'Visit Date'),
      'Visit Time': inboxGet_(row, idx, 'Visit Time'),
      'Assigned Visitor': inboxGet_(row, idx, 'Assigned Visitor'),
      'Lead Source': inboxGet_(row, idx, 'Lead Source'),
      'Task Body': body
    };
    var res;
    try { res = webIntake_(lead); } catch (e) { res = { ok: false, error: String(e) }; }
    sh.getRange(rowNum, idx['Status'] + 1).setValue(
      res.ok ? ((res.created ? 'Logged (new)' : 'Logged (updated)') + ' · cal: ' + (res.calendar || '-'))
             : ('Error: ' + res.error));
    if (idx['Property ID'] != null) sh.getRange(rowNum, idx['Property ID'] + 1).setValue(res.ok ? (res.id || '') : '');
    if (idx['Processed At'] != null) sh.getRange(rowNum, idx['Processed At'] + 1).setValue(new Date());
    processed++; if (res.ok) logged++; else errors++;
  }
  SpreadsheetApp.flush();
  if (processed) logAuto_('INTAKE', '', 'Intake Inbox processed ' + processed + ' row(s): ' + logged + ' logged, ' + skipped + ' skipped, ' + errors + ' error(s).');
  return { processed: processed, logged: logged, skipped: skipped, errors: errors };
}

function setupIntakeInbox() {
  ensureIntakeInbox_();
  SpreadsheetApp.getActive().toast('Intake Inbox tab is ready. Point Zapier "Create Spreadsheet Row" at it.', 'Intake Inbox', 8);
}

function checkIntakeInboxNow() {
  var r = processIntakeInbox_();
  SpreadsheetApp.getActive().toast(
    'Intake Inbox: ' + r.processed + ' new · ' + r.logged + ' logged · ' + (r.skipped || 0) + ' skipped (Do Not Automate) · ' + r.errors + ' error(s).', 'Intake Inbox', 8);
}

function installInboxTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processIntakeInbox_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processIntakeInbox_').timeBased().everyMinutes(10).create();
  SpreadsheetApp.getActive().toast('Auto-check ON: Intake Inbox runs every 10 minutes.', 'Intake Inbox', 8);
}

function removeInboxTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processIntakeInbox_') { ScriptApp.deleteTrigger(t); n++; }
  });
  SpreadsheetApp.getActive().toast('Auto-check OFF (' + n + ' trigger removed).', 'Intake Inbox', 6);
}



/* ========================= GmailIntake.gs ========================= */

/**
 * GmailIntake.gs — read REI BlackBook task-assignment emails straight from Gmail and auto-log
 * property visits, with NO Zapier, NO REI API key, and NO public web app.
 *
 * WHY THIS EXISTS
 *   REI exposes nothing about a task to any external tool: Zapier has no task trigger, there is no
 *   API key, the public web app is blocked by the Workspace, and REI Workflows only send texts/emails.
 *   The ONE thing that escapes REI automatically is the task TITLE — it rides along in the
 *   "You have 1 new task assignment" email from noreply@reiblackbook.com, which we CAN read.
 *
 * THE TEAM'S ONE HABIT
 *   Title booked-appointment tasks so the title carries the seller + address + date/time, e.g.:
 *     Booked appointment | Cyn Ku | 2607 Gimelli Place #115, San Jose | Jul 24 11:00 AM
 *   Order after the keyword is: Seller | Address | Date Time  (pipe-separated).
 *   The date-only form ("Booked appointment on Jul 24") is recognized too, but without an address
 *   in the title there is nothing to log, so it is counted as "skipped (no address)".
 *
 * FLOW (fully automatic once the every-minute trigger is on)
 *   REI emails the task  ->  Gmail  ->  processReiTaskEmails_()  ->  webIntake_()  ->  dashboard
 *   card + calendar event + Automation Log.  Processed threads get the "PV-Logged" label so they
 *   are never re-scanned; webIntake_ upserts by address so reminders can never create duplicates.
 */

var GMAIL_CFG = {
  SENDER: 'noreply@reiblackbook.com',   // REI's notification sender
  SUBJECT: 'new task assignment',        // assignment email subject contains this phrase
  KEYWORD: 'booked appointment',         // only task titles containing this are treated as visits
  LABEL: 'PV-Logged',                    // applied to processed threads (created on first run)
  LOOKBACK: '7d',                        // how far back to scan
  /*
   * BLANK, not 'REI Task (email)'.
   *
   * That string was written straight into Lead Source, and it is not one of the nine values the column
   * accepts. Lead Source is validated with setAllowInvalid(false) — strict — so setValue THROWS on it and
   * takes the whole row with it, exactly as it once did on G379:
   *
   *   "The data you entered in cell G379 violates the data validation rules set on this sheet."
   *
   * The catch below turns that into errors++ and the loop moves on, so a booking emailed by REI could fail
   * silently and nothing on the board would show a lead had been missed.
   *
   * It was also the wrong FIELD. 'REI Task (email)' is how the booking reached us, not where the lead came
   * from; adding it to the dropdown would put a delivery channel in every lead-source report. Blank follows
   * the rule mapLeadSource already sets for a source it cannot place — leave it empty and let the raw text
   * stand in the record — and blank is what the sheet's own Missing Required Fields formula surfaces. The
   * email's task title is kept verbatim in Task Body either way, so nothing is lost.
   */
  LEAD_SOURCE: ''
};

/** Find (or create) a Gmail label by name. */
function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

/** Pull the task titles out of an REI notification email's HTML body (one per <li>, minus "Due:"). */
function extractReiTaskTitles_(html) {
  var titles = [], re = /<li[^>]*>([\s\S]*?)<\/li>/gi, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var txt = m[1].replace(/<[^>]+>/g, ' ')
                  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
                  .replace(/\s+/g, ' ').trim();
    txt = txt.replace(/\bDue:.*$/i, '').trim();   // drop trailing "Due: Monday, ..."
    if (txt) titles.push(txt);
  }
  return titles;
}

/**
 * Parse a task TITLE into { seller, address, visitDate, visitTime }.
 * Convention:  <keyword> | Seller | Address | Date Time
 * Also tolerates the date-only form "Booked appointment on Jul 24".
 */
function parseReiTaskTitle_(title) {
  var t = String(title || '').trim(), out = { raw: t };
  if (t.indexOf('|') >= 0) {
    var parts = t.split('|').map(function (s) { return s.trim(); }).filter(String);
    // parts[0] is the keyword ("Booked appointment"); the rest are Seller, Address, Date Time in order.
    var rest = parts.slice(1);
    for (var i = 0; i < rest.length; i++) {
      var p = rest[i];
      var looksDate = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(p) && /\d/.test(p);
      var looksAddr = /\d/.test(p) && (/,/.test(p) ||
        /(\bst\b|\bave\b|\brd\b|\bblvd\b|\bdr\b|\bln\b|\bct\b|\bway\b|\bpl\b|place|street|road|drive|court|lane|circle|#)/i.test(p));
      if (looksDate && !out.dateTime) out.dateTime = p;
      else if (looksAddr && !out.address) out.address = p;
      else if (!out.seller) out.seller = p;
      else if (!out.address) out.address = p;
    }
  }
  if (!out.dateTime) {   // date-only fallback: "...on Jul 24" / "...on July 24, 2026"
    var md = t.match(/on\s+([A-Za-z]{3,9}\.?\s+\d{1,2}(?:,?\s*\d{4})?(?:\s+\d{1,2}:\d{2}\s*[AP]M)?)/i);
    if (md) out.dateTime = md[1];
  }
  if (out.dateTime) {
    var s = out.dateTime.replace(/^[A-Za-z]+day,\s*/, '');
    var tm = s.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
    if (tm) out.visitTime = tm[1].toUpperCase().replace(/\s+/g, ' ');
    var dm = s.match(/([A-Za-z]{3,9}\.?\s+\d{1,2})(?:,?\s*(\d{4}))?/);
    if (dm) {
      var yr = dm[2] || String(new Date().getFullYear());
      out.visitDate = dm[1] + ', ' + yr + (out.visitTime ? ' ' + out.visitTime : '');
    }
  }
  return out;
}

var GMAIL_SEEN_PROP = 'PV_SEEN_MSG_IDS';   // Script Property: comma-joined processed message IDs

/**
 * Scan Gmail for REI task-assignment emails and log any booked-appointment titles.
 * Dedups per MESSAGE (not per conversation) via Script Properties — REI reuses one subject for
 * every assignment, so Gmail threads them together; a per-thread label would skip later bookings.
 * Returns { scanned, logged, skipped, errors }.
 */
function processReiTaskEmails_() {
  var props = PropertiesService.getScriptProperties();
  var seen = {};
  (props.getProperty(GMAIL_SEEN_PROP) || '').split(',').forEach(function (id) { if (id) seen[id] = true; });
  var label = getOrCreateLabel_(GMAIL_CFG.LABEL);   // visual marker in Gmail only (not used to skip)
  var q = 'from:' + GMAIL_CFG.SENDER +
          ' subject:("' + GMAIL_CFG.SUBJECT + '")' +
          ' newer_than:' + GMAIL_CFG.LOOKBACK;
  var threads = GmailApp.search(q, 0, 50);
  var scanned = 0, logged = 0, skipped = 0, errors = 0, added = 0;

  for (var i = 0; i < threads.length; i++) {
    var msgs = threads[i].getMessages();
    for (var j = 0; j < msgs.length; j++) {
      var mid = msgs[j].getId();
      if (seen[mid]) continue;                 // this exact email was already handled
      var titles = extractReiTaskTitles_(msgs[j].getBody());
      for (var k = 0; k < titles.length; k++) {
        var title = titles[k];
        if (title.toLowerCase().indexOf(GMAIL_CFG.KEYWORD) < 0) continue;   // not a visit booking
        scanned++;
        var p = parseReiTaskTitle_(title);
        if (!p.address) { skipped++; continue; }   // title has no address -> nothing to log
        var lead = {
          'Seller Name': p.seller || '',
          'Property Address': p.address,
          'Visit Date': p.visitDate || '',
          'Visit Time': p.visitTime || '',
          'Visit Status': 'Scheduled',          // a booking is always a scheduled visit...
          'Current Stage': 'Visit Scheduled',   // ...so it shows on the dashboard even on an update
          'Lead Source': GMAIL_CFG.LEAD_SOURCE,
          'Task Body': title
        };
        var res;
        try { res = webIntake_(lead); } catch (e) { res = { ok: false, error: String(e) }; }
        if (res.ok) logged++; else errors++;
      }
      seen[mid] = true; added++;               // remember this email so we never rescan it
    }
    threads[i].addLabel(label);
  }
  if (added) {
    var ids = Object.keys(seen);
    if (ids.length > 800) ids = ids.slice(ids.length - 800);   // keep the list bounded
    props.setProperty(GMAIL_SEEN_PROP, ids.join(','));
  }
  if (scanned) {
    logAuto_('GMAIL', '', 'REI task emails: ' + scanned + ' booking title(s) — ' + logged +
      ' logged, ' + skipped + ' skipped (no address in title), ' + errors + ' error(s).');
  }
  return { scanned: scanned, logged: logged, skipped: skipped, errors: errors };
}

/* ---------- menu-facing wrappers ---------- */

/** Menu: explain the setup + create the label. */
function setupGmailIntake() {
  getOrCreateLabel_(GMAIL_CFG.LABEL);
  SpreadsheetApp.getActive().toast(
    'Gmail auto-reader ready. Title booked tasks:  Booked appointment | Seller | Address | Date Time.',
    'Gmail Intake', 10);
}

/** Menu: scan REI task emails right now. */
function checkReiEmailsNow() {
  var r = processReiTaskEmails_();
  SpreadsheetApp.getActive().toast(
    'REI emails: ' + r.scanned + ' booking(s) · ' + r.logged + ' logged · ' +
    r.skipped + ' skipped (no address) · ' + r.errors + ' error(s).', 'Gmail Intake', 8);
}

/** Menu: install the every-minute Gmail scan. Removes any prior copy first. */
function installGmailTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processReiTaskEmails_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processReiTaskEmails_').timeBased().everyMinutes(1).create();
  SpreadsheetApp.getActive().toast('Gmail auto-reader ON: scans REI emails every minute.', 'Gmail Intake', 8);
}

/** Menu: remove the Gmail scan trigger. */
function removeGmailTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processReiTaskEmails_') { ScriptApp.deleteTrigger(t); n++; }
  });
  SpreadsheetApp.getActive().toast('Gmail auto-reader OFF (' + n + ' trigger removed).', 'Gmail Intake', 6);
}

/** Run from the editor to forget which emails were processed, so the next scan re-reads them. */
function resetGmailSeen() {
  PropertiesService.getScriptProperties().deleteProperty(GMAIL_SEEN_PROP);
  SpreadsheetApp.getActive().toast('Gmail reader reset — the next scan will re-read recent REI emails.', 'Gmail Intake', 6);
}

/** Editor test: parse a sample title without touching Gmail. Run and read the log. */
function testReiTitleParse() {
  var samples = [
    'Booked appointment | Cyn Ku | 2607 Gimelli Place #115, San Jose | Jul 24 11:00 AM',
    'Booked appointment on Jul 24',
    'Booked appointment | Jane Doe | 12 Oak St, Fremont | July 30, 2026 2:30 PM'
  ];
  samples.forEach(function (s) { Logger.log(s + '  =>  ' + JSON.stringify(parseReiTaskTitle_(s))); });
}


/* ========================= ChatNotify.gs ========================= */

/**
 * ChatNotify.gs — post the upcoming-visit digest to a Google Chat space.
 *
 * WHY A WEBHOOK: an incoming webhook is created inside the Space itself, so it needs no Cloud
 * project, no published Chat app, and no extra OAuth scope beyond external requests. The URL is the
 * only credential, so it is kept in Script Properties and never written into source or Git.
 *
 * SETUP (once)
 *   1. Open the Google Space -> space name -> Apps & integrations -> Manage webhooks
 *   2. Add webhook, name it e.g. "Twin Visit Logger", copy the URL
 *   3. Sheet menu: Twin Visit Logger -> "Set Google Chat webhook" and paste it
 *   4. Sheet menu: "Send visit digest to Chat now" to verify, then turn on the daily trigger
 *
 * DESIGN: one digest per morning rather than a message per booking. Per-visit pings flood the Space
 * and get muted, which defeats the point. Nothing here is ever sent to a seller.
 */

var CHAT_WEBHOOK_PROP = 'CHAT_WEBHOOK_URL';

/** Menu: store the webhook URL (kept out of source control). */
function setChatWebhook() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('Google Chat webhook',
    'Paste the incoming-webhook URL from the Space (Apps & integrations -> Manage webhooks).\n' +
    'Leave blank and press OK to REMOVE the current webhook.', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var url = String(res.getResponseText() || '').trim();
  var props = PropertiesService.getScriptProperties();
  if (!url) {
    props.deleteProperty(CHAT_WEBHOOK_PROP);
    ui.alert('Google Chat webhook removed. Digests will no longer be posted.');
    return;
  }
  if (url.indexOf('https://chat.googleapis.com/') !== 0) {
    ui.alert('That does not look like a Google Chat webhook URL.\nIt should start with https://chat.googleapis.com/');
    return;
  }
  props.setProperty(CHAT_WEBHOOK_PROP, url);
  ui.alert('Saved. Use "Send visit digest to Chat now" to test it.');
}

function chatWebhookUrl_() {
  return PropertiesService.getScriptProperties().getProperty(CHAT_WEBHOOK_PROP) || '';
}

/** POST a payload to the Space. Returns '' on success, or the error text. */
function chatPost_(payload) {
  var url = chatWebhookUrl_();
  if (!url) return 'no webhook configured';
  try {
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code >= 200 && code < 300) return '';
    return 'HTTP ' + code + ': ' + res.getContentText().slice(0, 300);
  } catch (e) {
    return String(e);
  }
}

var DASHBOARD_URL_PROP = 'DASHBOARD_URL';

/**
 * The dashboard link put on every Chat card.
 *
 * NOT ScriptApp.getService().getUrl(): that hands back the /dev URL, which only opens for people
 * who can edit the script. Everyone else on the team clicks the card and gets a Google error page —
 * which is exactly what happened. The deployed /exec URL is used instead.
 *
 * Order: the DASHBOARD_URL script property (set once via the menu, survives redeploys), then the
 * value in CFG, then getUrl() as a last resort so a fresh install still links somewhere.
 */
function dashboardUrl_() {
  var stored = '';
  try { stored = PropertiesService.getScriptProperties().getProperty(DASHBOARD_URL_PROP) || ''; } catch (e) {}
  if (stored) return normalizeExecUrl_(stored);
  if (CFG.DASHBOARD_URL) return normalizeExecUrl_(CFG.DASHBOARD_URL);
  try { return normalizeExecUrl_(ScriptApp.getService().getUrl() || ''); } catch (e) { return ''; }
}

/**
 * Repair the URL SHAPE. There are two forms of a Workspace web-app link and only one still works:
 *
 *   works:  https://script.google.com/a/macros/DOMAIN/s/ID/exec
 *   fails:  https://script.google.com/a/DOMAIN/macros/s/ID/exec     <- note where "macros" sits
 *
 * ScriptApp.getService().getUrl() hands back the second (legacy) form, and Google now answers it with
 * a Google Drive "unable to open the file" page. That is what the team saw when they tapped a card.
 * Rather than trusting whoever set the link to spot the difference, the shape is corrected here so
 * every path through dashboardUrl_ produces a link that opens.
 */
function normalizeExecUrl_(url) {
  var text = String(url || '').trim();
  if (!text) return '';
  return text.replace(
    /^(https:\/\/script\.google\.com)\/a\/(?!macros\/)([^\/]+)\/macros\/s\//,
    '$1/a/macros/$2/s/'
  );
}

/** Menu: paste the /exec link once. Refuses a /dev link, which is the whole bug this fixes. */
function setDashboardUrl() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.prompt(
    'Dashboard link for Chat cards',
    'Paste the deployed web-app link, ending in /exec.\n\n' +
    'Find it: Extensions -> Apps Script -> Deploy -> Manage deployments -> copy the Web app URL.\n\n' +
    'A /dev link will be rejected: it only opens for people who can edit the script, so everyone\n' +
    'else on the team gets an error page when they tap the card.\n\n' +
    'Leave blank to clear it and fall back to the built-in value.',
    ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return;

  var url = String(answer.getResponseText() || '').trim();
  var props = PropertiesService.getScriptProperties();
  if (!url) {
    props.deleteProperty(DASHBOARD_URL_PROP);
    ui.alert('Cleared. Chat cards will use the link built into the script.');
    return;
  }
  if (!/^https:\/\/script\.google\.com\//.test(url)) {
    ui.alert('That is not an Apps Script web-app link. It should start with https://script.google.com/');
    return;
  }
  if (/\/dev(\?|$)/.test(url)) {
    ui.alert('That is the /dev link. It only opens for editors of this script — the team would get\n' +
             'an error page. Use the /exec link from Manage deployments instead.');
    return;
  }
  props.setProperty(DASHBOARD_URL_PROP, url);
  ui.alert('Saved. Chat cards will link here:\n\n' + url);
}

/**
 * Visits that need attention: Visit Status = Scheduled with a visit date from today through
 * `daysAhead`. Excludes Source = TEST and closed-out records, matching every other live view.
 */
function upcomingVisitsForChat_(daysAhead) {
  var horizon = daysAhead == null ? 1 : daysAhead;
  var sh = dataSheet_();
  var last = sh.getLastRow();
  var out = [];
  if (last < CFG.FIRST_DATA_ROW) return out;
  var vals = sh.getRange(CFG.FIRST_DATA_ROW, 1, last - CFG.FIRST_DATA_ROW + 1, HEADERS.length).getValues();
  var today = today_();
  var until = new Date(today.getTime() + horizon * 864e5);

  vals.forEach(function (v) {
    var rec = {}; HEADERS.forEach(function (h, i) { rec[h] = v[i]; });
    if (!rec['Property Address']) return;
    if (String(rec['Source']).trim() === 'TEST') return;
    if (rec['Current Stage'] === 'Lost / Closed Out') return;
    if (String(rec['Visit Status']) !== 'Scheduled') return;

    // Visit Date may be a Date or a bare serial number when a row was written unformatted.
    var raw = rec['Visit Date'];
    var d = null;
    if (raw instanceof Date) d = new Date(raw.getFullYear(), raw.getMonth(), raw.getDate());
    else if (typeof raw === 'number' && raw > 1000) {
      var u = new Date(Date.UTC(1899, 11, 30) + Math.round(raw) * 864e5);
      d = new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
    }
    if (!d || d < today || d > until) return;

    out.push({
      id: rec['Property ID'] || '',
      seller: rec['Seller Name'] || '(no name)',
      address: rec['Property Address'],
      date: fmt_(d),
      time: cellDisplay_('Visit Time', rec['Visit Time']) || 'time not set',
      visitor: rec['Assigned Visitor'] || rec['Assigned Owner'] || 'UNASSIGNED',
      rei: rec['REI BlackBook Link'] || '',
      missing: rec['Missing Required Fields'] || ''
    });
  });

  out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return out;
}

/** Build the Chat card. Kept plain enough to stay readable on mobile. */
function buildVisitDigestCard_(visits, daysAhead) {
  var widgets = [];
  visits.forEach(function (v) {
    var lines = [
      '<b>' + v.seller + '</b>',
      v.address,
      '🗓 ' + v.date + ' · ' + v.time,
      '👤 ' + v.visitor
    ];
    if (v.visitor === 'UNASSIGNED') lines.push('⚠️ <b>No visitor assigned</b>');
    if (v.missing) lines.push('⚠️ Missing: ' + v.missing);
    widgets.push({ textParagraph: { text: lines.join('<br>') } });
    if (v.rei) {
      widgets.push({ buttonList: { buttons: [{ text: 'Open in REI', onClick: { openLink: { url: v.rei } } }] } });
    }
    widgets.push({ divider: {} });
  });

  var url = dashboardUrl_();
  if (url) {
    widgets.push({ buttonList: { buttons: [
      { text: 'Open dashboard to update', onClick: { openLink: { url: url } } }
    ] } });
  }

  var window_ = daysAhead === 0 ? 'today' : daysAhead === 1 ? 'today & tomorrow' : 'next ' + daysAhead + ' days';
  return {
    cardsV2: [{
      cardId: 'visit-digest',
      card: {
        header: {
          title: 'Property Visits — ' + window_,
          subtitle: visits.length + ' scheduled · ' + fmt_(today_())
        },
        sections: [{ widgets: widgets }]
      }
    }]
  };
}

/**
 * Post the digest. Returns { posted, count, error }.
 * Silent when there is nothing scheduled, so the Space stays quiet on empty days.
 */
function sendVisitDigestToChat(daysAhead) {
  var horizon = daysAhead == null ? 1 : daysAhead;
  var visits = upcomingVisitsForChat_(horizon);
  if (!visits.length) {
    logAuto_('CHAT', '', 'Visit digest skipped — no visits scheduled in the next ' + horizon + ' day(s).');
    return { posted: false, count: 0, error: '' };
  }
  var err = chatPost_(buildVisitDigestCard_(visits, horizon));
  logAuto_('CHAT', '', err
    ? ('Visit digest FAILED (' + visits.length + ' visit(s)): ' + err)
    : ('Visit digest posted to Google Chat · ' + visits.length + ' visit(s).'));
  return { posted: !err, count: visits.length, error: err };
}

/** Menu: post now and report what happened. */
function sendVisitDigestNow() {
  if (!chatWebhookUrl_()) {
    SpreadsheetApp.getUi().alert('No Google Chat webhook saved yet.\nUse "Set Google Chat webhook" first.');
    return;
  }
  var r = sendVisitDigestToChat(1);
  SpreadsheetApp.getActive().toast(
    r.error ? ('Chat digest failed: ' + r.error)
            : (r.count ? ('Posted ' + r.count + ' visit(s) to Google Chat.') : 'No visits scheduled today/tomorrow — nothing posted.'),
    'Google Chat', 10);
}

/** Menu: post the visit digest daily at 9am. Replaces any existing copy. */
function installChatDigestTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendVisitDigestToChat') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendVisitDigestToChat').timeBased().everyDays(1).atHour(9).create();
  SpreadsheetApp.getActive().toast('Morning visit digest ON — posts daily in the 9am hour.', 'Google Chat', 8);
}

/** Menu: stop the daily digest. */
function removeChatDigestTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendVisitDigestToChat') { ScriptApp.deleteTrigger(t); n++; }
  });
  SpreadsheetApp.getActive().toast('Daily Chat digest OFF (' + n + ' trigger removed).', 'Google Chat', 6);
}

/* ============================ instant new-booking alerts ============================ */

var CHAT_SEEN_PROP = 'CHAT_SEEN_IDS';   // Property IDs already announced to the Space

/**
 * Announce bookings that appeared since the last check — however they arrived.
 *
 * The local scraper writes rows straight into the sheet via the Sheets API, so no Apps Script event
 * ever fires for them. Watching for newly-appeared Property IDs therefore covers every path
 * (scraper, manual "Add property", webIntake_) from one place.
 *
 * The FIRST run seeds the seen-list WITHOUT posting, so switching this on cannot blast the Space
 * with every row already in the tracker.
 */
function notifyNewBookings() {
  if (!chatWebhookUrl_()) return { posted: 0, seeded: false };

  var props = PropertiesService.getScriptProperties();
  var stored = props.getProperty(CHAT_SEEN_PROP);
  var seen = {};
  (stored || '').split(',').forEach(function (id) { if (id) seen[id] = true; });

  var sh = dataSheet_();
  var last = sh.getLastRow();
  if (last < CFG.FIRST_DATA_ROW) return { posted: 0, seeded: false };
  var vals = sh.getRange(CFG.FIRST_DATA_ROW, 1, last - CFG.FIRST_DATA_ROW + 1, HEADERS.length).getValues();

  var fresh = [], ids = [];
  vals.forEach(function (v) {
    var rec = {}; HEADERS.forEach(function (h, i) { rec[h] = v[i]; });
    var id = String(rec['Property ID'] || '').trim();
    if (!id || !rec['Property Address']) return;
    if (String(rec['Source']).trim() === 'TEST') return;
    ids.push(id);
    if (seen[id]) return;
    if (rec['Current Stage'] === 'Lost / Closed Out') return;   // nothing to action
    fresh.push({
      id: id,
      seller: rec['Seller Name'] || '(no name)',
      address: rec['Property Address'],
      date: cellDisplay_('Visit Date', rec['Visit Date']) || 'no date',
      time: cellDisplay_('Visit Time', rec['Visit Time']) || 'time not set',
      visitor: rec['Assigned Visitor'] || rec['Assigned Owner'] || 'UNASSIGNED',
      stage: rec['Current Stage'] || '(no stage)',
      rei: rec['REI BlackBook Link'] || '',
      missing: rec['Missing Required Fields'] || ''
    });
  });

  var isFirstRun = (stored === null);
  props.setProperty(CHAT_SEEN_PROP, ids.slice(-1500).join(','));

  if (isFirstRun) {
    logAuto_('CHAT', '', 'New-booking watcher seeded with ' + ids.length + ' existing record(s); nothing posted.');
    return { posted: 0, seeded: true };
  }
  if (!fresh.length) return { posted: 0, seeded: false };

  var err = chatPost_(buildNewBookingCard_(fresh));
  logAuto_('CHAT', '', err
    ? ('New-booking alert FAILED (' + fresh.length + '): ' + err)
    : ('New-booking alert posted · ' + fresh.map(function (f) { return f.id; }).join(', ')));
  return { posted: err ? 0 : fresh.length, seeded: false, error: err };
}

function buildNewBookingCard_(items) {
  var widgets = [];
  items.forEach(function (v) {
    var lines = [
      '<b>' + v.seller + '</b>',
      v.address,
      '🗓 ' + v.date + ' · ' + v.time,
      '👤 ' + v.visitor,
      '📋 ' + v.stage
    ];
    if (v.visitor === 'UNASSIGNED') lines.push('⚠️ <b>Needs a visitor assigned</b>');
    if (v.missing) lines.push('⚠️ Missing: ' + v.missing);
    widgets.push({ textParagraph: { text: lines.join('<br>') } });
    if (v.rei) widgets.push({ buttonList: { buttons: [{ text: 'Open in REI', onClick: { openLink: { url: v.rei } } }] } });
    widgets.push({ divider: {} });
  });
  var url = dashboardUrl_();
  if (url) widgets.push({ buttonList: { buttons: [{ text: 'Open dashboard to update', onClick: { openLink: { url: url } } }] } });

  return { cardsV2: [{ cardId: 'new-booking', card: {
    header: { title: items.length > 1 ? (items.length + ' new property visits booked') : 'New property visit booked',
              subtitle: 'Added to the tracker · ' + fmt_(today_()) },
    sections: [{ widgets: widgets }]
  } }] };
}

/** Menu: check for new bookings now. */
function notifyNewBookingsNow() {
  if (!chatWebhookUrl_()) { SpreadsheetApp.getUi().alert('Save a Google Chat webhook first.'); return; }
  var r = notifyNewBookings();
  SpreadsheetApp.getActive().toast(
    r.seeded ? 'Watcher seeded with existing records — future bookings will be announced.'
             : (r.error ? ('Failed: ' + r.error) : (r.posted ? ('Announced ' + r.posted + ' new booking(s).') : 'No new bookings since the last check.')),
    'Google Chat', 10);
}

/** Menu: watch for new bookings every 5 minutes. */
function installChatNewBookingTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'notifyNewBookings') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('notifyNewBookings').timeBased().everyMinutes(5).create();
  SpreadsheetApp.getActive().toast('New-booking alerts ON — checks every 5 minutes.', 'Google Chat', 8);
}

function removeChatNewBookingTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'notifyNewBookings') { ScriptApp.deleteTrigger(t); n++; }
  });
  SpreadsheetApp.getActive().toast('New-booking alerts OFF (' + n + ' trigger removed).', 'Google Chat', 6);
}

/* ==================== the 3pm work queue ==================== */

/**
 * The 3pm digest, as a WORK QUEUE rather than a data-quality report.
 *
 * Cherry's revision, in her words: "Every category must represent one business action, not merely one
 * database condition", and she must know within ten seconds what the team works on first. The previous
 * version had four buckets and swept every incomplete field into one "Needs review / missing data"
 * pile, so a lead missing Seller Motivation sat next to a lead missing an owner — accurate, and no help
 * in deciding what to do.
 *
 * The seven buckets below are hers, in her priority order, each with exactly one action attached. A
 * lead appears ONCE, in the most urgent bucket that applies. Nothing here writes to the sheet: no due
 * date and no next action is ever invented in order to raise an alert.
 *
 * Two places where her structure needed a decision, both flagged for approval in
 * docs/3pm-Digest-Revision.md rather than settled quietly here:
 *   - Long-Term Nurture is exempt from "Missing Next Action", or bucket 3 would swallow every nurture
 *     lead before bucket 6 could ever see one.
 *   - A final bucket 8 catches records flagged Exception/Incomplete that match none of the seven. Her
 *     rule "if a record is ambiguous, flag it for review instead of guessing" needs somewhere to put
 *     them, and it is a residue rather than the old catch-all — if it grows, that is a finding.
 */
/*
 * Cherry's structure, second revision: FIVE stages plus gifts.
 *
 * She replaced the field-based buckets with the pipeline itself — "notification should be like this
 * only: Upcoming Visit / Completed Visit - Need next course of action / Pending offer - ASAP / Offer
 * Sent / Still negotiating ... also we want to track sending gifts to them as part of follow up".
 *
 * That is a better fit than what it replaced. The previous eight buckets answered "which field is
 * empty"; these five answer "where is this deal and who owes it a move", which is what a manager reads
 * a work queue for. Each maps to exactly one Current Stage, so the categories cannot drift from the
 * pipeline the team actually works.
 *
 * Two things her list leaves open, both flagged for her and neither decided here:
 *   - Verbal Agreement, Contract Sent and Long-Term Nurture are not in the five, so leads at those
 *     stages now appear nowhere. A verbal agreement with no contract out is a real gap.
 *   - The gift bucket is ADDITIVE — the one place a lead can appear twice. Sending a gift is a
 *     separate errand from moving the deal, and gifts are recommended at every stage, so a
 *     one-bucket-only rule would hide every gift behind its stage. See giftPending_.
 */
/*
 * How many leads each section lists before "…and N more".
 *
 * Five, at Cherry's instruction: "it only should have 5 person or lead should be included". It was
 * eight, which on a phone pushed the later sections off the first screen entirely — and the point of
 * the message is that she can see what to start on without scrolling. The count in the heading is
 * always the true total, so nothing is hidden by shortening the list; the section says so itself.
 */
/**
 * How fresh REI is, read from the sweep's own stamp in the Automation Log.
 *
 * The client, after a card told the whole team nobody had recorded five outcomes their colleague had
 * written up in REI that morning: "im asking why did the sysytem nofit the gc nit cheking of those?"
 *
 * Because the sweep and this card are on separate timers with nothing between them. The card published
 * whatever the sheet happened to hold, with no way to know it was stale and no way to say so. The client
 * had asked about exactly this earlier — "but all lead in 8 bucket should be chekd before sending the notif
 * right?" — and the sequencing was described and never built.
 *
 * The sweep runs 15 minutes before each posting and records when it finished; this reads that line.
 *
 * Two things are built on it, and they are different jobs. This function only WORDS the card. Whether the
 * card goes out at all is decided by digestWithFreshRei_, which holds it back until the stamp is recent —
 * the client's instruction: "you will check first the 8 bucket send ing the updates in to the gc."
 *
 * This half still matters after that one, because holding is not infinite: after three waits the card is
 * posted anyway rather than going silent, and then this is what tells the reader the data is old.
 */
/*
 * Ninety minutes, because the sweep runs hourly AND again at :45 before each card. Apps Script fires a
 * daily trigger anywhere inside the named hour, so the intended sweep can be as much as 74 minutes old by
 * the time the card runs (08:45 sweep, 09:59 card) and must still count as fresh. Anything past 90 means a
 * sweep was genuinely MISSED, not that this card came a little late.
 */
var DIGEST_FRESH_MINUTES = 90;

/**
 * When the bucket sweep last finished, as a Date, or null if it has never stamped the log.
 * Never throws — a missing tab or an unreadable cell reads as "no stamp".
 */
function reiSweptAt_() {
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName('Automation Log');
    if (!sh) return null;
    var last = sh.getLastRow();
    if (last < 2) return null;
    /*
     * Backwards in blocks, not one fixed tail.
     *
     * This read 120 rows and stopped, on the reasoning that the sweep's line is always among the most recent.
     * The log itself disproves it: 6 Aug took 138 rows in one day, and a single re-check run writes a line
     * PER UPDATED LEAD before its one SWEEP line. So a busy stretch after the last sweep pushes that line out
     * of a 120-row window, reiSweptAt_ returns null, and the card announces REI has never been checked on a
     * day it was checked — the exact false alarm this whole guarantee exists to avoid. Worse than a missed
     * card: it teaches the team that the held-queue warning is noise.
     *
     * Still bounded — a card must not read the whole log to print six words — but the bound is now 2,000 rows
     * of history rather than 120, reached in blocks that stop the moment a stamp is found. The usual case
     * still costs a single read.
     */
    var BLOCK = 250;
    var MAX_SCAN = 2000;
    var scanned = 0;
    var upto = last;
    while (upto >= 2 && scanned < MAX_SCAN) {
      var from = Math.max(2, upto - BLOCK + 1);
      var vals = sh.getRange(from, 1, upto - from + 1, 2).getValues();
      for (var i = vals.length - 1; i >= 0; i--) {
        if (String(vals[i][1]).trim().toUpperCase() !== 'SWEEP') continue;
        var d = new Date(vals[i][0]);
        return isNaN(d.getTime()) ? null : d;
      }
      scanned += vals.length;
      upto = from - 1;
    }
    return null;
  } catch (e) {
    return null;
  }
}

/** Minutes since the last sweep, or null when there is no stamp to measure from. */
function reiSweepAgeMinutes_() {
  var when = reiSweptAt_();
  return when ? Math.round((Date.now() - when.getTime()) / 60000) : null;
}

function reiFreshness_() {
  try {
    var when = reiSweptAt_();
    if (!when) return ' · REI freshness unknown';
    var mins = Math.round((Date.now() - when.getTime()) / 60000);
    var clock = Utilities.formatDate(when, Session.getScriptTimeZone(), 'h:mm a');
    return mins <= DIGEST_FRESH_MINUTES
      ? ' · REI checked ' + clock
      : ' · REI last checked ' + clock + ' — may be out of date';
  } catch (e) {
    return '';                                    // never let a stamp stop the queue going out
  }
}

var DIGEST_LINES_PER_SECTION = 5;

/*
 * Shorter lines, at the client's request: "we need to lessen in the notf."
 *
 * A line read like this on a phone:
 *
 *   Jose Anguiano · 2145 Capitol Ave, East Palo Alto, CA, 94303, UNITED STATES · Owner: Juan · OVERDUE ...
 *
 * Half of it is postcode, state and country. Nobody scanning a work queue needs any of the three: they know
 * which state they work in, and the street and town identify the property. Cherry's original complaint about
 * this message was that she could not see what to start on without scrolling, and length is what caused it.
 *
 * Dropped from the END only, and only when a part IS one of those things — so "340 Vallejo Dr, Apt 83,
 * Millbrae" keeps its flat number, and an address written in any other shape is left exactly as it is.
 */
function shortAddress_(address) {
  var parts = String(address || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean);
  var junk = /^(?:usa|us|united states)$/i;                       // country
  var zip = /^\d{5}(?:-\d{4})?$/;                                 // 94303 or 94303-1234
  var state = /^[A-Z]{2}$/;                                       // CA
  var stateZip = /^[A-Z]{2}\s+\d{5}(?:-\d{4})?$/;                // "CA 95401", written as one part
  while (parts.length > 1) {
    var last = parts[parts.length - 1];
    if (junk.test(last) || zip.test(last) || state.test(last) || stateZip.test(last)) { parts.pop(); continue; }
    break;
  }
  return parts.join(', ');
}

/*
 * A reason is one line of a scan, not a paragraph.
 *
 * REI's notes run to hundreds of characters — call transcripts, order summaries, escrow instructions — and one
 * of them wraps to five lines on a phone and pushes the sections below it off the screen. The full text is in
 * the sheet, where there is room for it; this is the version somebody reads while deciding what to pick up.
 */
var DIGEST_REASON_MAX = 120;

function clipReason_(reason) {
  var text = String(reason || '').replace(/\s+/g, ' ').trim();
  return text.length > DIGEST_REASON_MAX ? text.slice(0, DIGEST_REASON_MAX - 1).replace(/\s+\S*$/, '') + '…' : text;
}

/*
 * How long a gift stays visible after it has been sent.
 *
 * Three days: long enough that it appears on at least one 11am and one 3pm card, short enough that the
 * section still means "needs attention" rather than becoming a gift ledger.
 */
var GIFT_SENT_VISIBLE_DAYS = 3;

var ATTENTION_BUCKETS = [
  { key: 'upcomingVisit', icon: '📅', title: 'Upcoming Visit', stage: 'Visit Scheduled',
    action: 'Confirm the visit is going ahead. Afterwards mark it Completed or Canceled.' },
  /*
   * Cancelled visits get their OWN section, and move into it by themselves.
   *
   * The client: "the card should automatic move as well where that should be move, it should be automated
   * right?" He is right, and the distinction that makes it safe is between MOVING a card and CLOSING a
   * deal. Sara Davenport sat under "Upcoming Visit — confirm the visit is going ahead" for a visit that had
   * been called off, which made the section read as three visits coming up when one was off.
   *
   * So the card moves on VISIT STATUS, which REI and the team both set, while Current Stage — the thing
   * that decides whether a lead is dead — is still only ever moved by a person. The lead stops cluttering
   * the visit list and still cannot be quietly written off.
   */
  /*
   * "Cancelled, but nobody knows yet whether it is really off" gets its own place.
   *
   * Cherry, via the client: "if there was lead is suddenly cancelled but not sure if the lead will go or what,
   * should had a pending tab" — and, about Jose specifically, "this was for follow up, should move to follow up
   * tab."
   *
   * The distinction is between a lead that is OFF and a lead whose outcome is UNKNOWN, and they need opposite
   * actions. Off means rebook it or close it out — a decision. Unknown means find out first, and there is
   * nothing to decide until somebody has spoken to the seller. Putting both under one heading told whoever read
   * it to make a decision they did not yet have the facts for.
   *
   * Two kinds of lead land here, and neither needed a new Visit Status value — a value outside the workbook's
   * dropdown fails the whole row write:
   *   Reschedule Needed   called off but still wanted; the automation already writes this from REI's notes
   *   an OVERDUE visit    the date has passed and it is still marked Scheduled, so nobody knows what happened
   *
   * Jose Anguiano is the second kind, which is exactly where Cherry asked for him. It also means Upcoming Visit
   * finally contains only visits that are actually still upcoming.
   */
  { key: 'pendingFollowUp', icon: '⏳', title: 'Follow Up — Outcome Not Known Yet', stage: '',
    action: 'Ask the seller whether it is still going ahead, then set a date or close it out.' },
  { key: 'needsRebooking', icon: '🚫', title: 'Cancelled — Close Out or Rebook', stage: '',
    action: 'Agree a new date with the seller, or move the lead to Lost / Closed Out.' },
  { key: 'needsDecision', icon: '📋', title: 'Completed Visit — Needs Next Course of Action', stage: 'Visit Completed — Needs Review',
    action: 'Decide: make an offer, pass, or move to nurture — and set the next action.' },
  { key: 'offerPending', icon: '⏱', title: 'Pending Offer — ASAP', stage: 'Offer Preparation',
    action: 'Finish the offer and get it sent today.' },
  { key: 'offerSent', icon: '📤', title: 'Offer Sent', stage: 'Offer Sent',
    action: 'Follow up with the seller for a decision.' },
  { key: 'negotiating', icon: '🤝', title: 'Still Negotiating', stage: 'Active Negotiation',
    action: 'Decide the counter response and keep it moving.' },
  { key: 'giftFollowUp', icon: '🎁', title: 'Gift Follow-Up', stage: '',
    action: 'Approve the gift, or send it and record the sent date.' }
];

/** A sheet date cell (real Date or Sheets serial) as a local midnight Date, or null. */
function dateCell_(raw) {
  if (raw instanceof Date) return new Date(raw.getFullYear(), raw.getMonth(), raw.getDate());
  if (typeof raw === 'number' && raw > 1000) {
    var u = new Date(Date.UTC(1899, 11, 30) + Math.round(raw) * 864e5);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  /*
   * A date written as TEXT, which is what most of these cells actually hold.
   *
   * This accepted a Date or a serial and rejected everything else, and the preview reported "no visit date
   * set — nothing is actually booked" for four leads including one booked for the next day and one the card
   * had shown as OVERDUE that morning. The sheet was right: Jose Anguiano's row holds Visit Date 2026-08-01.
   *
   * The automation writes dates as strings, so those cells are TEXT, not dates — which means this affected
   * the live 3pm card too, not just the preview. Every row written by the automation rather than typed by a
   * person was invisible to every date rule here.
   *
   * Both shapes the sheet contains: ISO from the automation, US from the workbook's own formatting. Built
   * from the parts rather than via new Date(string), which reads "2026-08-01" as UTC midnight and lands on
   * July 31 for anyone west of Greenwich — the same one-day shift that put a task on the wrong day once
   * already.
   */
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  var iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  var us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (us) return new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2]));
  return null;
}

/*
 * A TIME cell, rendered as a time.
 *
 * "visit TODAY at Sat Dec 30 1899 16:00:00 GMT-0800". A time-only cell is a Date on the spreadsheet epoch —
 * 30 December 1899 — and this was doing String() on it. The bug was always here; it only became visible once
 * dates parsed, because until then no line ever got as far as printing a time.
 *
 * Three shapes, because three things reach this: a Date from Apps Script's getValues(), a fraction of a day
 * from the Sheets API, and plain text like "10:30 AM" from a cell somebody typed. Anything unrecognised is
 * returned untouched rather than blanked — an odd-looking time still tells the reader more than nothing.
 */
function clock_(hours, minutes) {
  var h = ((hours % 12) + 12) % 12;
  return (h === 0 ? 12 : h) + ':' + (minutes < 10 ? '0' : '') + minutes + ' ' + (hours % 24 < 12 ? 'AM' : 'PM');
}

function timeCell_(raw) {
  if (raw instanceof Date) return clock_(raw.getHours(), raw.getMinutes());
  if (typeof raw === 'number' && isFinite(raw)) {
    // The Sheets API sends a time as a fraction of a day: 0.5 is noon.
    var mins = Math.round((raw - Math.floor(raw)) * 1440);
    if (!mins) return '';
    return clock_(Math.floor(mins / 60) % 24, mins % 60);
  }
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  var m = /(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/.exec(s);
  if (!m) return s;
  var h = Number(m[1]);
  if (m[3]) { h = h % 12; if (/p/i.test(m[3])) h += 12; }
  return clock_(h % 24, Number(m[2]));
}

/**
 * The MOMENT a visit starts — its date and its time together — or null when the time is unknown.
 *
 * Everything else in this file compares dates at midnight, which is right for "is this booked for today".
 * It is wrong for "has this already happened", and the client saw exactly that: the 4pm card listed a visit
 * at 2:00 PM and one at 3:00 PM under "Confirm the visit is going ahead", two hours after they had been and
 * gone. Their words: "its not accurate the notif this was alreday update with my colleaguse."
 *
 * A visit is only upcoming until it starts. After that the question is what happened, which is a different
 * section with a different ask.
 */
function visitStartsAt_(rec, on) {
  if (!on) return null;
  var hhmm = timeCell_(rec['Visit Time']);          // '2:00 PM' or ''
  if (!hhmm) return null;                            // no time: date-only comparison is all we have
  var m = /(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/.exec(hhmm);
  if (!m) return null;
  var h = Number(m[1]);
  if (m[3]) { h = h % 12; if (/p/i.test(m[3])) h += 12; }
  var at = new Date(on.getTime());
  at.setHours(h % 24, Number(m[2]), 0, 0);
  return at;
}

/*
 * How long after a visit STARTS before the card stops calling it upcoming.
 *
 * An hour, matching DEFAULT_VISIT_DURATION_MINUTES: during the visit itself "confirm it is going ahead" is
 * merely redundant, and nagging somebody about an outcome while they are standing in the property would be
 * worse than the problem being fixed. An hour after the start, asking what happened is the right question.
 */
var VISIT_GRACE_MS = 60 * 60 * 1000;

/** Is this lead finished, or not a lead at all? Nothing excluded here ever reaches the notification. */
function excludedFromDigest_(rec) {
  var stage = String(rec['Current Stage'] || '').trim();
  var source = String(rec['Source'] || '').trim();
  if (!rec['Property Address']) return 'no property address';
  if (source === 'TEST') return 'test row';
  if (stage === 'Lost / Closed Out') return 'closed out';
  if (stage === 'Contract Signed') return 'contract signed';

  /*
   * Pre-cutover history is kept OUT of the work queue.
   *
   * The first live run posted 103 leads. Nearly every line read "Owner: UNASSIGNED · no visit date set",
   * "offer not priced yet", or "no contact for 131 day(s)" — the rows imported from the old workbook,
   * which carry a stage but no owner, no dates and no decisions. A 103-line message fails the one
   * requirement Cherry set, that she can see what to work on first, and it fails it on volume rather
   * than on anything about the categories.
   *
   * Source = 'Import' is the exact signature: importFromOldWorkbook stamps it, and nothing else does.
   * The dashboard writes 'Manual', the REI intake writes 'Intake', the scraper writes its own. So no
   * cutover date has to be invented and no live lead can be caught by accident.
   *
   * The rows are NOT touched, hidden or closed — they stay in the sheet and on the dashboard, where
   * Operations can work through them deliberately. This only keeps them out of the daily message.
   * Set CFG.DIGEST_INCLUDE_IMPORTED = true to put them back.
   */
  if (source === 'Import' && !CFG.DIGEST_INCLUDE_IMPORTED) return 'imported history (pre-cutover)';
  return '';
}

/**
 * Which stage bucket this lead belongs in, and the exact reason it is listed. null = no stage bucket.
 *
 * One lead, one stage bucket: the stages are mutually exclusive, so there is no priority puzzle to
 * solve — a lead is at exactly one point in the pipeline. The order of ATTENTION_BUCKETS is Cherry's
 * reading order, not a tie-break.
 *
 * `today` is injected so the decision is testable and does not depend on when the tests run.
 */
function attentionBucket_(rec, today, now) {
  if (excludedFromDigest_(rec)) return null;
  var nowAt = now || today;
  var stage = String(rec['Current Stage'] || '').trim();

  for (var i = 0; i < ATTENTION_BUCKETS.length; i++) {
    var b = ATTENTION_BUCKETS[i];
    if (!b.stage || b.stage !== stage) continue;

    /*
     * An overdue visit is not a separate bucket any more — Cherry's five do not include one. It is
     * called out INSIDE Upcoming Visit instead, because a visit whose date has passed while still
     * marked Scheduled is the single most urgent line in the whole message, and dropping it silently
     * because there is no bucket for it would be the worst outcome of this simplification.
     */
    if (b.key === 'upcomingVisit') {
      var on = dateCell_(rec['Visit Date']);
      var status = String(rec['Visit Status'] || '').trim();
      var was = on ? ' — was booked for ' + fmt_(on) : '';

      /*
       * A CANCELLED visit is still listed here, and says so.
       *
       * Cancelling does not move Current Stage — realignStage_ leaves it alone for a human to close
       * out — so the lead stays at Visit Scheduled and lands in this section. Reading it back showed
       * the bug: a cancelled visit appeared under "Confirm the visit is going ahead" as "visit Aug 12,
       * 2026", and a cancelled visit whose date had passed read "OVERDUE ... still marked Canceled",
       * which is nonsense.
       *
       * Removing it from the section would be worse: a cancellation is exactly the thing someone has
       * to act on, by rebooking or closing the lead out. So it stays, labelled, and sorts to the top.
       */
      /*
       * `sort` orders the section by the visit's own date. Cherry: "it should be prioritized, the
       * upcoming visit by its date that near to visit" — so the soonest visit is the first line, not
       * whichever row happens to sit highest in the sheet. A visit with no date sorts last within its
       * group, because there is no date to be near to.
       */
      var at = on ? on.getTime() : Infinity;

      /*
       * Out of Upcoming Visit and into its own section, automatically. The key is 'needsRebooking', not
       * b.key, which is what actually moves the card — see the bucket comment above for why this is done on
       * Visit Status and never by rewriting Current Stage.
       */
      if (status === 'Canceled') {
        return { key: 'needsRebooking', attention: true, sort: at,
          reason: 'CANCELED' + was + ' — rebook it or close the lead out' };
      }
      /*
       * Called off but still wanted is not the same as called off. It goes to Follow Up, where the job is to
       * find out, rather than to Cancelled, where the job is to decide.
       */
      if (status === 'Reschedule Needed') {
        return { key: 'pendingFollowUp', attention: true, sort: at,
          reason: 'RESCHEDULE NEEDED' + was + ' — agree a new date with the seller' };
      }

      /*
       * No date is not an upcoming visit either. It goes to Follow Up with the rest of the unknowns.
       *
       * The client, looking at the live board: "UPCOMING VISITS (SCHEDULED) 8" where every one of the eight
       * read NO DATE — "some is not in the upcoming visit, some of them is dead lead and follow up." A heading
       * that says Scheduled over eight leads with nothing scheduled is simply untrue, and the count is the part
       * people act on.
       *
       * Leaving them there was my call when the Follow Up section went in, on the grounds that a missing date is
       * a booking gap rather than an unknown outcome. Seen on the board that distinction does not survive: there
       * is no date, no owner and no visit, so the job is the same as the rest of this section — find out where
       * the lead actually stands, then book it or close it out.
       */
      if (!on) return { key: 'pendingFollowUp', attention: true, sort: at, reason: 'no visit date set — nothing is actually booked' };
      /*
       * An overdue visit moves to Follow Up too, and this is the change Cherry asked for by name.
       *
       * It used to sit inside Upcoming Visit under "Confirm the visit is going ahead" — for a visit whose date
       * had already passed, where there is nothing left to confirm. Jose Anguiano had been reading that way for
       * five days. What is actually needed is to find out what happened, which is this section's whole purpose.
       *
       * A side effect worth having: Upcoming Visit now contains only visits that really are upcoming, so its
       * count means what it says.
       */
      /*
       * Started more than an hour ago counts as past, even when the date is today.
       *
       * This is the half the date comparison could not see. `on < today` only catches yesterday and earlier,
       * so a visit at 2:00 PM stayed under "Confirm the visit is going ahead" until midnight — which is what
       * the 4pm card showed the client, about two visits that had already been and gone.
       */
      var startsAt = visitStartsAt_(rec, on);
      var alreadyStarted = startsAt && nowAt.getTime() > startsAt.getTime() + VISIT_GRACE_MS;
      if (on < today || alreadyStarted) {
        /*
         * If somebody HAS recorded the outcome, say so and quote it. Do not ask again.
         *
         * The old line ended "— nobody has recorded what happened", and a colleague read that in the team
         * channel about five leads they had written up properly in REI that morning. They were angry, and
         * they were right to be.
         *
         * The deeper fault was not the wording, it was that this rule never looked. The re-check copies
         * REI's latest note into Last Contact Result and stamps Last Contact Date, so their work was
         * already sitting in the workbook — one column away from the rule that declared it missing. A card
         * that ignores the answer and then blames people for not answering is worse than no card.
         *
         * So: a contact result dated ON OR AFTER the visit is treated as the outcome. It is still listed,
         * because Visit Status remains wrong and the dashboard, the reports and the counts all read that
         * field — but the ask becomes the one click that is genuinely outstanding, and the line carries
         * what REI says rather than an accusation.
         */
        var lastOn = dateCell_(rec['Last Contact Date']);
        if (lastOn && lastOn.getTime() >= on.getTime()) {
          /*
           * The DATE of REI's latest note, never its text.
           *
           * Quoting the text was my first attempt and it was wrong. Last Contact Result holds whatever REI
           * noted most recently, which for Joe Dickerson was "107 Virginia Street, Hayward, CA 94544 Offer
           * deadline: No offer deadline stated in MLS" — listing boilerplate. Prefixed with "REI says:" it
           * reads as the visit outcome, which is precisely the confusion this line is meant to remove. The
           * client caught it in the preview before it ever posted.
           *
           * Nothing here can tell an outcome from a comp note, and guessing from prose is how a card starts
           * asserting things nobody checked. So the claim is narrowed to what is actually provable: somebody
           * was working this lead in REI after the visit date. That is enough to stop implying neglect, and
           * it stops short of saying what happened — which only the person who was there can record.
           */
          /*
           * Worded to FIT. DIGEST_REASON_MAX clips at 120 characters, and the first version ran to about
           * 135 — so it published "REI was last noted 2026-08-08 — tick it Completed or…" and cut off the
           * only actionable words in the line. A truncated instruction is worse than a terse one.
           */
          return { key: 'pendingFollowUp', attention: true, sort: at,
            reason: 'visit was ' + fmt_(on) + ' · tracker says ' + (status || 'Scheduled')
              + ' · REI noted ' + fmt_(lastOn) + ' — tick Completed or Canceled' };
        }
        /*
         * A visit earlier TODAY is not "overdue" — it is simply finished, and nobody has said how it went.
         *
         * The same word for both would be wrong in opposite directions: calling a visit from last Tuesday
         * "today at 2:00 PM" hides how long it has been sitting, and shouting OVERDUE about something that
         * happened ninety minutes ago reads as an accusation. The client's complaint was precisely this
         * tone — the card told the team to chase visits their colleagues had already been to.
         */
        if (on.getTime() === today.getTime()) {
          var clockText = timeCell_(rec['Visit Time']);
          return { key: 'pendingFollowUp', attention: true, sort: at,
            reason: 'visit was earlier today' + (clockText ? ' at ' + clockText : '')
              + ' — how did it go? mark it Completed or Canceled' };
        }
        return { key: 'pendingFollowUp', attention: true, sort: at,
          reason: 'OVERDUE — visit was ' + fmt_(on) + ' and the tracker still says ' + (status || 'Scheduled')
            + ' — mark it Completed or Canceled to clear this' };
      }
      var when = on.getTime() === today.getTime() ? 'TODAY' : fmt_(on);
      var time = timeCell_(rec['Visit Time']);
      return { key: b.key, sort: at, reason: 'visit ' + when + (time ? ' at ' + time : '') };
    }

    if (b.key === 'needsDecision') {
      var visited = dateCell_(rec['Visit Date']);
      return { key: b.key,
        reason: 'visited' + (visited ? ' ' + fmt_(visited) : '') + ', no offer decision recorded yet' };
    }

    if (b.key === 'offerPending') {
      var amount = rec['Approved Offer Amount'];
      var has = amount !== '' && amount !== null && amount !== undefined;
      return { key: b.key,
        reason: has ? 'offer of ' + digestMoney_(amount) + ' prepared but not sent' : 'offer not priced yet' };
    }

    if (b.key === 'offerSent') {
      var sentOn = dateCell_(rec['Offer Sent Date']);
      var amt = rec['Approved Offer Amount'];
      var parts = [];
      if (amt !== '' && amt !== null && amt !== undefined) parts.push(digestMoney_(amt));
      parts.push(sentOn ? 'sent ' + fmt_(sentOn) : 'sent date not recorded');
      var quiet = Number(rec['Days Since Last Activity']);
      if (isFinite(quiet) && quiet > 0) parts.push('no contact for ' + quiet + ' day(s)');
      return { key: b.key, reason: parts.join(' · ') };
    }

    if (b.key === 'negotiating') {
      var counter = rec['Counteroffer Amount'];
      var said = String(rec['Last Contact Result'] || '').trim();
      var bits = [];
      if (counter !== '' && counter !== null && counter !== undefined) bits.push('seller countered at ' + digestMoney_(counter));
      if (said) bits.push(said.length > 90 ? said.slice(0, 87) + '…' : said);
      if (!bits.length) bits.push('undecided since the offer went out');
      return { key: b.key, reason: bits.join(' · ') };
    }
  }
  return null;
}

/**
 * Does this lead owe a gift? Returns the reason, or '' when nothing is due.
 *
 * ADDITIVE, and deliberately so: a gift is recommended at any stage, so making it compete with the
 * stage buckets would mean every gift stayed invisible behind the deal it belongs to. Sending a gift
 * is a different errand, done by a different person, than deciding a counter-offer.
 *
 * 'Recommended' needs an approval; 'Approved' needs someone to actually send it and record the date.
 * 'Sent' and 'Not Appropriate' are finished, and 'Not Reviewed' is not a commitment anyone has made.
 */
function giftPending_(rec) {
  /*
   * A gift can surface on a lead the STAGE sections have finished with.
   *
   * "THE GIFT IS NOT INCLUDED?" — no, and this was a bug I introduced today. Rob Walker is Contract Signed,
   * excludedFromDigest_ drops that stage, and giftPending_ deferred to it wholesale. So the moment Contract
   * Signed leads became re-checkable and their gifts started reaching the sheet, the one section that exists
   * to track those gifts could not show them.
   *
   * Gifts follow a deal PAST its stage — Rob's is a post-signing apology basket — so the stage-based
   * exclusions do not apply here. The Gift Follow-Up section is already the one place a lead may appear
   * twice, which is why letting it ignore stage is consistent rather than a special case.
   *
   * Contract Signed is allowed through; Lost / Closed Out is NOT. A won deal earns follow-up, and Rob's
   * basket is exactly that. A dead lead should not generate a to-do — dropping the whole stage check was an
   * over-correction that had a closed-out lead asking Cherry to approve a gift for a seller nobody is
   * pursuing. If the team does want apology gifts on lost leads, that is a decision to make deliberately.
   *
   * Source = 'Import' does NOT exclude a gift either, and that took reading the live sheet to find.
   *
   * After the stage fix above, Rob Walker's gift STILL did not appear. His row is Source = 'Import' — he
   * came in with the 373 rows recovered from the client's own workbook — and the queue drops imported rows
   * on volume grounds. That argument is about a backlog of 373 leads all claiming attention at once. It does
   * not transfer to gifts: a gift is money already spent on a named seller, there were exactly two in the
   * whole sheet when this was written, and the section caps at five lines anyway. Worse, the tracker only
   * began in July, so nearly every lead far enough along to be sent a gift is imported by definition — the
   * exclusion was removing the section's whole subject matter.
   *
   * The remaining two are about the ROW: nowhere to send anything, and a test row.
   */
  if (!rec['Property Address']) return '';
  if (String(rec['Source'] || '').trim() === 'TEST') return '';
  if (String(rec['Current Stage'] || '').trim() === 'Lost / Closed Out') return '';

  var status = String(rec['Gift Status'] || '').trim();
  if (status === 'Recommended') {
    var why = String(rec['Gift Recommendation Reason'] || '').trim();
    var who = String(rec['Gift Approval Owner'] || '').trim();
    return 'gift recommended' + (why ? ' (' + why + ')' : '') +
      ' — awaiting approval' + (who ? ' from ' + who : '');
  }
  if (status === 'Approved') {
    if (dateCell_(rec['Gift Sent Date'])) return '';       // approved AND sent: finished
    var by = String(rec['Gift Approved By'] || '').trim();
    var on = dateCell_(rec['Gift Approval Date']);
    return 'gift approved' + (by ? ' by ' + by : '') + (on ? ' on ' + fmt_(on) : '') +
      ' — not sent yet';
  }
  /*
   * A gift SENT in the last few days is shown as confirmation, then drops off by itself.
   *
   * The section is a work queue and a sent gift needs no action, so listing every gift ever sent would grow
   * it forever and bury the ones still waiting on somebody. But a gift that went out yesterday is the team's
   * own follow-up landing, and Cherry asked to "track sending gifts to them as part of follow up" — tracking
   * that only ever shows what has NOT happened is half a tracker.
   *
   * GIFT_SENT_VISIBLE_DAYS is the whole compromise: long enough to be seen at the next digest, short enough
   * that the section still means "needs attention" a week later.
   */
  if (status === 'Sent') {
    var sentOn = dateCell_(rec['Gift Sent Date']);
    if (!sentOn) return 'gift marked Sent but no Gift Sent Date recorded';
    var age = Math.round((today_().getTime() - sentOn.getTime()) / 86400000);
    if (age < 0) return 'gift out for delivery on ' + fmt_(sentOn);
    if (age <= GIFT_SENT_VISIBLE_DAYS) {
      /*
       * "gift SENT Aug 4 — Gift ordered in REI — ordered 08/04/2026 — nothing to do" was the real line, and
       * it says "gift ordered in REI" to a reader who has just been told the gift was sent. The reason column
       * carries that prefix because it has to stand alone in the sheet; on the card it is noise, so it comes
       * off here rather than being left out of the column.
       */
      var what = String(rec['Gift Recommendation Reason'] || '').trim()
        .replace(/^gift ordered in REI\s*[—-]\s*/i, '')
        /*
         * And the "ordered 08/04/2026" clause, because the line has already given a date.
         *
         * Marlene's read "gift SENT 2026-08-04 — ordered 08/04/2026 — nothing to do", which is the same date
         * twice in two formats and says nothing about what was actually sent. The column keeps the order date
         * — ordered and delivered are genuinely different facts on the record — but on a card that already
         * leads with the sent date it is noise.
         */
        .replace(/\s*·?\s*\bordered\s+\d{1,2}\/\d{1,2}\/\d{4}\s*$/i, '')
        .replace(/^·\s*/, '')
        .trim();
      return 'gift SENT ' + fmt_(sentOn) + (what ? ' — ' + what : '') + ' — nothing to do, for your awareness';
    }
    return '';
  }
  return '';
}

/**
 * A currency cell as "$450,000". Non-numbers come back as they were written.
 *
 * NOT called money_: there is already a money_ in this project with different behaviour — it returns
 * '' for a zero amount, where this returns '$0'. Two functions of the same name in one Apps Script
 * project silently resolve to whichever loads last, which made the offer-prep task text depend on file
 * order. Distinct name, no collision, no order dependency.
 */
function digestMoney_(v) {
  var n = Number(v);
  if (!isFinite(n) || v === '' || v === null) return String(v == null ? '' : v);
  return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/*
 * ── Check the buckets FIRST, then send. ──────────────────────────────────────────────────────────
 *
 * The client, in as many words: "it should be like this ok do you get me you will check first the 8 bucket
 * send ing the updates in to the gc." And earlier, twice: "but all lead in 8 bucket should be chekd before
 * sending the notif right?" / "im asking why did the sysytem nofit the gc nit cheking of those?"
 *
 * What existed was two independent clocks. The sweep was SCHEDULED 15 minutes before the card, and the card
 * printed how old the sweep was — but if the sweep was slow, or the PC was asleep, or it crashed, the card
 * went out anyway carrying yesterday's picture with a small apology attached. That is not "check first, then
 * send"; that is "send, and hope". It is how a card came to tell the whole team nobody had recorded five
 * outcomes their colleague had written up in REI that morning.
 *
 * So the trigger no longer posts. It asks one question — has the sweep finished recently? — and:
 *
 *   fresh   → post now.
 *   stale   → post NOTHING, and come back in 10 minutes. Up to three times.
 *   still stale after the third wait → post anyway, with the card saying the data may be out of date.
 *
 * The last line is deliberate and it is the one trade-off worth understanding. The wait cannot be infinite:
 * if the PC is off, no amount of waiting produces a sweep, and a work queue that goes SILENT on those days is
 * worse than one that arrives late with a warning — silence looks identical to "nothing needs doing", and the
 * leads on the list still need working. So the guarantee is: the buckets are checked before the card is sent,
 * and on the days that is impossible you are told, in the card, rather than left to assume.
 *
 * The visible cost: a card can now arrive up to half an hour after its hour. That is the price of it being
 * true when it does arrive.
 *
 * The menu item does NOT wait. Somebody who clicked "post now" is standing there asking for what the sheet
 * holds this second, and making them wait 30 minutes for it would be absurd.
 */
var DIGEST_RETRY_MINUTES = 10;
var DIGEST_MAX_WAITS = 3;
var DIGEST_WAIT_KEY = 'DIGEST_WAITING_FOR_SWEEP';
var DIGEST_RETRY_HANDLER = 'retryAttentionDigest';
var DIGEST_HELD_KEY = 'DIGEST_HELD_LAST';

/**
 * What a held-queue notice would be SAYING, as a string, so the same thing is not said twice.
 *
 * The client, on the second identical card in one day: "it happend again". It had. The digest runs three
 * times a day, and while REI stays unswept every one of those runs exhausts its waits and posts the same
 * outage — same wording, same "since 4:04 PM on Thu 13 Aug", nothing new in it.
 *
 * That repetition is the thing this card cannot afford. Its whole value is that it is rare and true; three
 * copies of an unchanged fact reads as a malfunctioning alarm, and a team that learns to scroll past the
 * outage card will scroll past the next one too — including the one that matters.
 *
 * Identity is the sweep it is reporting, plus the day. So:
 *   - the same outage, later the same day  -> logged, not posted
 *   - the same outage still there tomorrow -> posted again, because a second day is news
 *   - a sweep landed and it went stale again -> posted, because that is a different outage
 */
function heldNoticeKey_() {
  var at = reiSweptAt_();
  var day;
  try { day = fmt_(today_()); } catch (e) { day = ''; }
  return (at ? String(at.getTime()) : 'never') + '@' + day;
}

/** The scheduled 9am / 11am / 4pm posting. Waits for a fresh sweep before it says anything. */
function sendAttentionDigestToChat() {
  return digestWithFreshRei_();
}

/**
 * The one-off trigger digestWithFreshRei_ sets when it decides to wait.
 *
 * It clears itself first. Apps Script caps a project at 20 triggers and a one-off that has already fired is
 * still counted until it is deleted, so leaving them behind would eventually stop the digest installing at
 * all — a failure that would show up weeks later as "the 9am card stopped coming".
 */
function retryAttentionDigest() {
  clearDigestRetryTriggers_();
  return digestWithFreshRei_();
}

function clearDigestRetryTriggers_() {
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === DIGEST_RETRY_HANDLER) ScriptApp.deleteTrigger(t);
    });
  } catch (e) { /* a trigger we cannot delete must not stop the queue going out */ }
}

/**
 * How many times this posting has already stood down, and when it started.
 *
 * Keyed on nothing but a timestamp on purpose. Keying it on the hour looked tidier and was wrong: a card
 * that fires at 9:55 and waits twice is asking again at 10:15, in a different hour, and the counter would
 * have reset every time — an unbounded loop that never posts. Anything older than an hour is a new posting.
 */
function digestWaitCount_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(DIGEST_WAIT_KEY);
    if (!raw) return 0;
    var o = JSON.parse(raw);
    if (!o || !o.at || (Date.now() - o.at) > 60 * 60 * 1000) return 0;
    return Number(o.n) || 0;
  } catch (e) {
    return 0;
  }
}

function setDigestWaitCount_(n) {
  try {
    var p = PropertiesService.getScriptProperties();
    if (!n) { p.deleteProperty(DIGEST_WAIT_KEY); return; }
    p.setProperty(DIGEST_WAIT_KEY, JSON.stringify({ n: n, at: Date.now() }));
  } catch (e) { /* the counter is a convenience; losing it costs one extra wait, not correctness */ }
}

/**
 * The sequencing itself: check the buckets, then send.
 *
 * Reads the sweep's stamp BEFORE reading the tracker, so a held posting costs one small range read rather
 * than a full sheet scan it is going to throw away.
 */
function digestWithFreshRei_() {
  if (!chatWebhookUrl_()) return { posted: false, count: 0 };

  var age = reiSweepAgeMinutes_();
  if (age !== null && age <= DIGEST_FRESH_MINUTES) {
    setDigestWaitCount_(0);
    return postAttentionDigest_();
  }

  var waited = digestWaitCount_();
  if (waited >= DIGEST_MAX_WAITS) {
    setDigestWaitCount_(0);
    /*
     * The waits are exhausted. Post a NOTICE, not the queue.
     *
     * This is the third answer to the same question, and the first two were both wrong.
     *
     * First it posted the queue with a small "may be out of date" note on the subtitle. The client saw that
     * fire for real — the morning after their PC died, so the last sweep was 17 hours old — and said: "as you
     * see this was 43 mins ago its not accurate and send." They are right. Six leads published with a warning
     * attached puts the reader in the worst position available: act on it, or ignore it, with no way to tell
     * which is correct. That is precisely how a colleague got blamed for outcomes they had already recorded.
     *
     * Then the temptation is silence. Also wrong, and for a reason that has not changed: a queue that simply
     * does not arrive reads as "nothing needs doing today", and the leads on it still need working.
     *
     * So neither. It publishes the ONE fact it can actually stand behind — REI has not been checked, since
     * when, and on which machine — and no lead data at all. Nobody can act on stale information they were
     * never shown, and nobody can mistake the silence for an empty queue.
     */
    /*
     * Say it once. The digest runs three times a day and each run reaches this line while REI stays unswept,
     * so without this the team gets three identical outage cards reporting the same unchanged timestamp.
     * The queue is still held either way — this decides whether to SAY so again, not whether to publish.
     */
    var key = heldNoticeKey_();
    var said = PropertiesService.getScriptProperties().getProperty(DIGEST_HELD_KEY);
    if (said === key) {
      logAuto_('CHAT', '', 'Work queue held back again — same outage already reported today'
        + (age === null ? '' : ' (last sweep ' + age + ' min ago)') + '. Not repeating the card.');
      return { posted: false, count: 0, held: true, repeat: true };
    }
    PropertiesService.getScriptProperties().setProperty(DIGEST_HELD_KEY, key);

    logAuto_('CHAT', '', 'Work queue HELD BACK — waited '
      + (DIGEST_MAX_WAITS * DIGEST_RETRY_MINUTES) + ' min and REI was never swept'
      + (age === null ? ' (no sweep has ever stamped the log).' : ' (last sweep ' + age + ' min ago).')
      + ' Posted the outage notice instead of the queue.');
    return postQueueHeldNotice_(age);
  }

  setDigestWaitCount_(waited + 1);
  clearDigestRetryTriggers_();
  try {
    ScriptApp.newTrigger(DIGEST_RETRY_HANDLER).timeBased()
      .after(DIGEST_RETRY_MINUTES * 60 * 1000).create();
  } catch (e) {
    /*
     * If the retry cannot be scheduled there is nothing left to wait FOR, so post now rather than lose the
     * posting entirely. A queue that vanishes because a trigger quota was full is the failure this whole
     * mechanism exists to avoid.
     */
    setDigestWaitCount_(0);
    logAuto_('CHAT', '', 'Could not schedule the REI re-check wait (' + e + ') — posting the work queue now.');
    return postAttentionDigest_();
  }

  logAuto_('CHAT', '', 'Work queue HELD — buckets not swept yet'
    + (age === null ? ' (no sweep stamp found)' : ' (last sweep ' + age + ' min ago)')
    + '. Checking again in ' + DIGEST_RETRY_MINUTES + ' min · wait '
    + (waited + 1) + ' of ' + DIGEST_MAX_WAITS + '.');
  return { posted: false, count: 0, held: true, waits: waited + 1, sweepAgeMinutes: age };
}

/**
 * What goes out INSTEAD of the queue when REI could not be checked.
 *
 * Deliberately carries no lead names, addresses, statuses or counts. The whole point is that the tracker
 * cannot be vouched for, so publishing anything out of it — even a number — invites somebody to act on it.
 *
 * It names the machine, read from the same Automation Settings tab the PC app claims, because "the
 * automation is not running" is not actionable and "DESKTOP-M4C8U38 has not swept since 4:59 PM" is.
 */
function postQueueHeldNotice_(age) {
  var since = '';
  try {
    var at = reiSweptAt_();
    if (at) since = Utilities.formatDate(at, Session.getScriptTimeZone(), 'h:mm a \'on\' EEE d MMM');
  } catch (e) { /* fall through to the vaguer wording */ }

  var who = '';
  try {
    /*
     * Guarded with typeof: this file is pasted into projects that may not carry AgentSettings.gs yet, and a
     * missing helper must not turn the outage notice — the one message that says nothing is working — into a
     * failure of its own.
     */
    if (typeof getAgentSetting_ === 'function' && typeof AGENT_SETTING_KEYS === 'object') {
      who = getAgentSetting_(AGENT_SETTING_KEYS.ACTIVE_MACHINE) || '';
    }
  } catch (e) { /* the notice is worth sending without it */ }

  var hours = age === null ? null : Math.round(age / 60);
  var howOld = age === null ? 'never' : (age < 90 ? age + ' minutes ago' : hours + ' hours ago');

  var body =
    '<b>The work queue is being held back.</b><br><br>'
    + 'REI has not been checked ' + (age === null ? '<b>at all</b>' : '<b>since ' + (since || howOld) + '</b>')
    + (who ? ' — the automation runs on <b>' + who + '</b>.' : '.')
    + '<br><br>'
    + 'So today\'s list is <b>not being published</b>: it would be built from a tracker nobody has verified, '
    + 'and a work queue you cannot trust is worse than none. <b>No lead has been left out — none has been '
    + 'shown.</b><br><br>'
    + '<b>What to check on that PC:</b><br>'
    + '• is it switched on and logged in to Windows?<br>'
    + '• is REI still signed in? — run <b>scripts\\login-rei.cmd</b><br>'
    + '• open <b>scripts\\dashboard.cmd</b> — it says which of these it is<br><br>'
    + 'The queue posts itself as soon as one sweep finishes. Nothing needs restarting.';

  var widgets = [{ textParagraph: { text: body } }];
  var url = dashboardUrl_();
  if (url) widgets.push({ buttonList: { buttons: [{ text: 'Open dashboard', onClick: { openLink: { url: url } } }] } });

  var err = chatPost_({ cardsV2: [{ cardId: 'queueHeld', card: {
    header: { title: '⚠️ Work queue held — REI not checked', subtitle: fmt_(today_()) + ' · nothing published' },
    sections: [{ widgets: widgets }]
  } }] });
  logAuto_('CHAT', '', err ? ('Outage notice FAILED: ' + err) : 'Outage notice posted instead of the work queue.');
  return { posted: !err, count: 0, held: true, stale: true, error: err };
}

/**
 * Post the work queue to Chat. Silent when there is nothing to do.
 *
 * Every line carries the four things a manager needs to act without opening anything: who the seller
 * is, which property, who owns it, and the exact reason it is on the list.
 */
function postAttentionDigest_() {
  if (!chatWebhookUrl_()) return { posted: false, count: 0 };
  var sh = dataSheet_();
  var last = sh.getLastRow();
  if (last < CFG.FIRST_DATA_ROW) return { posted: false, count: 0 };
  var idx = headerIndex_();
  var width = Math.max(sh.getLastColumn(), HEADERS.length);
  var vals = sh.getRange(CFG.FIRST_DATA_ROW, 1, last - CFG.FIRST_DATA_ROW + 1, width).getValues();
  var today = today_();

  var found = {};
  ATTENTION_BUCKETS.forEach(function (b) { found[b.key] = []; });

  vals.forEach(function (v) {
    var rec = {};
    HEADERS.forEach(function (h) { var c = idx[h]; rec[h] = c ? v[c - 1] : ''; });
    var owner = String(rec['Assigned Owner'] || '').trim();
    var line = function (reason) {
      return '<b>' + (rec['Seller Name'] || '(no name)') + '</b> · ' + shortAddress_(rec['Property Address']) +
        ' · Owner: ' + (owner || '<b>UNASSIGNED</b>') + ' · <i>' + clipReason_(reason) + '</i>';
    };

    /*
     * The real clock, so a visit that has already started today drops out of Upcoming Visit. Every other
     * caller omits it and keeps the old date-only behaviour — see attentionBucket_ for why that default
     * matters to the tests.
     */
    var hit = attentionBucket_(rec, today, new Date());
    if (hit) {
      found[hit.key].push({ text: line(hit.reason), attention: hit.attention ? 0 : 1, at: hit.sort });
    }

    // Additive, on purpose — see giftPending_. A lead can be listed once for its stage and once for
    // a gift it owes, because those are two different jobs for two different people.
    var gift = giftPending_(rec);
    if (gift) found.giftFollowUp.push({ text: line(gift), attention: 1, at: undefined });
  });

  /*
   * Order each section, then flatten to the lines that get posted.
   *
   * Two rules, in this order:
   *   1. anything needing a decision first — overdue, cancelled, reschedule needed, no date set
   *   2. then by the visit's own date, soonest first
   *
   * Cherry: "it should be prioritized, the upcoming visit by its date that near to visit". Before
   * this, the section came out in whatever order the rows sat in the sheet, so tomorrow's visit could
   * appear below one three weeks out. A line with no date sorts last within its group, and the
   * sections that carry no date at all keep their sheet order because Array.sort is stable.
   */
  ATTENTION_BUCKETS.forEach(function (b) {
    found[b.key] = found[b.key]
      .sort(function (x, y) {
        if (x.attention !== y.attention) return x.attention - y.attention;
        var a = x.at === undefined ? 0 : x.at, c = y.at === undefined ? 0 : y.at;
        return a - c;
      })
      .map(function (x) { return x.text; });
  });

  /*
   * Count leads and gifts SEPARATELY.
   *
   * The gift bucket is additive, so summing every bucket would report a lead twice and the headline
   * number would stop meaning "leads that need something" — which is the only reason the headline is
   * there. Stage buckets are mutually exclusive, so their sum is a true lead count.
   */
  var gifts = found.giftFollowUp.length;
  var leads = ATTENTION_BUCKETS.reduce(function (n, b) {
    return n + (b.key === 'giftFollowUp' ? 0 : found[b.key].length);
  }, 0);
  var total = leads + gifts;
  if (!total) {
    logAuto_('CHAT', '', 'Attention digest skipped — nothing needs attention.');
    return { posted: false, count: 0 };
  }

  var widgets = [];
  ATTENTION_BUCKETS.forEach(function (b, i) {
    var arr = found[b.key];
    if (!arr.length) return;
    widgets.push({ textParagraph: { text:
      b.icon + ' <b>' + (i + 1) + '. ' + b.title + ' (' + arr.length + ')</b><br>' +
      '<i>' + b.action + '</i><br>' +
      arr.slice(0, DIGEST_LINES_PER_SECTION).join('<br>') +
      (arr.length > DIGEST_LINES_PER_SECTION
        ? ('<br>…and ' + (arr.length - DIGEST_LINES_PER_SECTION) + ' more')
        : '')
    } });
    widgets.push({ divider: {} });
  });

  var url = dashboardUrl_();
  if (url) widgets.push({ buttonList: { buttons: [{ text: 'Open dashboard to update', onClick: { openLink: { url: url } } }] } });

  var top = ATTENTION_BUCKETS.filter(function (b) { return found[b.key].length; })[0];
  var err = chatPost_({ cardsV2: [{ cardId: 'attention', card: {
    header: {
      title: 'Work queue — ' + leads + ' lead(s)' + (gifts ? ' · ' + gifts + ' gift(s) to action' : ''),
      subtitle: fmt_(today_()) + ' · start with ' + top.title + ' (' + found[top.key].length + ')'
        + reiFreshness_()
    },
    sections: [{ widgets: widgets }]
  } }] });
  logAuto_('CHAT', '', err ? ('Attention digest FAILED: ' + err) : ('Attention digest posted · ' + total + ' lead(s).'));
  return { posted: !err, count: total, error: err };
}

/** Menu: post the attention digest now. */
/*
 * Calls postAttentionDigest_ directly, NOT the waiting path. A person who has just clicked "post now" is
 * asking for what the sheet holds this second; standing them down for half an hour waiting on a sweep would
 * read as a broken menu item. The toast says how fresh REI is instead, which is the same information in the
 * form somebody standing at the screen can act on — they can run the sweep by hand and click again.
 */
function sendAttentionDigestNow() {
  if (!chatWebhookUrl_()) { SpreadsheetApp.getUi().alert('Save a Google Chat webhook first.'); return; }
  var r = postAttentionDigest_();
  var age = reiSweepAgeMinutes_();
  var fresh = age === null ? ' (REI freshness unknown)'
    : age <= DIGEST_FRESH_MINUTES ? '' : ' (REI last swept ' + age + ' min ago)';
  SpreadsheetApp.getActive().toast(
    r.error ? ('Failed: ' + r.error)
      : (r.count ? ('Posted ' + r.count + ' item(s) needing attention.' + fresh)
        : 'Nothing overdue, stalled or flagged — nothing posted.'),
    'Google Chat', 10);
}

/** Menu: post the attention digest daily at 3pm. */
/*
 * Two posts a day, at the client's request: "we will update start from shift before lunch and then few
 * hours before we go home the notif."
 *
 * 9am, 11am and 4pm — the client's shift, in their own words: "we start shift 8 am california time, so
 * before you notif the gc in 9 check the all bucket, and then before lunch 12 in 11 should be cheked again,
 * and then our shift end 5, before 5 its already checked so 4pm will notf."
 *
 * 9 sets the day up while everything is still movable. 11 catches what the morning changed, before lunch
 * splits the team. 4 lands with an hour left, so the wording there asks what HAPPENED rather than what is
 * coming — at 4 o'clock a visit booked for the afternoon has either gone ahead or not.
 *
 * It was 11 and 3. The 3pm slot was too late to act on a morning visit and too early to know the outcome of
 * an afternoon one, which is the worst of both.
 *
 * Apps Script fires a daily trigger somewhere inside the named HOUR, not on the minute, so the sweep is
 * scheduled 15 minutes before each one and the card prints when REI was actually last read.
 *
 * Change DIGEST_HOURS to move them. Hours are in the SPREADSHEET'S timezone (File > Settings), not the
 * reader's, so a team spread across timezones sees one schedule rather than each their own.
 *
 * Apps Script fires a daily trigger somewhere inside the named hour rather than on the minute. So the
 * message arrives between 11:00 and 12:00, not at 11:00 exactly, and that cannot be tightened from here.
 */
var DIGEST_HOURS = [9, 11, 16];

function installChatAttentionTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendAttentionDigestToChat') ScriptApp.deleteTrigger(t);
  });
  clearDigestRetryTriggers_();          // a wait left over from a previous install is not this one's
  setDigestWaitCount_(0);
  DIGEST_HOURS.forEach(function (h) {
    ScriptApp.newTrigger('sendAttentionDigestToChat').timeBased().everyDays(1).atHour(h).create();
  });
  var when = DIGEST_HOURS.map(function (h) {
    return (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? 'am' : 'pm');
  }).join(' and ');
  SpreadsheetApp.getActive().toast('Attention digest ON — posts daily in the ' + when + ' hours.',
    'Google Chat', 8);
}

function removeChatAttentionTrigger() {
  var n = 0;
  /*
   * BOTH handlers. A pending retry is a posting that has not happened yet, so leaving one behind means
   * "OFF" is followed by one more card ten minutes later — exactly the kind of thing that makes an off
   * switch untrustworthy, and this project has already learned that lesson once over the scheduled tasks.
   */
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'sendAttentionDigestToChat' || h === DIGEST_RETRY_HANDLER) { ScriptApp.deleteTrigger(t); n++; }
  });
  setDigestWaitCount_(0);
  SpreadsheetApp.getActive().toast('Attention digest OFF (' + n + ' trigger removed).', 'Google Chat', 6);
}

/* ==================== ImportLegacy.gs ==================== */
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

/**
 * Mirrors the sheet's Normalized Address formula, so dedupe compares like with like.
 * The country suffix goes first, while the comma is still there to anchor it: REI writes
 * ", UNITED STATES" on every address and the old workbook never did, so without this the same
 * property reads as two different ones.
 */
function importNormAddr_(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/,\s*(united states|usa|us)\s*$/i, '')
    .replace(/,/g, '')
    .replace(/\./g, '')
    .replace(/#/g, '')
    // "Apt 115" / "#206" / "Unit 206" / "Ste 4" are the same place written four ways.
    .replace(/ (apt|apartment|unit|ste|suite) /g, ' ')
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

/* ==================== ImportFromOldWorkbook.gs ==================== */
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

/**
 * Report records that look like the same property twice — by address, or by phone number.
 *
 * Read-only. It deletes nothing and merges nothing: which of a pair to keep is a judgement call
 * (the REI-created row usually has the current appointment; the imported row usually has the
 * richer history), so it lists them and lets a human decide.
 */
function findDuplicateRecords() {
  var ui = SpreadsheetApp.getUi();
  var sh = dataSheet_();
  if (!sh) { ui.alert('Run "Build structure (setup)" first.'); return; }

  var lastRow = sh.getLastRow();
  if (lastRow < CFG.FIRST_DATA_ROW) { ui.alert('No data rows.'); return; }

  var block = sh.getRange(CFG.FIRST_DATA_ROW, 1, lastRow - CFG.FIRST_DATA_ROW + 1, HEADERS.length).getValues();
  var at = function (header) { return col(header) - 1; };

  var byAddress = {}, byPhone = {};
  var pairs = [];

  for (var i = 0; i < block.length; i++) {
    var row = block[i];
    var rowNum = CFG.FIRST_DATA_ROW + i;
    var address = String(row[at('Property Address')] || '');
    if (!address) continue;

    var label = 'row ' + rowNum + '  ' + (row[at('Property ID')] || '?') + '  ' +
                (row[at('Seller Name')] || '(no name)') + '  ' + address;

    var addrKey = importNormAddr_(address);
    if (addrKey) {
      if (byAddress[addrKey]) pairs.push(['same address', byAddress[addrKey], label]);
      else byAddress[addrKey] = label;
    }

    // Last 10 digits, so +1 / formatting differences do not hide a match.
    var digits = String(row[at('Phone')] || '').replace(/\D/g, '');
    if (digits.length >= 10) {
      var phoneKey = digits.slice(-10);
      if (byPhone[phoneKey] && byPhone[phoneKey] !== label) {
        pairs.push(['same phone', byPhone[phoneKey], label]);
      } else if (!byPhone[phoneKey]) {
        byPhone[phoneKey] = label;
      }
    }
  }

  // A pair caught by both rules is one problem, not two.
  var seen = {}, unique = [];
  pairs.forEach(function (p) {
    var key = p[1] + '||' + p[2];
    if (seen[key]) return;
    seen[key] = true;
    unique.push(p);
  });

  if (!unique.length) {
    ui.alert('No duplicates found across ' + block.length + ' row(s).\n\n' +
             'Checked: normalised address (country suffix ignored) and phone number.');
    return;
  }

  var report = unique.slice(0, 25).map(function (p) {
    return '[' + p[0] + ']\n   ' + p[1] + '\n   ' + p[2];
  }).join('\n\n');

  ui.alert('Found ' + unique.length + ' possible duplicate pair(s):\n\n' + report +
    (unique.length > 25 ? '\n\n...and ' + (unique.length - 25) + ' more' : '') +
    '\n\nNothing was changed. Decide which row to keep — usually the one carrying the current ' +
    'appointment and REI link — then delete the other row from the sheet.');
  logAuto_('INFO', 'duplicates', 'Found ' + unique.length + ' possible duplicate pair(s).');
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

/* ==================== NotesAudit.gs ==================== */

/**
 * Read the tracker's OWN notes for visit outcomes — in Google's cloud, on a schedule.
 *
 * The client: "the should be start like the auto checker in calendar something." He is right, and the
 * distinction matters: the 3pm digest and the calendar sync run on GOOGLE'S servers, so they work whether
 * his PC is on, asleep or shut down. The REI re-check cannot join them — it needs a real browser to log
 * into REI, which Apps Script has no way to drive.
 *
 * But this job never touches REI. It reads the sheet and writes the sheet, nothing more. So it belongs
 * here, where it runs unattended and forever, rather than on a Windows timer that stops when the laptop
 * sleeps.
 *
 * What it finds, in the client's own words: "as you see in the dashboard its not the same in the rei that
 * already updated at all by my colleagues." The team records outcomes in notes. Lili's row said
 * "Cancelled the property visit" while the card read Visit Scheduled / OVERDUE; Todd's said "Appointment
 * canceled ... Pending reschedule". Nothing was reading them.
 *
 * The phrase rules here are a deliberate mirror of src/rei/cancel-signal.mjs. tests/notes-audit-parity.
 * test.mjs pins the two together so they cannot drift — the same approach address-normalization.test.mjs
 * uses for the three copies of the address key.
 */

/** Columns a colleague might type an outcome into. Visit Notes is where it belongs; the rest are real. */
var NOTE_COLUMNS = ['Visit Notes', 'Next Action', 'Seller Motivation', 'Last Contact Result'];

/*
 * Up to two words may sit between "cancelled" and the thing cancelled.
 *
 * Two, not unlimited. Jose's REI note read "cancelled booked appointment" and an adjacent-words rule
 * missed it for five days. But a paragraph containing both words fifteen apart — "we cancelled the mailer
 * campaign before her appointment" — must not match. The bound is the whole safety margin.
 *
 * "visit" and "walkthrough" count as well as "appointment": Lili's note contains no "appointment" at all.
 */
var NA_THING = '(?:appointment|visit|walk\\s?through|showing|meeting)';

function naCancelPatterns_() {
  return [
    new RegExp('cancel(?:l)?ed\\s+(?:\\S+\\s+){0,2}' + NA_THING, 'i'),
    new RegExp(NA_THING + '\\s+(?:\\S+\\s+){0,2}cancel(?:l)?ed', 'i'),
    new RegExp('cancel(?:l)?ation\\s+of\\s+(?:\\S+\\s+){0,2}' + NA_THING, 'i')
  ];
}

/*
 * Words that turn a statement into a possibility. Split by POSITION, because one list checked both ways
 * was wrong in both directions: "cancelled the visit, seller wants to rebook" is a real cancellation with
 * a modal trailing it, while "no show risk" needs the trailing check to be caught at all.
 */
var NA_HEDGE_MODAL = /\b(?:may|might|could|would|if|will|going to|wants? to|asked to|threatened to|hoping to|expect|expecting|in case|maybe|perhaps)\b/i;
var NA_HEDGE_QUALIFIER = /\b(?:risk|risks|potential|potentially|chance|possibility|possible|possibly|likely|unlikely|concern|concerned|worry|worried)\b/i;

/** A visit already moved to a new time is LIVE, not missing. Checked before any cancellation. */
var NA_ALREADY_MOVED = /(?:re-?scheduled|re-?booked|moved|pushed|shifted)\s+(?:to|for|until|till)\b/i;

/** Still wanted, just not then — Reschedule Needed rather than Canceled. */
function naReschedulePatterns_() {
  return [
    /pending\s+re-?schedul/i,
    /re-?schedul(?:e|ing)\s+(?:pending|needed|required)/i,
    /(?:needs?|need\s+to|to\s+be|will|wants?\s+to|hoping\s+to|asked\s+to)\s+(?:be\s+)?re-?schedul/i,
    /re-?book(?:ing)?\s+(?:pending|needed|required)/i,
    /(?:needs?|wants?\s+to|will)\s+(?:to\s+)?re-?book/i
  ];
}

var NA_NOSHOW = [
  /\bno[\s-]?show(?:ed)?\b/i,
  /\bdid\s?n[o']?t\s+show(?:\s+up)?\b/i,
  /\bnobody\s+(?:was\s+)?(?:home|there)\b/i,
  /\bno\s?one\s+(?:was\s+)?(?:home|there)\b/i
];

/*
 * A visit that DID happen — much tighter than the others.
 *
 * "visited" and "met" appear in notes written BEFORE a visit as readily as after ("visited the area last
 * week"), and marking a visit Completed moves the lead into the section Cherry reads as "decide: offer or
 * pass". So the visit itself must be named, in the past tense.
 */
function naDonePatterns_() {
  return [
    new RegExp(NA_THING + '\\s+(?:was\\s+|has\\s+been\\s+)?(?:completed|done|finished)', 'i'),
    new RegExp('(?:completed|finished)\\s+(?:the\\s+|his\\s+|her\\s+|their\\s+)?' + NA_THING, 'i'),
    new RegExp(NA_THING + '\\s+went\\s+(?:well|ahead|fine|great)', 'i')
  ];
}

/** Is this match hedged by the words immediately around it? */
function naHedged_(text, match) {
  var at = match.index || 0;
  var end = at + match[0].length;
  var before = text.slice(Math.max(0, at - 40), at);
  var after = text.slice(end, end + 24);
  return NA_HEDGE_MODAL.test(before) || NA_HEDGE_MODAL.test(match[0])
    || NA_HEDGE_QUALIFIER.test(before) || NA_HEDGE_QUALIFIER.test(after);
}

/**
 * What a free-text note says happened to the visit: { status, kind, phrase }.
 *
 * `status` is an exact value of the workbook's Visit Status dropdown, or '' for "the note says nothing".
 * A value outside that dropdown would fail the whole row write, not just its own cell.
 */
function visitOutcomeFromNotes_(notes) {
  var text = String(notes == null ? '' : notes).replace(/\s+/g, ' ');
  if (!text.replace(/\s/g, '')) return { status: '', kind: '', phrase: '' };

  // A visit moved to a new time is live. REI's appointment fields are the authority on when.
  if (NA_ALREADY_MOVED.test(text)) return { status: '', kind: 'already-moved', phrase: '' };

  var near = function (m) {
    var at = m.index || 0;
    return text.slice(Math.max(0, at - 50), Math.min(text.length, at + m[0].length + 50)).trim();
  };

  var cancels = naCancelPatterns_();
  for (var i = 0; i < cancels.length; i++) {
    var cm = text.match(cancels[i]);
    if (!cm || naHedged_(text, cm)) continue;
    var wantsAgain = naReschedulePatterns_().some(function (p) { return p.test(text); });
    return { status: wantsAgain ? 'Reschedule Needed' : 'Canceled',
      kind: wantsAgain ? 'reschedule' : 'canceled', phrase: near(cm) };
  }

  var groups = [[NA_NOSHOW, 'Canceled', 'no-show'], [naDonePatterns_(), 'Completed', 'completed']];
  for (var g = 0; g < groups.length; g++) {
    var pats = groups[g][0];
    for (var p = 0; p < pats.length; p++) {
      var m = text.match(pats[p]);
      if (m && !naHedged_(text, m)) return { status: groups[g][1], kind: groups[g][2], phrase: near(m) };
    }
  }
  return { status: '', kind: '', phrase: '' };
}

/**
 * Scan every row and correct a Visit Status its own notes contradict.
 *
 * Runs hourly from a time trigger — see installNotesAuditTrigger. Writes Visit Status ONLY onto a row that
 * currently reads 'Scheduled' or nothing: a status a person set is never overwritten, because a regex over
 * prose does not get to overrule a colleague. A contradicting note on a human-set status is logged for
 * somebody to look at instead.
 */
function auditVisitNotes(silent) {
  var sh = dataSheet_();
  var last = sh.getLastRow();
  if (last < CFG.FIRST_DATA_ROW) return;

  var headers = sh.getRange(CFG.HEADER_ROW, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var idx = {};
  headers.forEach(function (h, i) { if (h) idx[h] = i; });
  if (idx['Visit Status'] === undefined) return;

  var n = last - CFG.FIRST_DATA_ROW + 1;
  var vals = sh.getRange(CFG.FIRST_DATA_ROW, 1, n, sh.getLastColumn()).getValues();
  var present = NOTE_COLUMNS.filter(function (c) { return idx[c] !== undefined; });

  var changed = [];
  var conflicts = [];
  for (var r = 0; r < n; r++) {
    var row = vals[r];
    if (!String(row[idx['Property Address']] || '').trim()) continue;

    var notes = present.map(function (c) { return String(row[idx[c]] || '').trim(); })
      .filter(String).join(' · ');
    var found = visitOutcomeFromNotes_(notes);
    if (!found.status) continue;

    var current = String(row[idx['Visit Status']] || '').trim();
    if (current === found.status) continue;
    if (current && current !== 'Scheduled') {
      conflicts.push({ row: CFG.FIRST_DATA_ROW + r, seller: row[idx['Seller Name']], current: current, found: found });
      continue;
    }
    changed.push({ row: CFG.FIRST_DATA_ROW + r, seller: row[idx['Seller Name']], found: found, stage: String(row[idx['Current Stage']] || '').trim() });
  }

  for (var c = 0; c < changed.length; c++) {
    var ch = changed[c];
    sh.getRange(ch.row, idx['Visit Status'] + 1).setValue(ch.found.status);
    /*
     * A completed visit takes the same stage move the workbook makes when a person sets it by hand, and
     * ONLY from Visit Scheduled. A lead somebody has advanced past that is left where it is.
     */
    if (ch.found.status === 'Completed' && ch.stage === 'Visit Scheduled' && idx['Current Stage'] !== undefined) {
      sh.getRange(ch.row, idx['Current Stage'] + 1).setValue('Visit Completed — Needs Review');
    }
    // The sentence it acted on, so a status inferred from prose is never a mystery afterwards.
    logAuto_('INFO', '', 'Notes audit: row ' + ch.row + ' ' + (ch.seller || '(no name)') +
      ' — Visit Status set to ' + ch.found.status + ' (' + ch.found.kind + ') because: "' +
      String(ch.found.phrase).slice(0, 200) + '"');
  }
  for (var k = 0; k < conflicts.length; k++) {
    var cf = conflicts[k];
    logAuto_('EXCEPTION', '', 'Notes audit: row ' + cf.row + ' ' + (cf.seller || '(no name)') +
      ' — row says "' + cf.current + '" but its notes say "' + cf.found.status +
      '". Left for a person: the automation does not overrule a status somebody set.');
  }

  if (!silent) {
    var msg = changed.length
      ? changed.length + ' lead(s) corrected from their own notes.'
      : 'No lead’s notes contradict its status.';
    if (conflicts.length) msg += ' ' + conflicts.length + ' need a person — see the Automation Log.';
    SpreadsheetApp.getActive().toast(msg, 'Notes audit', 8);
  }
  return { changed: changed.length, conflicts: conflicts.length };
}

/** Menu: run it now and say what happened. */
function auditVisitNotesNow() { auditVisitNotes(false); }

/**
 * Turn it on. Hourly, in Google's cloud, so it runs whether the client's PC is on or not.
 *
 * Hourly rather than every few minutes: it reads the whole tab in one pass, but notes do not change minute
 * to minute, and this is the only job that can touch all 378 rows rather than the ~100 with a REI link.
 */
function installNotesAuditTrigger() {
  removeNotesAuditTrigger();
  ScriptApp.newTrigger('auditVisitNotesSilent').timeBased().everyHours(1).create();
  SpreadsheetApp.getActive().toast('Notes audit ON — hourly, runs in Google’s cloud.', 'Twin Visit Logger', 6);
}

function auditVisitNotesSilent() { auditVisitNotes(true); }

function removeNotesAuditTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'auditVisitNotesSilent') ScriptApp.deleteTrigger(t);
  });
}

/* ==================== AgentSettings.gs ==================== */
/**
 * Twin Visit Logger — the settings the PC-side app reads out of the workbook.
 *
 * WHY THIS EXISTS
 *
 * The client asked for the automation to be a real installable app: "can we make it into app? so it can
 * just tranfer on evry pc" and "once i installed the application in one pc all must go on like automatic
 * once intall the app."
 *
 * The obstacle was configuration. The PC side needs four things to work — which workbook, which tab, which
 * calendar, and the Google Chat webhook — and they lived in a hand-typed `.env` on one machine. Any "just
 * install it" story that ends with a non-developer typing a spreadsheet ID and pasting a webhook URL into
 * Notepad is not the thing that was asked for.
 *
 * The obvious fix — bake them into the installer — is the wrong one. The Chat webhook is a credential:
 * anyone holding it can post into the space as the automation. Baking it in makes the installer file itself
 * a credential, so a copy on a USB stick, a Drive folder or an email attachment is a leak. And a baked-in
 * value cannot be changed without rebuilding and reinstalling everywhere.
 *
 * So the settings live HERE, in the workbook, and the app reads them with the Google login it already has.
 * The installer carries exactly one value — the spreadsheet ID — which is not a secret at all: it is in the
 * URL of the sheet, and knowing it grants nothing without permission to open it.
 *
 * THE ONE THING TO UNDERSTAND ABOUT THIS TAB
 *
 * It holds the Chat webhook, which means anyone who can open the workbook can read it. That is the same
 * group who could already post in the space, so it is not a new exposure — but it IS a credential sitting
 * in a spreadsheet, so the tab is hidden and protected, and `publishAgentSettings` says so on screen rather
 * than leaving somebody to discover it.
 *
 * Script Properties stay the source of truth. This tab is a published copy, refreshed by a menu click, so
 * the two cannot drift silently: the tab records WHEN it was published, and the app says how old it is.
 */

var AGENT_SETTINGS_SHEET = 'Automation Settings';

/*
 * The keys the PC app reads. Kept as a list rather than written inline so the tab, the publisher and the
 * reader cannot disagree about spelling — a mismatch here would present as "the app cannot find the
 * webhook" with nothing on screen explaining why.
 */
var AGENT_SETTING_KEYS = {
  TRACKER_SHEET: 'Tracker Sheet',
  CALENDAR_NAME: 'Calendar Name',
  CALENDAR_ID: 'Calendar ID',
  CHAT_WEBHOOK: 'Chat Webhook URL',
  DASHBOARD_URL: 'Dashboard URL',
  PUBLISHED_AT: 'Published At',
  ACTIVE_MACHINE: 'Active Machine',
  ACTIVE_MACHINE_AT: 'Active Machine Since'
};

/**
 * Create or refresh the tab, then hide and protect it.
 *
 * Idempotent on purpose: this is a menu item somebody will click again whenever they change the webhook,
 * and it must be safe to click twice. Values are rewritten; the Active Machine rows are LEFT ALONE, because
 * those are written by the PC app and re-publishing settings is not a reason to unclaim a machine.
 */
function publishAgentSettings() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(AGENT_SETTINGS_SHEET);
  var existingMachine = getAgentSetting_(AGENT_SETTING_KEYS.ACTIVE_MACHINE);
  var existingSince = getAgentSetting_(AGENT_SETTING_KEYS.ACTIVE_MACHINE_AT);

  if (!sh) sh = ss.insertSheet(AGENT_SETTINGS_SHEET);
  sh.clear();

  var webhook = (typeof chatWebhookUrl_ === 'function') ? chatWebhookUrl_() : '';
  var dash = (typeof dashboardUrl_ === 'function') ? dashboardUrl_() : '';
  var K = AGENT_SETTING_KEYS;

  var rows = [
    ['Key', 'Value', 'What it is for'],
    [K.TRACKER_SHEET, CFG.DATA_SHEET, 'The tab the automation reads and writes.'],
    [K.CALENDAR_NAME, CFG.VISIT_CALENDAR_NAME || '', 'Calendar that gets the Property Visit events.'],
    [K.CALENDAR_ID, CFG.VISIT_CALENDAR_ID || '', 'Used only if the name above cannot be found.'],
    [K.CHAT_WEBHOOK, webhook, 'CREDENTIAL. Where the automation posts. Anyone with this can post as it.'],
    [K.DASHBOARD_URL, dash, 'The /exec link the Chat cards open.'],
    [K.PUBLISHED_AT, new Date().toISOString(), 'When this tab was last refreshed from Script Properties.'],
    [K.ACTIVE_MACHINE, existingMachine, 'The ONE PC allowed to run the automation. Written by the app.'],
    [K.ACTIVE_MACHINE_AT, existingSince, 'When that PC claimed it.']
  ];

  sh.getRange(1, 1, rows.length, 3).setValues(rows);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold');
  sh.setColumnWidth(1, 190).setColumnWidth(2, 420).setColumnWidth(3, 420);
  sh.setFrozenRows(1);

  /*
   * Hidden and protected, in that order.
   *
   * Hiding is for the everyday case — nobody scrolling the tab strip needs to see a webhook. Protecting is
   * for the one that actually costs something: a stray edit to Tracker Sheet or Active Machine stops the
   * automation, and it would present as "it just stopped working" with no error anywhere. The owner can
   * still edit; the protection only keeps it from happening by accident.
   */
  try {
    var prot = sh.protect().setDescription('Written by the automation. Editing this stops the PC app.');
    prot.removeEditors(prot.getEditors());
    if (prot.canDomainEdit()) prot.setDomainEdit(false);
  } catch (e) { /* a Workspace policy may forbid protection; the tab is still correct */ }
  try { sh.hideSheet(); } catch (e) { /* cannot hide the only visible sheet — harmless */ }

  var ui = SpreadsheetApp.getUi();
  ui.alert('Settings published',
    'The "' + AGENT_SETTINGS_SHEET + '" tab now holds what the PC app needs.\n\n'
    + (webhook ? '' : 'WARNING: no Chat webhook is saved yet, so the app will install without alerts.\n'
        + 'Set one first: 💬 Set Google Chat webhook, then publish again.\n\n')
    + 'The tab is hidden and protected. It contains the Chat webhook, which is a credential — anyone\n'
    + 'who can open this workbook can read it. That is the same people who can already post in the\n'
    + 'space, so nothing new is exposed, but do not paste this tab into an email or a screenshot.\n\n'
    + 'Re-run this whenever you change the webhook or the calendar.',
    ui.ButtonSet.OK);
}

/** One value from the tab, or '' — never throws, so a missing tab reads as "not published yet". */
function getAgentSetting_(key) {
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(AGENT_SETTINGS_SHEET);
    if (!sh) return '';
    var last = sh.getLastRow();
    if (last < 2) return '';
    var vals = sh.getRange(2, 1, last - 1, 2).getValues();
    for (var i = 0; i < vals.length; i++) {
      if (String(vals[i][0]).trim() === String(key).trim()) return String(vals[i][1] == null ? '' : vals[i][1]);
    }
    return '';
  } catch (e) {
    return '';
  }
}

/**
 * Which PC is allowed to run the automation, and a menu item to release it.
 *
 * The client wants the app installed on every PC — "so it can just tranfer on evry pc". Two machines
 * driving REI on one account is what logs REI out, so "installed everywhere" has to mean "ready
 * everywhere, running on one". The PC app claims this row and every scheduled job checks it.
 *
 * Releasing it from here matters for the case the whole idea is FOR: the active PC is broken and cannot
 * release its own claim. Someone opens the sheet, clicks this, and the next machine can take over.
 */
function releaseActiveMachine() {
  var ui = SpreadsheetApp.getUi();
  var who = getAgentSetting_(AGENT_SETTING_KEYS.ACTIVE_MACHINE);
  if (!who) { ui.alert('No PC is claimed — the next one to run the app will take it.'); return; }
  var answer = ui.alert('Release "' + who + '"?',
    'The automation is currently claimed by "' + who + '". Releasing it lets another PC take over.\n\n'
    + 'Only do this if that PC is off, broken, or you have finished with it. If it is still running,\n'
    + 'BOTH machines will drive REI and REI will log you out.',
    ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;
  setAgentSetting_(AGENT_SETTING_KEYS.ACTIVE_MACHINE, '');
  setAgentSetting_(AGENT_SETTING_KEYS.ACTIVE_MACHINE_AT, '');
  SpreadsheetApp.getActive().toast('Released. The next PC to run the app will claim it.', 'Automation', 8);
}

/** Write one value back into the tab. Used by releaseActiveMachine and, over the API, by the PC app. */
function setAgentSetting_(key, value) {
  var sh = SpreadsheetApp.getActive().getSheetByName(AGENT_SETTINGS_SHEET);
  if (!sh) return false;
  var last = sh.getLastRow();
  for (var r = 2; r <= last; r++) {
    if (String(sh.getRange(r, 1).getValue()).trim() === String(key).trim()) {
      sh.getRange(r, 2).setValue(value);
      return true;
    }
  }
  sh.appendRow([key, value, '']);
  return true;
}

/** Menu: show which PC is running things, without unhiding the tab. */
function showActiveMachine() {
  var who = getAgentSetting_(AGENT_SETTING_KEYS.ACTIVE_MACHINE);
  var since = getAgentSetting_(AGENT_SETTING_KEYS.ACTIVE_MACHINE_AT);
  SpreadsheetApp.getUi().alert('Automation host',
    who ? ('Running on: ' + who + (since ? '\nSince: ' + since : ''))
      : 'No PC has claimed the automation yet.\n\nInstall the app on one and it will claim itself.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}
