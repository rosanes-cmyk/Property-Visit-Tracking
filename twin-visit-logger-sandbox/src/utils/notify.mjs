/**
 * Tell the team what the automation did, in Google Chat.
 *
 * Once this runs on a timer nobody opens a terminal, and a log file nobody reads is the same as no
 * log at all. Silence has to mean "nothing was booked" — not "it broke four hours ago". So the runs
 * announce themselves: a visit logged, a group created, a task closed, or a failure with the reason.
 *
 * Rules this follows, and why:
 *
 *   - It NEVER throws. A notification that fails must not fail the run that succeeded. Every error
 *     is swallowed and reported to the console only.
 *   - It only speaks when something HAPPENED. A run every two minutes that says "nothing to do"
 *     trains everyone to mute the space, which costs more than it gives.
 *   - No phone numbers and no seller email. Name, address and time are what the team's own Chat
 *     digest already carries; contact details are a step further and are not needed to know a
 *     booking landed.
 *   - Without CHAT_WEBHOOK_URL set it is a silent no-op, so nothing here can break an existing setup.
 *
 * config is imported LAZILY, inside the function. Importing it at the top would drag dotenv and the
 * whole validated .env in just to load this file, which makes scrubContactDetails — the part most
 * worth testing, since it is the last thing between seller contact details and a group chat —
 * untestable without a full environment.
 */

/**
 * Strip anything that reads like a phone number or an email out of a notification.
 *
 * The phone rule matches a loose run of digits and separators and then COUNTS the digits, redacting
 * only at nine or more. Judging by shape alone got this wrong twice in both directions: a leading
 * bracket in "(707) 481-7040" fell outside the match and was left dangling in the output, and
 * "2026-08-04" — eight digits and a separator — looked exactly like a phone number and was redacted
 * out of a message whose whole purpose was to say when the visit is.
 */
export function scrubContactDetails(text) {
  return String(text || '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\+?\(?\d[\d\s().+-]{5,}\d/g, (candidate) => {
      const digits = candidate.replace(/\D/g, '').length;
      return digits >= 9 ? '[phone]' : candidate;
    });
}

/**
 * Post one line to Google Chat. Returns true if it went, false otherwise — never throws.
 *
 * `kind` is only used to prefix the message so the space is skimmable: a failure should be
 * distinguishable from a success at a glance, without reading the sentence.
 */
export async function notifyChat(text, { kind = 'info', webhookUrl = null } = {}) {
  const url = webhookUrl !== null
    ? webhookUrl
    : (await import('../config.mjs')).config.chatWebhookUrl;
  if (!url) return false;

  const prefix = { ok: '✅', warn: '⚠️', error: '❌', info: 'ℹ️' }[kind] || 'ℹ️';
  const body = { text: `${prefix} ${scrubContactDetails(text)}` };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      console.error(`Chat notification refused: ${response.status} ${response.statusText}`);
      return false;
    }
    return true;
  } catch (error) {
    // Deliberately not rethrown. See the header: the run matters, the announcement does not.
    console.error(`Chat notification failed: ${error.message}`);
    return false;
  }
}
