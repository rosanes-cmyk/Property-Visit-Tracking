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
  NO_DECISION_BUSINESS_DAYS: 1,
  TASK_QUEUE_SHEET: 'Task Queue',   // visible internal task delivery (pilot)
  TEST_DATA_SHEET: 'Test Data',     // Source=TEST records live here, not on the live Board
  TRASH_SHEET: 'Trash',             // soft-deleted records (restorable from the dashboard)
  INTAKE_INBOX_SHEET: 'Intake Inbox', // Zapier writes appointments here; a 10-min trigger logs them (for Workspaces that block public web apps)
  // Shared secret for the external website's JSON API (set the SAME value in Vercel APPS_SCRIPT_TOKEN).
  // Leave '' to disable the API (HTML dashboard still works). Use a long random string.
  API_TOKEN: '',
  // ---- Lead intake automation (REI BlackBook webhook → doPost action:'intake') ----
  SANDBOX: true,                 // tags intake rows Source='Intake-Sandbox' (isolates test loads). Calendar is controlled separately below.
  VISIT_CALENDAR_ID: 'rosanes@twinhomebuyer.com',  // calendar that gets the "Property Visit" events. '' = off; 'default' = script owner's primary. (Using your own calendar for now instead of Juan's.)
  // Preferred target: resolved by calendar NAME at runtime, so no calendar ID has to be
  // pasted and it keeps working if the ID changes. Must be a calendar this account can
  // EDIT (view-only access cannot create events). Falls back to VISIT_CALENDAR_ID when blank.
  VISIT_CALENDAR_NAME: "Juan's Official Calendar",
  OFFICE_ORIGIN: '170 Glenn Way, San Carlos, CA 94070',   // drive-time origin for the "leave office by" reminder
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
  'Visit Status': ['Scheduled','Completed','Canceled','Reschedule Needed','Skipped — Offer Made'],
  'Current Stage': ['Visit Scheduled','Visit Completed — Needs Review','Offer Preparation','Offer Sent','Active Negotiation','Verbal Agreement','Contract Sent','Contract Signed','Long-Term Nurture','Lost / Closed Out'],
  // Both lists carry every real name found in the live workbook, so an import does not fail
  // validation. 'Juan Diaz' and 'Juan' are both present because the old sheet used both.
  'Assigned Owner': ['Jonathan','Kyle','Cherry','Juan','Arly','Matt','Darius','Danica','Team','Matt/Arly','Matt/Juan','Cherry/Matt'],
  'Assigned Visitor': ['Juan','Juan Diaz','Kyle','Cherry','Jonathan','Cesar','Jose Herrera','Manny Morales','Lily','Alan Hernandez'],
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
  'Source': ['Manual','Apps Script','Import','Intake','Intake-Sandbox','TEST'],
  // The company's own taxonomy, copied verbatim from the live workbook's
  // "Ref (Deals) - Tags definition" tab. Deal Stage is the four-way bucket; Deal Status is the
  // detail. These are what the team already uses in REI BlackBook — do not re-word them.
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
