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
    /*
     * An ORDER reference is not a phone number, and redacting it destroys the only thing that lets somebody
     * find the order again.
     *
     * The client's Chat space, on the gift this fix was written for:
     *
     *   a GIFT is recorded in REI. Gift ordered in REI - $41.13 - order #[phone] - ordered 08/12/2026
     *
     * Home Depot's order id is 20871989699423792 — seventeen digits, comfortably past the nine-digit
     * threshold, so the rule that keeps sellers' numbers out of the space ate the reference instead. The
     * amount and both dates survived; the one field somebody would act on did not.
     *
     * Matched by its LABEL rather than by length. "17 digits is too long to be a phone number" is nearly
     * true and not quite — E.164 allows fifteen, and a number written with a country code and no separators
     * gets close enough that I would not want a seller's mobile riding on the difference. `order #` in front
     * of it is unambiguous.
     */
    .replace(/((?:\border\s*(?:#|no\.?|number|id)\s*:?\s*)?)(\+?\(?\d[\d\s().+-]{5,}\d)/gi,
      (whole, label, candidate) => {
        if (label) return whole;                       // an order reference — keep it intact
        const digits = candidate.replace(/\D/g, '').length;
        return digits >= 9 ? '[phone]' : whole;
      });
}

/**
 * Post one line to Google Chat. Returns true if it went, false otherwise — never throws.
 *
 * `kind` is only used to prefix the message so the space is skimmable: a failure should be
 * distinguishable from a success at a glance, without reading the sentence.
 */
export async function notifyChat(text, {
  kind = 'info', webhookUrl = null, keepContactDetails = false, critical = false
} = {}) {
  const cfg = webhookUrl !== null ? null : (await import('../config.mjs')).config;
  /*
   * CHAT_ALERTS=off silences these without touching the webhook.
   *
   * The client: "but we need to turn off the auto alert." Deleting CHAT_WEBHOOK_URL would have done it, but
   * that is a credential — it would have to be dug out and pasted back to turn anything on again. The 11am
   * and 3pm work queue is unaffected: Apps Script posts that from its own Script Properties, so the digest
   * keeps arriving while the per-lead interruptions stop.
   *
   * An explicit webhookUrl bypasses the switch, because that is how the tests exercise this function and how
   * a one-off diagnostic addresses a different space on purpose.
   *
   * `critical: true` also bypasses it, and the distinction is the whole reason the switch is safe to leave
   * off. What the client asked to silence was PER-LEAD noise — "this visit moved", "that gift went out" —
   * things it is fine to read tomorrow. A critical message says the automation CANNOT DO ITS JOB AT ALL:
   * REI is logged out, so nothing is being checked and every card from here is stale. Silencing that is not
   * "fewer interruptions", it is the system failing quietly, which is the failure mode this project has
   * spent the most effort designing out.
   *
   * It is deliberately narrow. Use it only where the message means "nothing works until a person acts".
   */
  if (cfg && !cfg.chatAlerts && !critical) return false;
  const url = webhookUrl !== null ? webhookUrl : cfg.chatWebhookUrl;
  if (!url) return false;

  const prefix = { ok: '✅', warn: '⚠️', error: '❌', info: 'ℹ️' }[kind] || 'ℹ️';
  /*
   * keepContactDetails is for ONE message: the visit briefing a colleague copies out of Chat and pastes
   * into the visit group. Redacting there defeats the message — the visitor is being sent to a house to
   * meet somebody they then cannot ring, so they go hunting in REI and the briefing has saved nothing.
   *
   * It is a parameter rather than a config flag on purpose. A flag would silence the scrubber for every
   * message the project sends; this way the exception is visible at the one call site that takes it, and
   * every other notification is redacted whatever anyone puts in .env.
   *
   * The audience is the same either way: the Chat space and the visit group are both team-only.
   */
  const body = { text: `${prefix} ${keepContactDetails ? String(text || '') : scrubContactDetails(text)}` };

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
