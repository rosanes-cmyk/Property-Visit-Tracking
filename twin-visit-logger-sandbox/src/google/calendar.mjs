import crypto from 'node:crypto';
import { google } from 'googleapis';
import { DateTime } from 'luxon';
import { config } from '../config.mjs';
import { extractLogistics, minutesBeforeStart } from '../whatsapp/propertyradar.mjs';
import { buildDescription, isCancelled } from './description.mjs';

// Re-exported so every existing importer of buildDescription keeps working unchanged.
export { buildDescription };

const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const clip = (value, maxLength) => {
  const text = String(value || '');
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}\n[Truncated]`;
};

function linkHash(link) {
  return crypto.createHash('sha256').update(link || '').digest('hex').slice(0, 20);
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

export const CANCEL_TAG = '[CANCELED] ';

/**
 * Mark an existing event cancelled in place: keep the date, prefix the title, kill every reminder,
 * stamp the description. Returns the event id, unchanged — the row keeps pointing at a real event.
 *
 * Reminders are the part that matters operationally. A cancelled visit that still pings an hour before
 * "leave the office" sends somebody on a ninety-minute drive to a house nobody is expecting them at.
 */
export async function tagEventCancelled(calendar, calendarId, eventId) {
  const existing = await calendar.events.get({ calendarId, eventId }).catch(() => null);
  if (!existing) return '';                        // already gone; nothing to keep
  const summary = String(existing.data.summary || '');
  // Idempotent: re-running a re-check must not produce "[CANCELED] [CANCELED] Property Visit | …".
  if (summary.startsWith(CANCEL_TAG)) return eventId;

  const stamp = DateTime.now().setZone(config.calendarTimezone).toFormat('MMM d, yyyy');
  await calendar.events.patch({
    calendarId,
    eventId,
    sendUpdates: 'none',                           // never notify a seller; see CLAUDE.md
    requestBody: {
      summary: clip(CANCEL_TAG + summary, 500),
      reminders: { useDefault: false, overrides: [] },
      description: `${existing.data.description || ''}\n\nCANCELED in REI on ${stamp} — kept for the record.`.trim()
    }
  });
  return eventId;
}

export async function syncCalendarEvent(auth, visit, existingEventId = '') {
  const calendar = google.calendar({ version: 'v3', auth });
  const calendarId = await resolveCalendarId(calendar);
  let eventId = existingEventId;
  if (!(await eventExists(calendar, eventId, calendarId))) {
    eventId = await findEventByPrivateProperty(calendar, visit, calendarId);
  }

  /*
   * A cancelled visit is TAGGED and KEPT, never deleted.
   *
   * This used to delete the event, and the client's ops lead reversed that rule directly: "if the status
   * of the calendar is cancelled it should not be removed in the calendar and this will notify as well."
   * She is right about why. A visit vanishing off Juan's day is indistinguishable from it never having
   * been booked, so nobody learns the seller cancelled and no record survives that the slot was held.
   *
   * The workbook side (markVisitEvents_ in WebApp.gs) was changed to tag months ago. This side was not,
   * so the timed REI re-check — the one path that discovers a cancellation with nobody watching — would
   * have quietly deleted the event and undone the behaviour she asked for. Both sides now do the same
   * thing, and deliberately produce the same '[CANCELED] ' prefix so one event cannot be tagged twice.
   */
  if (isCancelled(visit.taskStatus)) {
    if (!eventId) return '';
    return tagEventCancelled(calendar, calendarId, eventId);
  }

  const start = DateTime.fromISO(visit.appointmentStartIso || '', { zone: config.calendarTimezone });
  if (!start.isValid) throw new Error('Calendar event was not created because appointmentStartIso is invalid.');
  const end = start.plus({ minutes: config.defaultVisitDurationMinutes });

  const privateProperties = { reiLinkHash: linkHash(visit.reiLink) };
  if (visit.reiRecordId) privateProperties.reiRecordId = String(visit.reiRecordId);
  if (visit.gmailMessageId) privateProperties.gmailMessageId = String(visit.gmailMessageId);

  /*
   * A reminder at the time the visitor must LEAVE, not just before the visit.
   *
   * A default alert ten minutes before an appointment ninety minutes' drive away is useless. The notes
   * carry "Leave Office: 10:00 AM"; Calendar wants minutes-before-start, so that becomes 60 for an 11:00
   * visit and fires exactly when it is time to go.
   *
   * The time is resolved on the APPOINTMENT'S OWN DATE in the event's timezone — reading "10:00 AM" against
   * today would give a nonsense offset for a visit next week.
   */
  const trip = extractLogistics(visit.notes || '');
  const leaveMinutes = minutesBeforeStart(trip.leaveOffice, start.toMillis(), (text) => {
    const parsed = DateTime.fromFormat(String(text).trim().toUpperCase().replace(/\s+/g, ' '), 'h:mm a', {
      zone: config.calendarTimezone
    });
    if (!parsed.isValid) return 0;
    return start.set({ hour: parsed.hour, minute: parsed.minute, second: 0, millisecond: 0 }).toMillis();
  });

  const event = {
    summary: clip(`Property Visit | ${visit.sellerName || 'Seller'} | ${visit.propertyAddress || 'Address pending'}`, 500),
    location: visit.propertyAddress || '',
    /*
     * The appointment line is written from the event's OWN start, in the event's timezone, rather than
     * from anything in the notes. It is the one fact the calendar is authoritative about.
     */
    description: buildDescription(visit, {
      appointmentText: start.setZone(config.calendarTimezone).toFormat("cccc d LLLL yyyy, h:mm a")
    }),
    start: { dateTime: start.toISO(), timeZone: config.calendarTimezone },
    end: { dateTime: end.toISO(), timeZone: config.calendarTimezone },
    extendedProperties: { private: privateProperties }
  };

  if (leaveMinutes) {
    // Two alerts: one when it is time to leave, and one fifteen minutes before that to get ready.
    event.reminders = {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: leaveMinutes },
        ...(leaveMinutes + 15 <= 1440 ? [{ method: 'popup', minutes: leaveMinutes + 15 }] : [])
      ]
    };
  }

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
