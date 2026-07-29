import { google } from 'googleapis';
import { DateTime } from 'luxon';
import { config } from '../config.mjs';

export const CANONICAL_HEADERS = [
  'Gmail Message ID',
  'REI Record ID',
  'Seller Name',
  'Phone',
  'Email',
  'Property Address',
  'Visit Start',
  'Visit Date',
  'Visit Time',
  'Visit Status',
  'Current Stage',
  'Assigned Owner',
  'REI BlackBook Link',
  'Task Title',
  'Task Status',
  'Contact Stage',
  'Property Details',
  'Visit Notes',
  'Latest Activity',
  'Next Action',
  'Lead Source',
  'Calendar Event ID',
  'Last Updated',
  'Automation Status',
  'Automation Error'
];

const HEADER_ALIASES = {
  'Gmail Message ID': ['Gmail Message ID', 'Email Message ID', 'Message ID'],
  'REI Record ID': ['REI Record ID', 'REI ID', 'Contact ID'],
  'Seller Name': ['Seller Name', 'Contact Name', 'Name'],
  Phone: ['Phone', 'Phone Number', 'Mobile'],
  Email: ['Email', 'Email Address'],
  'Property Address': ['Property Address', 'Address'],
  'Visit Start': ['Visit Start', 'Appointment Start', 'Appointment Date Time'],
  'Visit Date': ['Visit Date', 'Appointment Date'],
  'Visit Time': ['Visit Time', 'Appointment Time'],
  'Visit Status': ['Visit Status', 'Appointment Status'],
  'Current Stage': ['Current Stage', 'Stage'],
  'Assigned Owner': ['Assigned Owner', 'Owner', 'Sales Agent', 'Assigned To'],
  'REI BlackBook Link': ['REI BlackBook Link', 'REI Link', 'Contact Link'],
  'Task Title': ['Task Title', 'REI Task Title'],
  'Task Status': ['Task Status', 'REI Task Status'],
  'Contact Stage': ['Contact Stage', 'Lead Stage'],
  'Property Details': ['Property Details', 'Property Information'],
  'Visit Notes': ['Visit Notes', 'Notes', 'Contact Notes'],
  'Latest Activity': ['Latest Activity', 'Activity', 'Timeline'],
  'Next Action': ['Next Action', 'Next Step'],
  'Lead Source': ['Lead Source', 'Source'],
  'Calendar Event ID': ['Calendar Event ID', 'Google Calendar Event ID', 'Event ID'],
  'Last Updated': ['Last Updated', 'Updated At'],
  'Automation Status': ['Automation Status', 'Sync Status'],
  'Automation Error': ['Automation Error', 'Sync Error', 'Error']
};

const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();


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
  const targetAddress = normalize(visit.propertyAddress);
  const targetPhone = normalize(visit.phone).replace(/\D/g, '');

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const sameMessage = targetMessageId && normalize(get(row, 'Gmail Message ID')) === targetMessageId;
    const sameId = targetId && normalize(get(row, 'REI Record ID')) === targetId;
    const sameLink = targetLink && normalize(get(row, 'REI BlackBook Link')) === targetLink;
    const sameAddress = targetAddress && normalize(get(row, 'Property Address')) === targetAddress;
    const rowPhone = get(row, 'Phone').replace(/\D/g, '');
    const samePhone = targetPhone && rowPhone && rowPhone === targetPhone;

    if (sameMessage || sameId || sameLink || (sameAddress && (!targetPhone || samePhone))) {
      return {
        found: true,
        rowNumber: startRow + index,
        row,
        headers,
        headerMap,
        calendarEventId: get(row, 'Calendar Event ID')
      };
    }
  }

  return {
    found: false,
    rowNumber: null,
    row: [],
    headers,
    headerMap,
    calendarEventId: ''
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

  const needsReview = Boolean(automationError);

  return {
    'Gmail Message ID': visit.gmailMessageId || '',
    'REI Record ID': visit.reiRecordId || '',
    'Seller Name': visit.sellerName || '',
    Phone: visit.phone || '',
    Email: visit.email || '',
    'Property Address': visit.propertyAddress || '',
    'Visit Start': start?.isValid ? start.toISO() : '',
    'Visit Date': start?.isValid ? start.toFormat('MM/dd/yyyy') : '',
    'Visit Time': start?.isValid ? start.toFormat('h:mm a') : '',
    'Visit Status': cancelled ? 'Cancelled' : needsReview ? 'Needs Review' : 'Scheduled',
    'Current Stage': cancelled ? 'Cancelled' : needsReview ? 'Needs Review' : 'Visit Scheduled',
    'Assigned Owner': visit.assignedOwner || '',
    'REI BlackBook Link': visit.reiLink || '',
    'Task Title': visit.taskTitle || '',
    'Task Status': visit.taskStatus || '',
    'Contact Stage': visit.contactStage || '',
    'Property Details': clipCell(visit.propertyDetails),
    'Visit Notes': clipCell(visit.notes),
    'Latest Activity': clipCell(visit.latestActivity),
    'Next Action': visit.nextAction || '',
    'Lead Source': visit.leadSource || '',
    'Calendar Event ID': visit.calendarEventId || '',
    'Last Updated': visit.scrapedAt || DateTime.now().setZone(config.calendarTimezone).toISO(),
    'Automation Status': automationError ? 'Error' : warnings.length ? 'Needs Review' : 'Synced',
    'Automation Error': automationError || warnings.join(' | ')
  };
}

const ALLOW_EMPTY_UPDATE_HEADERS = new Set([
  'Calendar Event ID',
  'Automation Error'
]);

export async function upsertVisit(auth, visit, existing = null) {
  const sheets = google.sheets({ version: 'v4', auth });
  const match = existing || (await findExistingVisit(auth, visit));
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
    return { ...match, found: true, rowNumber: rowMatch ? Number(rowMatch[1]) : null, appended: true };
  }

  const data = [];
  for (const [header, value] of Object.entries(record)) {
    const index = match.headerMap.get(header);
    if (index === undefined) continue;
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

  return { ...match, appended: false };
}
