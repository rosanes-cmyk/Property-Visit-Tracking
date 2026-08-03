import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const int = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const raw = {
  googleCredentialsPath: process.env.GOOGLE_CREDENTIALS_PATH || './credentials/credentials.json',
  googleTokenPath: process.env.GOOGLE_TOKEN_PATH || './credentials/token.json',
  gmailQuery:
    process.env.GMAIL_QUERY ||
    'newer_than:2d ("Booked appointment" OR "Rescheduled appointment" OR "Cancelled appointment" OR "Canceled appointment") -label:THB-VisitLogger-Processed -label:THB-VisitLogger-Error',
  gmailProcessedLabel: process.env.GMAIL_PROCESSED_LABEL || 'THB-VisitLogger-Processed',
  gmailErrorLabel: process.env.GMAIL_ERROR_LABEL || 'THB-VisitLogger-Error',
  reiUrlPattern: process.env.REI_URL_PATTERN || 'reiblackbook',
  maxEmailsPerRun: int(process.env.MAX_EMAILS_PER_RUN, 10),
  spreadsheetId: process.env.SPREADSHEET_ID || '',
  trackerSheet: process.env.TRACKER_SHEET || 'Visit Tracker DEV',
  trackerHeaderRow: int(process.env.TRACKER_HEADER_ROW, 1),
  addMissingColumns: bool(process.env.ADD_MISSING_COLUMNS, true),
  calendarId: process.env.CALENDAR_ID || 'primary',
  // Preferred: match a calendar by NAME from this account's calendar list (works for calendars
  // shared with you, and survives an ID change). Blank falls back to CALENDAR_ID.
  calendarName: process.env.CALENDAR_NAME || '',
  calendarTimezone: process.env.CALENDAR_TIMEZONE || 'America/Los_Angeles',
  defaultVisitDurationMinutes: int(process.env.DEFAULT_VISIT_DURATION_MINUTES, 60),
  reiUserDataDir: process.env.REI_USER_DATA_DIR || './browser-data/rei-sandbox',
  reiLoginUrl: process.env.REI_LOGIN_URL || 'https://my.reiblackbook.com/',
  reiHeadless: bool(process.env.REI_HEADLESS, false),
  reiPageTimeoutMs: int(process.env.REI_PAGE_TIMEOUT_MS, 45000),
  reiSelectorConfig: process.env.REI_SELECTOR_CONFIG || './config/rei-selectors.json',
  pollIntervalMinutes: int(process.env.POLL_INTERVAL_MINUTES, 5),
  strictValidation: bool(process.env.STRICT_VALIDATION, true),
  dryRun: bool(process.env.DRY_RUN, false),
  debugCapture: bool(process.env.DEBUG_CAPTURE, true),
  logLevel: process.env.LOG_LEVEL || 'info',
  // ---- WhatsApp group automation (src/whatsapp) ----
  // Separate browser profile from REI: different site, different login, and a WhatsApp ban must
  // never take the REI session with it.
  whatsappUserDataDir: process.env.WHATSAPP_USER_DATA_DIR || './browser-data/whatsapp',
  whatsappSelectorConfig: process.env.WHATSAPP_SELECTOR_CONFIG || './config/whatsapp-selectors.json',
  whatsappTeamNumbers: String(process.env.WHATSAPP_TEAM_NUMBERS || '')
    .split(',').map((n) => n.trim()).filter(Boolean),
  // The number this browser profile is logged in as. WhatsApp rejects a group that tries to add its
  // own owner, so it is excluded from every participant list.
  whatsappOwnNumber: process.env.WHATSAPP_OWN_NUMBER || '',
  whatsappIncludeSeller: bool(process.env.WHATSAPP_INCLUDE_SELLER, false),
  whatsappGroupTemplate: process.env.WHATSAPP_GROUP_TEMPLATE || '{fullAddress}',
  whatsappLookaheadDays: int(process.env.WHATSAPP_LOOKAHEAD_DAYS, 30),
  // The ONE write this project makes to REI: marking a booked-appointment task complete once the
  // visit is confirmed on the calendar and in a WhatsApp group. Off unless explicitly enabled.
  // Everything else about REI stays read-only.
  reiCompleteTasks: bool(process.env.REI_COMPLETE_TASKS, false),
  // Country code for a bare 10-digit number that carries none of its own. '1' is right for the
  // US sellers read from REI. A number that already has a country code is used as-is, and one
  // starting with a 0 (a local trunk prefix) is refused rather than guessed at.
  phoneDefaultCountry: (process.env.PHONE_DEFAULT_COUNTRY || '1').replace(/\D/g, '') || '1'
};

const schema = z.object({
  googleCredentialsPath: z.string().min(1),
  googleTokenPath: z.string().min(1),
  gmailQuery: z.string().min(1),
  gmailProcessedLabel: z.string().min(1),
  gmailErrorLabel: z.string().min(1),
  reiUrlPattern: z.string().min(1),
  maxEmailsPerRun: z.number().int().positive().max(100),
  spreadsheetId: z.string().min(1, 'SPREADSHEET_ID is required'),
  trackerSheet: z.string().min(1),
  trackerHeaderRow: z.number().int().positive(),
  addMissingColumns: z.boolean(),
  calendarId: z.string().min(1),
  calendarName: z.string(),
  calendarTimezone: z.string().min(1),
  defaultVisitDurationMinutes: z.number().int().positive().max(1440),
  reiUserDataDir: z.string().min(1),
  reiLoginUrl: z.string().url(),
  reiHeadless: z.boolean(),
  reiPageTimeoutMs: z.number().int().positive(),
  reiSelectorConfig: z.string().min(1),
  pollIntervalMinutes: z.number().int().positive().max(1440),
  strictValidation: z.boolean(),
  dryRun: z.boolean(),
  debugCapture: z.boolean(),
  logLevel: z.string().min(1),
  whatsappUserDataDir: z.string().min(1),
  whatsappSelectorConfig: z.string().min(1),
  whatsappTeamNumbers: z.array(z.string()),
  whatsappOwnNumber: z.string(),
  whatsappIncludeSeller: z.boolean(),
  whatsappGroupTemplate: z.string().min(1),
  whatsappLookaheadDays: z.number().int().positive().max(365),
  reiCompleteTasks: z.boolean(),
  phoneDefaultCountry: z.string().min(1)
});

export const config = schema.parse({
  ...raw,
  googleCredentialsPath: path.resolve(raw.googleCredentialsPath),
  googleTokenPath: path.resolve(raw.googleTokenPath),
  reiUserDataDir: path.resolve(raw.reiUserDataDir),
  reiSelectorConfig: path.resolve(raw.reiSelectorConfig),
  whatsappUserDataDir: path.resolve(raw.whatsappUserDataDir),
  whatsappSelectorConfig: path.resolve(raw.whatsappSelectorConfig)
});
