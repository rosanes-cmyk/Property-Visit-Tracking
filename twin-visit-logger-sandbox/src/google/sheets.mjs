import { google } from 'googleapis';
import { DateTime } from 'luxon';
import { config } from '../config.mjs';

// Fields the automation may write. Everything else in the tracker stays human-owned.
export const CANONICAL_HEADERS = [
  'Seller Name',
  'Phone',
  'Email',
  'Property Address',
  'Visit Date',
  'Visit Time',
  'Visit Status',
  'Current Stage',
  'Assigned Owner',
  'REI BlackBook Link',
  'Lead Source',
  'Next Action',
  'Next Action Due Date',
  'Last Contact Result',
  'Calendar Event ID',
  'REI Record ID',
  'Gmail Message ID'
];

/**
 * EXACT column names only — no fuzzy matching.
 *
 * Fuzzy aliases were writing scraped text into unrelated columns of the operational tracker
 * (e.g. task text landing in "Property Condition", a name in "Blocker", a status in
 * "Final Disposition"). Every canonical field now maps to one exact header; if that header does
 * not exist in the sheet, the field is simply not written. Human-owned columns (Visit Notes,
 * Property Condition, Seller Motivation, Blocker, Final Disposition, offer/gift fields) are
 * deliberately absent so automation can never overwrite them.
 */
const HEADER_ALIASES = {
  'Seller Name': ['Seller Name'],
  Phone: ['Phone'],
  Email: ['Email'],
  'Property Address': ['Property Address'],
  'Visit Date': ['Visit Date'],
  'Visit Time': ['Visit Time'],
  'Visit Status': ['Visit Status'],
  'Current Stage': ['Current Stage'],
  'Assigned Owner': ['Assigned Visitor'],
  'REI BlackBook Link': ['REI BlackBook Link'],
  'Lead Source': ['Lead Source'],
  'Next Action': ['Next Action'],
  'Next Action Due Date': ['Next Action Due Date'],
  'Last Contact Result': ['Last Contact Result'],
  'Calendar Event ID': ['Calendar Event ID'],
  'REI Record ID': ['REI Record ID'],
  'Gmail Message ID': ['Gmail Message ID']
};

const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Address comparison key. Must stay identical to importNormAddr_ in the Apps Script and to the
 * sheet's Normalized Address formula — tests/address-normalization.test.mjs pins all three.
 *
 * The country suffix is stripped first, while the comma is still there to anchor it. REI writes
 * ", UNITED STATES" on every address and the legacy workbook never did, so without this the same
 * property reads as two different ones and the upsert appends a duplicate row instead of updating.
 */
export const normalizeAddress = (value) => String(value || '')
  .toLowerCase()
  .replace(/,\s*(united states|usa|us)\s*$/i, '')
  .replace(/,/g, '')
  .replace(/\./g, '')
  .replace(/#/g, '')
  // "Apt 115" / "#206" / "Unit 206" / "Ste 4" are the same place written four ways.
  .replace(/ (apt|apartment|unit|ste|suite) /g, ' ')
  .replace(/\s+/g, ' ')
  .trim();


function clipCell(value, maxLength = 45000) {
  const text = String(value || '');
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}
[Truncated by automation]`;
}

function safeSheetValue(value) {
  if (typeof value !== 'string') return value;
  return /^[=+@-]/.test(value) ? `'${value}` : value;
}

function quoteSheetName(sheetName) {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

function columnLetter(indexZeroBased) {
  let number = indexZeroBased + 1;
  let result = '';
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

async function getHeaders(sheets) {
  const range = `${quoteSheetName(config.trackerSheet)}!${config.trackerHeaderRow}:${config.trackerHeaderRow}`;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range
  });
  return response.data.values?.[0] || [];
}

function buildHeaderMap(headers) {
  const normalizedHeaders = headers.map(normalize);
  const map = new Map();
  for (const canonical of CANONICAL_HEADERS) {
    const aliases = HEADER_ALIASES[canonical] || [canonical];
    const foundIndex = normalizedHeaders.findIndex((header) => aliases.map(normalize).includes(header));
    if (foundIndex >= 0) map.set(canonical, foundIndex);
  }
  return map;
}

