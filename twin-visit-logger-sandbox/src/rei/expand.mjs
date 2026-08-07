/**
 * Expand REI's truncated notes before reading them.
 *
 * Why this exists: Rob Walker's gift reached the sheet with the basket's name and its order number, and
 * without the price, the order date or the delivery date. All three sit LATER in the same note. REI clamps a
 * long note and hides the rest behind "Show More" — the client's own screenshot of Marlene Martin's note has
 * "Show Less" at the bottom, which is that control after somebody clicked it by hand.
 *
 * So the parser was never the problem for those fields. The scraper was reading half a note and the parser
 * was correctly reporting that half. Every field this project adds by reading notes — gift totals, delivery
 * dates, contact results — is capped by how much of the note is on screen.
 *
 * SAFETY. REI is read-only for this automation, with one narrow agreed exception that is not this. A
 * disclosure toggle mutates nothing: it reveals text the logged-in user can already see by clicking it. The
 * guard is that an element's ENTIRE trimmed text must be one of a handful of exact phrases — so "Show more"
 * qualifies and "Show more options", "Delete", "Edit", "Mark complete" and "Send" cannot, whatever they look
 * like in the DOM. Both lists are checked, allowlist and denylist, because an allowlist alone would trust
 * that no destructive control is ever labelled with one of these words.
 *
 * Pure and importless so the decision is tested without a browser.
 */

/*
 * The whole label, anchored at both ends. "Show more" passes; "Show more options" does not, because a control
 * that reveals options is a menu and what is in that menu is unknown.
 */
const EXPAND_LABELS = [
  /^show\s+(?:more|full|all)$/i,
  /^see\s+(?:more|full|all)$/i,
  /^read\s+(?:more|full)$/i,
  /^view\s+(?:more|full)$/i,
  /^more$/i,
  /^\.\.\.$/,
  /^…$/
];

/*
 * Checked as well as the allowlist, not instead of it.
 *
 * A verb here disqualifies the element no matter how it is labelled. The allowlist above should already make
 * this unreachable, which is the point: if REI ever ships a control whose entire text is "More" and which
 * deletes something, one of these words is likely to be in it, and two independent checks have to both be
 * wrong before anything is clicked.
 */
const FORBIDDEN = /\b(delete|remove|trash|archive|discard|cancel|edit|save|send|add|new|create|assign|complete|mark|merge|convert|call|text|email|sms|dial|schedule|book|pay|charge|export|import|share|invite)\b/i;

/** Whether an element's own text makes it a safe "reveal the rest of this text" control. */
export function isSafeExpander(label) {
  const raw = String(label == null ? '' : label).replace(/\s+/g, ' ').trim();
  /*
   * REI writes the control as "...Show More", ellipsis and label in one element, which is how Rob Walker's
   * gift note reached the sheet reading "...arrived in good shape ...Show More". The old anchored match
   * failed on the leading dots and the note was never expanded.
   *
   * Stripped only when something is left afterwards, so a control labelled with a bare "..." — already
   * allowed below — does not strip itself down to nothing and stop being recognised.
   *
   * LEADING only. A trailing "..." is the opposite convention: "More...", "Show more..." are the desktop
   * idiom for "opens a dialog", and on a CRM contact page that dialog is where Delete lives. Those stay
   * refused, alongside "More options" and "More actions".
   */
  const text = raw.replace(/^(?:\.{3}|…)\s*/, '').trim() || raw;
  if (!text || text.length > 12) return false;
  if (FORBIDDEN.test(text)) return false;
  return EXPAND_LABELS.some((re) => re.test(text));
}

/*
 * How many clicks one page is allowed.
 *
 * A contact with fifteen notes has fifteen of these, and each click can reveal another. The cap stops a
 * pathological page from turning one scrape into a hundred clicks; twelve covers every contact seen so far
 * with room to spare, and anything beyond it is reported rather than silently dropped.
 */
export const MAX_EXPANDS = 12;

/**
 * Click every safe expander on the page, and report what happened.
 *
 * Returns { clicked, skipped, capped } — never throws. A page with nothing to expand returns zeros, which is
 * the normal case for a short note and must not look like a failure.
 *
 * Candidates are re-read after each click, because expanding one note can reveal another's control and
 * because clicking invalidates element handles in a single-page app.
 */
export async function expandTruncatedText(page, { max = MAX_EXPANDS } = {}) {
  const out = { clicked: 0, skipped: 0, capped: false };
  const seen = new Set();

  for (let round = 0; round < max; round += 1) {
    let candidates = [];
    try {
      /*
       * Every element, not only buttons, anchors and role="button".
       *
       * REI's own markup is why. The Tasks panel turned out to be an <a>, which the role-based lookup in
       * tasks.mjs could not see, and this had the same shape of bug one layer down: Rob Walker's note came
       * back ending "...Show More" — the control was on the page, was safe, and was never a candidate
       * because of its tag. What an element IS matters less than what it SAYS, and what it says is guarded
       * strictly by isSafeExpander below.
       *
       * textContent, not innerText: innerText forces a layout pass per element and this list is now the
       * whole page. The length cap keeps a container's concatenated text from ever looking like a label.
       */
      candidates = await page.$$eval(
        'button, a, span, div, p, li, [role]',
        (els) => els
          .map((el, i) => ({ i, text: (el.textContent || '').replace(/\s+/g, ' ').trim() }))
          .filter((c) => c.text && c.text.length <= 16)
      );
    } catch {
      return out;                                     // page navigated or closed: report what was done
    }

    const next = candidates.find((c) => !seen.has(c.text.toLowerCase()) && isSafeExpander(c.text));
    if (!next) return out;
    seen.add(next.text.toLowerCase());

    /*
     * Located by its exact text rather than by the index above, so the click cannot land on a different
     * element if the DOM shifted between reading the list and acting on it.
     */
    try {
      const target = page.getByText(new RegExp(`^\\s*${next.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'));
      const count = await target.count();
      for (let n = 0; n < count && n < max; n += 1) {
        await target.nth(n).click({ timeout: 3000 }).catch(() => { out.skipped += 1; });
        out.clicked += 1;
      }
      await page.waitForTimeout(400);
    } catch {
      out.skipped += 1;
    }
  }
  out.capped = true;
  return out;
}
