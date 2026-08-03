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

console.log('\n=== The URL SHAPE is repaired ===');
// Two forms of a Workspace web-app link exist and only one still works. Note where "macros" sits.
const CHATSRC = read('apps-script/ChatNotify.gs');
const nFrom = CHATSRC.indexOf('function normalizeExecUrl_');
const normalizeExecUrl_ = new Function(
  `${CHATSRC.slice(nFrom, CHATSRC.indexOf('\n}', nFrom) + 2)}\nreturn normalizeExecUrl_;`
)();

const LEGACY = 'https://script.google.com/a/twinhomebuyer.com/macros/s/AKfycbyYPg4z/exec';
const GOOD   = 'https://script.google.com/a/macros/twinhomebuyer.com/s/AKfycbyYPg4z/exec';
check('the legacy shape getUrl() returns is rewritten', normalizeExecUrl_(LEGACY), GOOD);
check('an already-correct link is left alone', normalizeExecUrl_(GOOD), GOOD);
check('rewriting is idempotent', normalizeExecUrl_(normalizeExecUrl_(LEGACY)), GOOD);
check('a non-domain (public) link is untouched',
  normalizeExecUrl_('https://script.google.com/macros/s/AKfycbPUBLIC/exec'),
  'https://script.google.com/macros/s/AKfycbPUBLIC/exec');
check('empty stays empty', normalizeExecUrl_(''), '');
check('a non-Apps-Script URL is untouched',
  normalizeExecUrl_('https://example.com/a/x/macros/s/y/exec'),
  'https://example.com/a/x/macros/s/y/exec');
check('the deployment id survives the rewrite intact',
  normalizeExecUrl_(LEGACY).includes('AKfycbyYPg4z'), true);
check('the domain survives the rewrite intact',
  normalizeExecUrl_(LEGACY).includes('twinhomebuyer.com'), true);

console.log('\n=== Every source of the link goes through the repair ===');
const dashFrom = CHATSRC.indexOf('function dashboardUrl_()');
const dashBody = CHATSRC.slice(dashFrom, CHATSRC.indexOf('\n}', dashFrom));
check('the stored property is normalized', /normalizeExecUrl_\(stored\)/.test(dashBody), true);
check('CFG is normalized', /normalizeExecUrl_\(CFG\.DASHBOARD_URL\)/.test(dashBody), true);
check('getUrl() is normalized — this is the one that was broken',
  /normalizeExecUrl_\(ScriptApp/.test(dashBody), true);

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
