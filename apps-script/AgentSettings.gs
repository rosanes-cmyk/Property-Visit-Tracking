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
