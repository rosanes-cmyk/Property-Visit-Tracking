/**
 * The sheet's menu — every action reachable, and the everyday ones reachable without scrolling.
 *
 *   node tests/menu.test.mjs
 *
 * The client, hunting for the item that posts the work queue: "i cant see that."
 *
 * It was there. Item five of forty-five, in one flat list far taller than the screen, so reaching it meant
 * scrolling a menu most people do not realise scrolls — two screenshots came back from different parts of
 * the same list on the way to giving up. A control that exists but cannot be found has not been delivered.
 *
 * A menu cannot be clicked from here, so what is checked is what a regex honestly can: that every action
 * still points at a function that exists, that nothing was lost in the regrouping, that the handful of
 * daily actions sit at the top level, and that the four items which delete things do not.
 */
import fs from 'node:fs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

const src = fs.readFileSync('apps-script/Code.combined.gs', 'utf8');
const menu = src.slice(src.indexOf('function onOpen()'), src.indexOf('.addToUi();\n}') + 13);
check('the menu builder was found', menu.length > 0, true);

const action = /addItem\('([^']*)',\s*'([A-Za-z0-9_]+)'\)/g;
const items = [...menu.matchAll(action)].map((m) => ({ label: m[1], fn: m[2] }));
check('every menu item has a handler', items.length > 0, true);

/*
 * A menu item naming a function that does not exist fails only when somebody clicks it, with an Apps Script
 * error dialog and no clue which item was at fault. Cheap to check here, miserable to find there.
 */
const missing = items.filter((i) => !new RegExp(`function\\s+${i.fn}\\s*\\(`).test(src)).map((i) => i.fn);
check('every handler exists in the file', missing.join(', '), '');

/*
 * Nothing may be lost in a regrouping. This is the full set the flat menu offered before it was split; a
 * submenu that quietly drops an action is worse than the scrolling it was meant to fix.
 */
const BEFORE = `setup loadPilotData runAllTests installTriggers sendDailyReport setChatWebhook setDashboardUrl
sendVisitDigestNow notifyNewBookingsNow sendAttentionDigestNow installChatDigestTrigger
installChatNewBookingTrigger installChatAttentionTrigger removeChatDigestTrigger removeChatNewBookingTrigger
removeChatAttentionTrigger auditVisitNotesNow installNotesAuditTrigger removeNotesAuditTrigger
publishAgentSettings showActiveMachine releaseActiveMachine setupIntakeInbox checkIntakeInboxNow
installInboxTrigger removeInboxTrigger setupGmailIntake checkReiEmailsNow installGmailTrigger
removeGmailTrigger previewImportFromOldWorkbook importFromOldWorkbook importLegacyRows findDuplicateRecords
repairSheet repairStages removeTestData removeTestArtifacts clearAllData purgeOrphanCalendarEvents
removeAllTriggers`.split(/\s+/);
const have = new Set(items.map((i) => i.fn));
check('nothing the old menu offered was dropped', BEFORE.filter((f) => !have.has(f)).join(', '), '');

/*
 * The top level: everything before the first addSubMenu. These are the actions someone runs during a normal
 * day, and the whole point is that they are on screen when the menu opens.
 */
const top = menu.slice(0, menu.indexOf('.addSubMenu('));
const topFns = [...top.matchAll(action)].map((m) => m[2]);
console.log('\n=== the daily actions need no scrolling ===');
for (const fn of ['sendAttentionDigestNow', 'sendVisitDigestNow', 'notifyNewBookingsNow',
  'auditVisitNotesNow', 'checkReiEmailsNow', 'showActiveMachine']) {
  check(`${fn} is at the top level`, topFns.includes(fn), true);
}
/*
 * And the top level stays SHORT. Six plus a handful of submenus fits any screen; letting it grow back is
 * how it became forty-five in the first place, one reasonable-looking addition at a time.
 */
check('the top level is still short', topFns.length <= 8, true);

console.log('\n=== the destructive ones are not among them ===');
/*
 * Every one of these deletes something that cannot be typed back — rows, calendar events, or every trigger
 * in the project. They used to sit in the same flat run as "Check REI emails now", one slip of the mouse
 * apart. They belong behind a submenu that says what it is.
 */
const DESTRUCTIVE = ['removeTestData', 'removeTestArtifacts', 'clearAllData', 'removeAllTriggers'];
const danger = menu.slice(menu.indexOf('⚠️ Deletes data'));
for (const fn of DESTRUCTIVE) {
  check(`${fn} is NOT on the top level`, topFns.includes(fn), false);
  check(`...it is behind the warning submenu`, new RegExp(`'${fn}'`).test(danger), true);
}

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
