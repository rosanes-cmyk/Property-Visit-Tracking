/**
 * The link on every Google Chat card.
 *
 *   node tests/chat-dashboard-link.test.mjs
 *
 * Cards used ScriptApp.getService().getUrl(), which returns the /dev URL. That URL only opens for
 * people who can EDIT the script, so every teammate who tapped "Open dashboard to update" got a
 * Google error page instead of the dashboard. A broken link on a card sent to the whole team twice a
 * day is worth a test.
 */
import fs from 'node:fs';
import path from 'node:path';

const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

for (const file of ['apps-script/ChatNotify.gs', 'apps-script/Code.combined.gs']) {
  const source = read(file);
  const from = source.indexOf('function dashboardUrl_()');
  const body = source.slice(from, source.indexOf('\n}', from));

  console.log(`\n=== ${file} ===`);
  check('dashboardUrl_ exists', from >= 0, true);
  check('the script property is checked first', body.indexOf('DASHBOARD_URL_PROP') < body.indexOf('CFG.DASHBOARD_URL'), true);
  check('CFG is checked before getUrl()', body.indexOf('CFG.DASHBOARD_URL') < body.indexOf('getUrl'), true);
  check('getUrl() is still there as a last resort', /getUrl/.test(body), true);
}

console.log('\n=== The configured default is a usable /exec link ===');
const CONFIG = read('apps-script/Config.gs');
const url = (CONFIG.match(/DASHBOARD_URL:\s*'([^']+)'/) || [])[1] || '';
check('a default is set', url.length > 0, true);
check('it is an Apps Script web app', url.startsWith('https://script.google.com/'), true);
check('it ends in /exec, NOT /dev', url.endsWith('/exec'), true);
check('it is not the /dev URL that caused the bug', /\/dev(\?|$)/.test(url), false);

console.log('\n=== The setter refuses the URL that caused the bug ===');
const SETTER = read('apps-script/ChatNotify.gs');
const setter = SETTER.slice(SETTER.indexOf('function setDashboardUrl()'));
check('a /dev link is rejected', /\\\/dev/.test(setter) || /\/dev/.test(setter), true);
check('a non-Apps-Script link is rejected', /script\\?\.google\\?\.com/.test(setter), true);
check('blank clears it rather than saving an empty link', /deleteProperty/.test(setter), true);

console.log('\n=== Both digests and the booking alert use the same helper ===');
const CHAT = read('apps-script/ChatNotify.gs');
check('every "Open dashboard" button gets its url from a variable, not a literal',
  (CHAT.match(/text: 'Open dashboard to update', onClick: \{ openLink: \{ url: url \} \}/g) || []).length >= 3, true);
check('no hard-coded script.google.com link is embedded in a card',
  /openLink: \{ url: 'https:\/\/script\.google\.com/.test(CHAT), false);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
