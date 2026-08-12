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
  /*
   * WHATSAPP_SEED_ONLY=true: create the group with ONE member and send nothing.
   *
   * The client's decision, asked for repeatedly after the third ban: *"create a gc add 1 member ... then
   * my colleauge will add the all members"*, with the briefing going to Google Chat for a person to paste.
   * Google Chat is their own Workspace and automating it is permitted, so the only thing left touching
   * WhatsApp is opening it and making the group.
   *
   * It is genuinely less exposure than what ran before — one contact instead of four, and no message
   * sending, which is the most heavily detected action of the lot. It is NOT protection. Every ban so far
   * happened on an already-logged-in profile and the third created exactly one group; what Meta reads is
   * a program driving WhatsApp Web, not the guest list. My advice was and is to do this on a number the
   * business can afford to lose, and the client has heard it.
   *
   * Note posting is forced OFF whenever this is on. Leaving both switchable would let a later edit put
   * the sending back without anyone deciding to.
   */
  whatsappSeedOnly: bool(process.env.WHATSAPP_SEED_ONLY, false),
  /*
   * Drive the INSTALLED Chrome instead of Playwright's bundled Chromium.
   *
   * Added because WhatsApp Web served the automation a blank page and bounced it to
   * `?post_logout=1` with no QR at all, while the SAME number in an incognito window on the same PC
   * got a QR immediately. The client's read was that the automated window was behaving oddly rather
   * than the account being blocked, and they were right to push on it: Playwright's bundled Chromium
   * is not the same build as Chrome — it ships without the proprietary media codecs — and WhatsApp Web
   * is known to refuse builds it does not recognise.
   *
   * So this is worth testing, and it may well fix the blank page.
   *
   * It does NOT make automating WhatsApp safer. Read that twice. If it links successfully we are back
   * to exactly the risk that has already cost this project three numbers: what Meta objects to is a
   * program driving WhatsApp Web, and running it in a nicer browser does not change that. Off by
   * default for that reason.
   */
  whatsappUseSystemChrome: bool(process.env.WHATSAPP_USE_SYSTEM_CHROME, false),
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
   * An off switch for the per-lead Chat alerts, separate from the webhook itself.
   *
   * The client, watching the same false alert arrive twice: "but we need to turn off the auto alert." The
   * only way to stop them before this was to delete CHAT_WEBHOOK_URL — which is a credential, so it would
   * have to be found and pasted back to turn anything on again, and it would also silence the failure
   * notices that are the whole reason the automation is allowed to run unattended.
   *
   * CHAT_ALERTS=off stops the Node re-check posting about individual leads. It does NOT touch the 11am and
   * 3pm work queue: those are posted by Apps Script from its own Script Properties, so the digest survives
   * while the interruptions stop. That is the split the client asked for — "as long as its updating in the
   * dashboard its fine".
   */
  chatAlerts: (process.env.CHAT_ALERTS || 'on').trim().toLowerCase() !== 'off',
  /*
   * The full PROPERTY INSPECTION briefing in Google Chat. ON.
   *
   * It was OFF, and that was right at the time: WhatsApp carried the real briefing, the client saw a second
   * longer copy land in the alerts channel, and said "it should be in the whatsapp only, so we dont need
   * that in the alert gc, and should be only in the whatsapp if we enable again."
   *
   * WhatsApp is now gone — the number is restricted — so Chat is not a duplicate of anything; it is the ONLY
   * place the visitor gets this. The client's instruction: "it will send notif always in the gc about the
   * notes instead for whats app."
   *
   * The default is what changed, and deliberately. Leaving it off meant the one channel the team actually
   * has had to be switched on by hand in a config file — and the client's answer to being asked to do that
   * was the right one: "why would i type that, it should be automated." A default that has to be corrected
   * before the software does its job is a bug with a workaround, not a setting.
   *
   * CHAT_VISIT_BRIEFING=false still turns it off, for whenever WhatsApp is genuinely carrying it again.
   */
  chatVisitBriefing: bool(process.env.CHAT_VISIT_BRIEFING, true),
  /*
   * WHATSAPP_ENABLED=false stops the WhatsApp step dead, wherever it is called from.
   *
   * THREE numbers have now been banned or restricted running this: automating WhatsApp Web breaches Meta's
   * terms and they detect it. The last one went the same way as the others, on a run that had the warm-up
   * off, a 20-minute gap between sessions, a five-a-day cap and exactly one group created. There is no
   * throttle setting that makes this safe, because the problem is not the volume — it is the automation.
   *
   * So the default is OFF. It used to be ON for the sake of existing setups, which is no longer a good
   * enough reason: a disabled scheduled task is not an off switch, since anyone can run the command by
   * hand, and an unset variable must not be what puts a fourth number at risk.
   *
   * The briefing goes to Google Chat instead (chatWebhookUrl) — the client's own Workspace, permitted to
   * automate, and the part that carried the value. The group is created by hand, as the team did before.
   */
  whatsappEnabled: bool(process.env.WHATSAPP_ENABLED, false),

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
  whatsappSeedOnly: z.boolean(),
  whatsappUseSystemChrome: z.boolean(),
  phoneDefaultCountry: z.string().min(1),
  // Must be declared here: z.object().parse STRIPS keys the schema does not name, so a field added
  // to `raw` alone silently arrives as undefined.
  chatWebhookUrl: z.string(),
  chatAlerts: z.boolean(),
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
