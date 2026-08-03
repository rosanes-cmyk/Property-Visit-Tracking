/**
 * Log WhatsApp Web into the sandbox browser profile, once.
 *
 *   node scripts/whatsapp-login.mjs
 *
 * A window opens showing the QR code. Scan it from the phone whose WhatsApp account should own the
 * groups. The session persists in browser-data/whatsapp, so this is a one-time step until WhatsApp
 * logs the session out.
 *
 * Use a number the business can afford to lose: automating WhatsApp Web is against WhatsApp's terms
 * and accounts do get banned for it.
 */
import { launchWhatsApp, WHATSAPP_URL } from '../src/whatsapp/client.mjs';
import { config } from '../src/config.mjs';

const context = await launchWhatsApp({
  userDataDir: config.whatsappUserDataDir,
  headless: false,
  timezone: config.calendarTimezone
});
const page = context.pages()[0] || (await context.newPage());
await page.goto(WHATSAPP_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});

console.log('WhatsApp Web is open.');
console.log('  1. On your phone: WhatsApp -> Settings -> Linked devices -> Link a device');
console.log('  2. Scan the QR code in the window.');
console.log('  3. Wait until your chats load, then press Enter here (or just close the window).');

await Promise.race([
  new Promise((resolve) => process.stdin.once('data', resolve)),
  context.waitForEvent('close').catch(() => {})
]);

// Check what was actually saved. Reporting "Saved." after the user pressed Enter on a QR screen is
// worse than reporting nothing: the next script then fails with a message about selectors, and the
// real cause — an empty session — is nowhere in sight.
let loggedIn = false;
try {
  loggedIn = await page.evaluate(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const qr = [...document.querySelectorAll('canvas')].filter(visible).length > 0;
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ');
    return !qr && !/link(ing)? (a )?device|scan the QR|Steps to log in/i.test(text);
  });
} catch { /* window already closed — fall through to the warning */ }

await context.close().catch(() => {});

if (loggedIn) {
  console.log('\nLogged in and saved.');
  console.log('Next: node scripts\\whatsapp-doctor.mjs   (checks the page selectors, clicks nothing)');
} else {
  console.log('\nWARNING: the QR screen was still showing, so nothing useful was saved.');
  console.log('Run this again, scan the code, and WAIT until your real chats appear in the window');
  console.log('before pressing Enter.');
}
process.exit(loggedIn ? 0 : 1);
