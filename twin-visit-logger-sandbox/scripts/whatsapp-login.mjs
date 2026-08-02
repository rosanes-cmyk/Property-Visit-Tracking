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

await context.close().catch(() => {});
console.log('Saved. Next: node src/whatsapp/watch.mjs   (dry run — creates nothing)');
process.exit(0);