export async function ensureTrackerHeaders(auth) {
  const sheets = google.sheets({ version: 'v4', auth });
  let headers = await getHeaders(sheets);

  if (headers.length === 0) {
    headers = [...CANONICAL_HEADERS];
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.spreadsheetId,
      range: `${quoteSheetName(config.trackerSheet)}!A${config.trackerHeaderRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] }
    });
    return { headers, headerMap: buildHeaderMap(headers) };
  }

  if (config.addMissingColumns) {
    const map = buildHeaderMap(headers);
    const missing = CANONICAL_HEADERS.filter((header) => !map.has(header));
    if (missing.length) {
      const startColumn = columnLetter(headers.length);
      await sheets.spreadsheets.values.update({
        spreadsheetId: config.spreadsheetId,
        range: `${quoteSheetName(config.trackerSheet)}!${startColumn}${config.trackerHeaderRow}`,
        valueInputOption: 'RAW',
        requestBody: { values: [missing] }
      });
      headers = [...headers, ...missing];
    }
  }

  return { headers, headerMap: buildHeaderMap(headers) };
}

export async function findExistingVisit(auth, visit) {
  const sheets = google.sheets({ version: 'v4', auth });
  const { headers, headerMap } = await ensureTrackerHeaders(auth);
  const startRow = config.trackerHeaderRow + 1;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `${quoteSheetName(config.trackerSheet)}!A${startRow}:${columnLetter(Math.max(headers.length - 1, 0))}`
  });
  const rows = response.data.values || [];

  const indexFor = (header) => headerMap.get(header);
  const get = (row, header) => {
    const index = indexFor(header);
    return index === undefined ? '' : String(row[index] || '');
  };

  const targetMessageId = normalize(visit.gmailMessageId);
  const targetId = normalize(visit.reiRecordId);
  const targetLink = normalize(visit.reiLink);
  const targetAddress = normalizeAddress(visit.propertyAddress);
  const targetPhone = normalize(visit.phone).replace(/\D/g, '');

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const sameMessage = targetMessageId && normalize(get(row, 'Gmail Message ID')) === targetMessageId;
    const sameId = targetId && normalize(get(row, 'REI Record ID')) === targetId;
    const sameLink = targetLink && normalize(get(row, 'REI BlackBook Link')) === targetLink;
    const sameAddress = targetAddress && normalizeAddress(get(row, 'Property Address')) === targetAddress;
    const rowPhone = get(row, 'Phone').replace(/\D/g, '');
    const samePhone = targetPhone && rowPhone && rowPhone === targetPhone;

    if (sameMessage || sameId || sameLink || (sameAddress && (!targetPhone || samePhone))) {
      return {
        found: true,
        rowNumber: startRow + index,
        row,
        headers,
        headerMap,
        calendarEventId: get(row, 'Calendar Event ID'),
        matchedOn: sameMessage ? 'Gmail Message ID'
          : sameId ? 'REI Record ID'
            : sameLink ? 'REI BlackBook Link' : 'Property Address',
        scannedRows: rows.length
      };
    }
  }

  /*
   * Say what was searched for and whether the columns it needs even exist.
   *
   * A duplicate row was appended for a lead already in the sheet, and "no existing row" told us nothing
   * about why: a missing header, an empty column, and a genuinely new lead all look identical from outside.
   * These fields make the difference visible at the point of the decision.
   */
  return {
    found: false,
    rowNumber: null,
    row: [],
    headers,
    headerMap,
    calendarEventId: '',
    matchedOn: '',
    scannedRows: rows.length,
    searchedFor: {
      reiRecordId: targetId || '(none on the record)',
      reiLink: targetLink || '(none on the record)',
      normalizedAddress: targetAddress || '(none on the record)',
      phoneDigits: targetPhone || '(none on the record)'
    },
    columnsPresent: {
      'REI Record ID': indexFor('REI Record ID') !== undefined,
      'REI BlackBook Link': indexFor('REI BlackBook Link') !== undefined,
      'Property Address': indexFor('Property Address') !== undefined,
      Phone: indexFor('Phone') !== undefined
    }
  };
}

function visitToRecord(visit) {
  const start = visit.appointmentStartIso
    ? DateTime.fromISO(visit.appointmentStartIso).setZone(config.calendarTimezone)
    : null;
  const taskStatus = normalize(visit.taskStatus);
  const cancelled = taskStatus.includes('cancel');
  const automationError = visit.automationError || '';
  const warnings = Array.isArray(visit.warnings) ? visit.warnings.filter(Boolean) : [];

  /*
   * A record only counts as Scheduled when it is actually actionable: a valid appointment start, a
   * property address to visit, and no processing error. Marking a row Scheduled on a valid date
   * alone was wrong — a failed REI lookup produced an address-less "Scheduled" row that the
   * dashboard could not display, so the failure was invisible.
   */
  const hasValidStart = Boolean(start?.isValid);
  const actionable = hasValidStart && Boolean(visit.propertyAddress) && !automationError;
  /*
   * Only ever write values the tracker's own dropdowns allow:
   *   Visit Status  -> Scheduled | Completed | Canceled | Reschedule Needed
   *   Current Stage -> Visit Scheduled | Visit Completed - Needs Review | Offer Preparation | ...
   * This previously wrote 'Cancelled' (double L) and 'Needs Review', neither of which is a legal
   * value, so those rows matched no dashboard section and vanished from the board.
   *
   * A record that is not actionable writes NEITHER field. Leaving Current Stage blank lets the
   * sheet's own Missing Required Fields formula flag it, which routes it to Exceptions Requiring
   * Review. Blank values are skipped on update, so a stage a human already advanced is never
   * clobbered by automation.
   */
  const status = cancelled ? 'Canceled' : actionable ? 'Scheduled' : '';
  const stage = cancelled ? '' : actionable ? 'Visit Scheduled' : '';

  // One-line provenance note (never the raw scraped page text, which is unreadable in a cell).
  const noteParts = ['Auto-logged from REI task email'];
  if (visit.leadSource) noteParts.push(`source: ${visit.leadSource}`);
  if (visit.contactStage) noteParts.push(`REI stage: ${visit.contactStage}`);
  if (automationError) noteParts.push(`ERROR: ${automationError}`);
  else if (warnings.length) noteParts.push(`check: ${warnings.join('; ')}`);

  return {
    'Gmail Message ID': visit.gmailMessageId || '',
    'REI Record ID': visit.reiRecordId || '',
    'Seller Name': visit.sellerName || '',
    Phone: visit.phone || '',
    Email: visit.email || '',
    'Property Address': visit.propertyAddress || '',
    'Visit Date': hasValidStart ? start.toFormat('MM/dd/yyyy') : '',
    'Visit Time': hasValidStart ? start.toFormat('h:mm a') : '',
    'Visit Status': status,
    'Current Stage': stage,
    'Assigned Owner': visit.assignedOwner || '',
    'REI BlackBook Link': visit.reiLink || '',
    'Lead Source': visit.leadSource || '',
    'Next Action': cancelled ? '' : 'Conduct scheduled visit & log outcome',
    'Next Action Due Date': hasValidStart ? start.toFormat('MM/dd/yyyy') : '',
    'Last Contact Result': clipCell(noteParts.join(' · '), 500),
    'Calendar Event ID': visit.calendarEventId || ''
  };
}

/**
 * Stages that mean a person has already advanced this record past initial scheduling.
 *
 * The scraper re-syncs a booking on every matching email, writing Visit Status='Scheduled' and
 * Current Stage='Visit Scheduled'. Without a guard, a reschedule or duplicate notification would
 * silently undo a human's "Mark visit completed" (or an offer/contract stage) and drag the card back
 * into Upcoming Visits. Automation therefore never overwrites those two fields once the record has
 * progressed. A CANCELLATION is still allowed through: that is new information the team needs.
 */
const HUMAN_ADVANCED_STAGES = new Set([
  'Visit Completed — Needs Review',
  'Offer Preparation',
  'Offer Sent',
  'Active Negotiation',
  'Verbal Agreement',
  'Contract Sent',
  'Contract Signed',
  'Long-Term Nurture',
  'Lost / Closed Out'
]);

const ALLOW_EMPTY_UPDATE_HEADERS = new Set([
  'Calendar Event ID',
  'Automation Error'
]);

let cachedSheetId;

async function getSheetId(sheets) {
  if (cachedSheetId !== undefined) return cachedSheetId;
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: config.spreadsheetId,
    fields: 'sheets(properties(sheetId,title))'
  });
  const found = (meta.data.sheets || []).find((s) => s.properties?.title === config.trackerSheet);
  cachedSheetId = found?.properties?.sheetId ?? null;
  return cachedSheetId;
}

/**
 * Give the date and time cells a real date/time number format.
 *
 * USER_ENTERED writes turn "08/01/2026" and "2:00 PM" into proper date/time VALUES, but a cell with
 * no date format renders that value as its underlying serial number - which is why the tracker showed
 * "46235" and "0.5833333" instead of the date and time. Applying the format makes the stored value
 * display correctly without changing it.
 */
async function applyDateTimeFormats(sheets, rowNumber, headerMap) {
  if (!rowNumber) return;
  const sheetId = await getSheetId(sheets);
  if (sheetId === null) return;

  const targets = [
    { header: 'Visit Date', pattern: 'mm/dd/yyyy' },
    { header: 'Next Action Due Date', pattern: 'mm/dd/yyyy' },
    { header: 'Visit Time', pattern: 'h:mm am/pm' }
  ];

  const requests = [];
  for (const { header, pattern } of targets) {
    const index = headerMap.get(header);
    if (index === undefined) continue;
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: rowNumber - 1,
          endRowIndex: rowNumber,
          startColumnIndex: index,
          endColumnIndex: index + 1
        },
        cell: { userEnteredFormat: { numberFormat: { type: pattern.includes('h:mm') ? 'TIME' : 'DATE', pattern } } },
        fields: 'userEnteredFormat.numberFormat'
      }
    });
  }
  if (!requests.length) return;

  await sheets.spreadsheets
    .batchUpdate({ spreadsheetId: config.spreadsheetId, requestBody: { requests } })
    .catch(() => {});   // Formatting is cosmetic: never fail a sync over it.
}

/**
 * Refuse to write when the row could never be found again.
 *
 * Four rows for the same visit were appended before this existed — 381, 382, 383, 384 — because the tab has
 * no column the matcher can use, so every run decided the lead was new. Appending without a way to match is
 * not a partial success, it is a duplicate factory, and rule 8 of this project is that duplicate rows are not
 * created. So it stops, and names the column to add.
 *
 * One of these three is enough. REI Record ID is the most reliable, but a link or an address will do.
 */
function assertMatchable(headerMap) {
  const usable = ['REI Record ID', 'REI BlackBook Link', 'Property Address']
    .filter((name) => headerMap.has(name));
  if (usable.length) return;

  throw new Error(
    `The "${config.trackerSheet}" tab has none of the columns needed to recognise a visit again:\n` +
    '  REI Record ID, REI BlackBook Link, Property Address\n\n' +
    'Nothing was written, on purpose. Without one of these, every run treats the same visit as new and\n' +
    'appends another row — which is how four rows for one visit got created.\n\n' +
    'Fix: add a column with one of those exact names to the tracker tab (spelling and capitals must match),\n' +
    'or set ADD_MISSING_COLUMNS=true in .env and re-run so they are added automatically.'
  );
}

export async function upsertVisit(auth, visit, existing = null) {
  const sheets = google.sheets({ version: 'v4', auth });
  const match = existing || (await findExistingVisit(auth, visit));
  assertMatchable(match.headerMap);
  const record = visitToRecord(visit);

  if (!match.found) {
    const row = Array(match.headers.length).fill('');
    for (const [header, value] of Object.entries(record)) {
      const index = match.headerMap.get(header);
      if (index !== undefined) row[index] = safeSheetValue(value);
    }
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: config.spreadsheetId,
      range: `${quoteSheetName(config.trackerSheet)}!A:${columnLetter(Math.max(match.headers.length - 1, 0))}`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] }
    });
    const updatedRange = response.data.updates?.updatedRange || '';
    const rowMatch = updatedRange.match(/!(?:[A-Z]+)(\d+):/);
    const newRowNumber = rowMatch ? Number(rowMatch[1]) : null;
    await applyDateTimeFormats(sheets, newRowNumber, match.headerMap);
    return { ...match, found: true, rowNumber: newRowNumber, appended: true };
  }

  // Do not walk a human's progress backwards (see HUMAN_ADVANCED_STAGES).
  const readExisting = (header) => {
    const i = match.headerMap.get(header);
    return i === undefined ? '' : String(match.row?.[i] || '').trim();
  };
  const existingStage = readExisting('Current Stage');
  const existingStatus = readExisting('Visit Status');
  const cancelling = normalize(visit.taskStatus).includes('cancel');
  const progressed = HUMAN_ADVANCED_STAGES.has(existingStage) || existingStatus === 'Completed';
  const protectedHeaders = progressed && !cancelling
    ? new Set(['Visit Status', 'Current Stage'])
    : new Set();
  if (protectedHeaders.size) {
    console.log(JSON.stringify({ level: 'info',
      message: 'Preserved human-set progress; Visit Status / Current Stage not overwritten.',
      details: { row: match.rowNumber, existingStage, existingStatus } }));
  }

  const data = [];
  for (const [header, value] of Object.entries(record)) {
    const index = match.headerMap.get(header);
    if (index === undefined) continue;
    if (protectedHeaders.has(header)) continue;
    if ((value === '' || value === null || value === undefined) && !ALLOW_EMPTY_UPDATE_HEADERS.has(header)) {
      continue;
    }
    data.push({
      range: `${quoteSheetName(config.trackerSheet)}!${columnLetter(index)}${match.rowNumber}`,
      values: [[safeSheetValue(value)]]
    });
  }

  if (data.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: config.spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data
      }
    });
  }

  await applyDateTimeFormats(sheets, match.rowNumber, match.headerMap);
  return { ...match, appended: false };
}
