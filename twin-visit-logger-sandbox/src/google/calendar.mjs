import crypto from 'node:crypto';
import { google } from 'googleapis';
import { DateTime } from 'luxon';
import { config } from '../config.mjs';

const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const clip = (value, maxLength) => {
  const text = String(value || '');
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}\n[Truncated]`;
};

function linkHash(link) {
  return crypto.createHash('sha256').update(link || '').digest('hex').slice(0, 20);
}

function isCancelled(status) {
  return normalize(status).toLowerCase().includes('cancel');
}

function buildDescription(visit) {
  return [
    `Seller: ${visit.sellerName || 'Not found'}`,
    `Phone: ${visit.phone || 'Not found'}`,
    `Email: ${visit.email || 'Not found'}`,
    `Property: ${visit.propertyAddress || 'Not found'}`,
    `Assigned Owner: ${visit.assignedOwner || 'Not found'}`,
    `Current Stage: ${isCancelled(visit.taskStatus) ? 'Cancelled' : 'Visit Scheduled'}`,
    `Task Status: ${visit.taskStatus || 'Not found'}`,
    `Contact Stage: ${visit.contactStage || 'Not found'}`,
    `Lead Source: ${visit.leadSource || 'Not found'}`,
    '',
    'Notes:',
    clip(visit.notes || 'No notes found.', 2500),
    '',
    'Latest Activity:',
    clip(visit.latestActivity || 'No activity found.', 2000),
    '',
    `Next Action: ${visit.nextAction || 'Not found'}`,
    `REI BlackBook: ${visit.reiLink}`
  ].join('\n').slice(0, 7800);
}

/**
 * Resolve the target calendar.
 *
 * CALENDAR_NAME is preferred: it is matched against the summaries in the account's calendar list, so
 * a calendar shared with this account ("Juan's Official Calendar") is found without anyone pasting a
 * calendar ID, and it keeps working if that ID ever changes. Falls back to CALENDAR_ID.
 *
 * Fails loudly rather than silently writing to the wrong calendar: if the name is configured but not
 * found (or is not writable), throw, so the run reports it instead of dropping events on `primary`.
 */
let cachedCalendarId;
async function resolveCalendarId(calendar) {
  if (cachedCalendarId) return cachedCalendarId;
  const wanted = String(config.calendarName || '').trim();
  if (!wanted) {
    cachedCalendarId = config.calendarId;
    return cachedCalendarId;
  }
  const res = await calendar.calendarList.list({ maxResults: 250 });
  const items = res.data.items || [];
  const match = items.find((c) => String(c.summary || '').trim().toLowerCase() === wanted.toLowerCase());
  if (!match) {
    const names = items.map((c) => c.summary).filter(Boolean).join(', ');
    throw new Error(`Calendar named "${wanted}" was not found for this account. Visible calendars: ${names}`);
  }
  if (match.accessRole !== 'owner' && match.accessRole !== 'writer') {
    throw new Error(`Calendar "${wanted}" is ${match.accessRole}: events cannot be created. ` +
      'Ask the owner for "Make changes to events" access.');
  }
  cachedCalendarId = match.id;
  return cachedCalendarId;
}

async function findEventByPrivateProperty(calendar, visit, calendarId) {
  const properties = [];
  if (visit.reiRecordId) properties.push(`reiRecordId=${visit.reiRecordId}`);
  if (visit.reiLink) properties.push(`reiLinkHash=${linkHash(visit.reiLink)}`);

  for (const property of properties) {
    const response = await calendar.events.list({
      calendarId,
      privateExtendedProperty: [property],
      showDeleted: false,
      maxResults: 10,
      singleEvents: true
    });
    const event = response.data.items?.[0];
    if (event?.id) return event.id;
  }
  return '';
}

async function eventExists(calendar, eventId, calendarId) {
  if (!eventId) return false;
  try {
    await calendar.events.get({ calendarId, eventId });
    return true;
  } catch (error) {
    if ([404, 410].includes(error.code) || [404, 410].includes(error.response?.status)) return false;
    throw error;
  }
}

export async function syncCalendarEvent(auth, visit, existingEventId = '') {
  const calendar = google.calendar({ version: 'v3', auth });
  const calendarId = await resolveCalendarId(calendar);
  let eventId = existingEventId;
  if (!(await eventExists(calendar, eventId, calendarId))) {
    eventId = await findEventByPrivateProperty(calendar, visit, calendarId);
  }

  if (isCancelled(visit.taskStatus)) {
    if (eventId) {
      await calendar.events.delete({ calendarId, eventId });
    }
    return '';
  }

  const start = DateTime.fromISO(visit.appointmentStartIso || '', { zone: config.calendarTimezone });
  if (!start.isValid) throw new Error('Calendar event was not created because appointmentStartIso is invalid.');
  const end = start.plus({ minutes: config.defaultVisitDurationMinutes });

  const privateProperties = { reiLinkHash: linkHash(visit.reiLink) };
  if (visit.reiRecordId) privateProperties.reiRecordId = String(visit.reiRecordId);
  if (visit.gmailMessageId) privateProperties.gmailMessageId = String(visit.gmailMessageId);

  const event = {
    summary: clip(`Property Visit | ${visit.sellerName || 'Seller'} | ${visit.propertyAddress || 'Address pending'}`, 500),
    location: visit.propertyAddress || '',
    description: buildDescription(visit),
    start: { dateTime: start.toISO(), timeZone: config.calendarTimezone },
    end: { dateTime: end.toISO(), timeZone: config.calendarTimezone },
    extendedProperties: { private: privateProperties }
  };

  if (eventId) {
    const response = await calendar.events.update({
      calendarId,
      eventId,
      sendUpdates: 'none',
      requestBody: event
    });
    return response.data.id || eventId;
  }

  const response = await calendar.events.insert({
    calendarId,
    sendUpdates: 'none',
    requestBody: event
  });
  return response.data.id || '';
}
