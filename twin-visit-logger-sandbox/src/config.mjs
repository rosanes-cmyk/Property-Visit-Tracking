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
  // Post the PROPERTY INSPECTION note into the group after creating it. ON by default, because a
  // group with no briefing in it is not what was asked for — the note IS the deliverable, the group is
  // just where it goes. Set WHATSAPP_POST_NOTE=false to create groups silently.
  // It still refuses outright if the note carries anything a seller must not read and a seller is in
  // the group, and it only ever types into a conversation whose header it has verified.
  whatsappPostNote: bool(process.env.WHATSAPP_POST_NOTE, true),
  // Country code for a bare 10-digit number that carries none of its own. '1' is right for the
  // US sellers read from REI. A number that already has a country code is used as-is, and one
  // starting with a 0 (a local trunk prefix) is refused rather than guessed at.
  phoneDefaultCountry: (process.env.PHONE_DEFAULT_COUNTRY || '1').replace(/\D/g, '') || '1',
  // Google Chat webhook the scheduled runs report to. Once this runs on a timer nobody opens a
  // terminal, so silence has to mean "nothing was booked" rather than "it broke hours ago".
  // Blank = no notifications, which is the old behaviour exactly. This is a credential: it lets
  // anyone holding it post into the space, so it belongs in .env and never in source.
  chatWebhookUrl: (process.env.CHAT_WEBHOOK_URL || '').trim(),
  /*
   * WHATSAPP_ENABLED=false stops the WhatsApp step dead, wherever it is called from.
   *
   * The number used for this was banned: automating WhatsApp Web breaches Meta's terms and they detect it. A
   * disabled scheduled task is not enough of an off switch — someone runs the command by hand and the account
   * is at risk again. This is the switch, and it defaults to ON only because existing setups rely on it.
   */
  whatsappEnabled: bool(process.env.WHATSAPP_ENABLED, true),

  /*
   * Three limits that exist only to reduce what WhatsApp sees. The client has chosen to run this on a number
   * after a previous one was banned, so the job now is to make the footprint as small as the work allows.
   *
   * skipWarmup: the wa.me warm-up navigates to WhatsApp Web once PER NUMBER and reloads the whole app each
   *   time. It is only needed because the group picker cannot find numbers that are neither saved contacts nor
   *   existing chats. SAVE THE TEAM NUMBERS AS CONTACTS on the phone and none of it is needed — that removes
   *   the single noisiest thing this does.
   * minMinutesBetween: the timer fires every 2 minutes. This is the real gap between sessions that open a
   *   browser, so a two-minute schedule cannot become forty WhatsApp sessions an hour.
   * maxGroupsPerDay: a cap. Bulk group creation is the behaviour most associated with bans, and a runaway loop
   *   would otherwise be indistinguishable from one.
   */
  whatsappSkipWarmup: bool(process.env.WHATSAPP_SKIP_WARMUP, false),
  whatsappMinMinutesBetween: int(process.env.WHATSAPP_MIN_MINUTES_BETWEEN, 20),
  whatsappMaxGroupsPerDay: int(process.env.WHATSAPP_MAX_GROUPS_PER_DAY, 5)
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
  whatsappPostNote: z.boolean(),
  phoneDefaultCountry: z.string().min(1),
  // Must be declared here: z.object().parse STRIPS keys the schema does not name, so a field added
  // to `raw` alone silently arrives as undefined.
  chatWebhookUrl: z.string(),
  whatsappEnabled: z.boolean(),
  whatsappSkipWarmup: z.boolean(),
  whatsappMinMinutesBetween: z.number().int().nonnegative().max(1440),
  whatsappMaxGroupsPerDay: z.number().int().positive().max(50)
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
