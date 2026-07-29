import { DateTime } from 'luxon';
import { config } from '../config.mjs';

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

const MONTH = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';
// "Jul 30, 2026 2:00 PM" / "July 30 2:00 PM" / "7/30/2026 2:00 PM" embedded anywhere in a string.
const EMBEDDED_DATETIME = new RegExp(
  `(?:${MONTH})\\.?\\s+\\d{1,2}(?:,\\s*\\d{4})?\\s+\\d{1,2}:\\d{2}\\s*[AP]M` +
  `|\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?,?\\s+\\d{1,2}:\\d{2}\\s*[AP]M`,
  'i'
);

function parseDateTime(value) {
  // REI appends its own "Due: <weekday>, <date>" to the task-title line in the notification body,
  // so a title segment arrives as "Jul 30, 2026 2:00 PM Due: Thursday, July 30, 2026". Drop that
  // suffix and pull the date/time out of whatever remains rather than requiring an exact match.
  let text = normalize(value).replace(/\bDue:.*$/i, '').trim();
  if (!text) return '';
  const embedded = (text.match(EMBEDDED_DATETIME) || [])[0];
  if (embedded) text = embedded;
  const formats = [
    'MMMM d, yyyy h:mm a',
    'MMM d, yyyy h:mm a',
    'M/d/yyyy h:mm a',
    'MM/dd/yyyy h:mm a',
    'M/d/yy h:mm a',
    'yyyy-MM-dd h:mm a',
    "yyyy-MM-dd'T'HH:mm:ss",
    "yyyy-MM-dd'T'HH:mm",
    // Year-less variants (team titles like "Jul 28 10:00 AM"); Luxon fills in the current year.
    'MMMM d h:mm a',
    'MMM d h:mm a',
    'M/d h:mm a'
  ];
  for (const format of formats) {
    const parsed = DateTime.fromFormat(text, format, {
      zone: config.calendarTimezone,
      locale: 'en-US'
    });
    if (parsed.isValid) return parsed.toISO();
  }
  const iso = DateTime.fromISO(text, { zone: config.calendarTimezone });
  return iso.isValid ? iso.toISO() : '';
}

export function parseAppointmentTitle(subject) {
  const parts = String(subject || '')
    .split('|')
    .map(normalize)
    .filter(Boolean);

  const result = {
    rawTitle: normalize(subject),
    sellerName: '',
    propertyAddress: '',
    appointmentStartIso: '',
    assignedOwner: '',
    reiLink: '',
    warnings: []
  };

  if (parts.length === 0) return result;
  const first = parts[0].toLowerCase();
  if (!first.includes('booked appointment')) {
    result.warnings.push('Subject does not start with "Booked appointment".');
  }

  for (const part of parts.slice(1)) {
    if (/^https?:\/\//i.test(part) && part.toLowerCase().includes(config.reiUrlPattern.toLowerCase())) {
      result.reiLink = part;
      continue;
    }
    const parsedDate = parseDateTime(part);
    if (parsedDate && !result.appointmentStartIso) {
      result.appointmentStartIso = parsedDate;
      continue;
    }
  }

  const nonSpecial = parts.slice(1).filter((part) => {
    if (/^https?:\/\//i.test(part)) return false;
    if (parseDateTime(part)) return false;
    return true;
  });

  if (nonSpecial[0]) result.sellerName = nonSpecial[0];
  if (nonSpecial[1]) result.propertyAddress = nonSpecial[1];
  if (nonSpecial[2]) result.assignedOwner = nonSpecial[2];

  return result;
}
