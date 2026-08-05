/**
 * Reading a cancellation off a REI contact page — the phrase matching, with no browser in sight.
 *
 * This exists because of one lead and one word. Jose Anguiano's visit was booked for Aug 1, the tracker
 * still said Scheduled five days later, and every re-check reported "REI agrees with the sheet". REI knew
 * perfectly well: a note on the contact read
 *
 *     "Equity Percentage: 22% |cancelled booked appointment"
 *
 * and the detector required the words "cancelled appointment" to be ADJACENT. "booked" sat between them,
 * so a cancellation written in plain English on the page was invisible to the automation for five days.
 *
 * Pure and importless, like post-gate and recheck, so the phrase rules can be tested against real page
 * text from anywhere without the sandbox's node_modules.
 */

/*
 * A cancellation, allowing up to two words between "cancelled" and "appointment".
 *
 * Two, not unlimited. "cancelled booked appointment", "cancelled the appointment" and "canceled his
 * booked appointment" all need to match; a paragraph that happens to contain both words fifteen words
 * apart — "we cancelled the mailer campaign before her appointment" — must not. The bound is the whole
 * safety margin, so it is deliberately tight rather than generous.
 *
 * Both spellings throughout: REI writes "cancelled", the workbook's dropdown says "Canceled".
 */
const CANCEL_PHRASES = [
  /cancel(?:l)?ed\s+(?:\S+\s+){0,2}appointment/i,
  /appointment\s+(?:\S+\s+){0,2}cancel(?:l)?ed/i,
  /cancel(?:l)?ation\s+of\s+(?:\S+\s+){0,2}appointment/i
];

/*
 * Phrases that talk ABOUT cancelling without saying it happened.
 *
 * A seller's own words in a note — "she may cancel if we cannot do 495" — are a negotiating position,
 * not an outcome, and acting on one would call off a visit that is still going ahead. Checked against the
 * matched span rather than the page, so an unrelated hypothetical elsewhere on a long contact page cannot
 * suppress a real cancellation.
 */
const HYPOTHETICAL = /\b(?:may|might|could|would|if|will|going to|wants to|asked to|threatened to|risk of)\b/i;

/**
 * What the page says about a cancellation: { cancelled, phrase, hypothetical }.
 *
 * `phrase` is the matched span with a little surrounding context, so a run can PRINT the evidence it
 * acted on. A status written from a regex over free text must never be silent — the sentence that caused
 * it is the only way a person can tell a real cancellation from a false positive.
 */
export function cancellationEvidence(pageText) {
  const text = String(pageText == null ? '' : pageText).replace(/\s+/g, ' ');
  for (const pattern of CANCEL_PHRASES) {
    const match = text.match(pattern);
    if (!match) continue;

    // Keep ~60 characters either side: enough to judge, short enough for one log line.
    const at = match.index ?? 0;
    const phrase = text.slice(Math.max(0, at - 60), Math.min(text.length, at + match[0].length + 60)).trim();

    // Look for a hedge in the words immediately before the match, not across the whole page.
    const lead = text.slice(Math.max(0, at - 40), at);
    if (HYPOTHETICAL.test(lead) || HYPOTHETICAL.test(match[0])) {
      return { cancelled: false, phrase, hypothetical: true };
    }
    return { cancelled: true, phrase, hypothetical: false };
  }
  return { cancelled: false, phrase: '', hypothetical: false };
}

/*
 * Tags that mean the team has already given up on the lead.
 *
 * Jose's contact carried "Dead Lead", "Lost Deal" and "We're Passing" — a decision somebody made and
 * recorded on July 20 — while the tracker had him at Visit Scheduled with a visit coming up.
 */
const DEAD_TAGS = ['dead lead', 'lost deal', "we're passing", 'we are passing', 'not interested', 'do not contact'];

/**
 * Dead-lead tags found on the page, lower-cased. REPORTED, never acted on.
 *
 * Deliberately advisory. Moving a lead to "Lost / Closed Out" is a decision about a person's deal, the
 * team has made that call by hand throughout, and the same rule already holds on the workbook side —
 * cancelling a visit records the fact and leaves the stage for a human. The text available here is an
 * account-update NOTE ("Tags: Added …") rather than the contact's current tag list, so it says what was
 * true on the day it was written and cannot prove what is true now. That is not a basis for closing a
 * deal automatically; it is a very good basis for telling somebody to look.
 */
export function deadLeadTags(pageText) {
  const text = String(pageText == null ? '' : pageText).toLowerCase();
  return DEAD_TAGS.filter((tag) => text.includes(tag));
}
