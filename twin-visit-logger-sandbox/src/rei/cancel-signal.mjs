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
/*
 * "visit" counts, not only "appointment".
 *
 * The dashboard showed Lili at Visit Scheduled / OVERDUE while her own note in the tracker read
 * "Cancelled the property visit - spoke to her first about the price range". The team writes "visit",
 * "walkthrough" and "showing" as readily as "appointment", and matching only the last of those is why an
 * outcome a colleague had already recorded never reached the status.
 */
const THING = '(?:appointment|visit|walk\\s?through|showing|meeting)';

const CANCEL_PHRASES = [
  new RegExp(`cancel(?:l)?ed\\s+(?:\\S+\\s+){0,2}${THING}`, 'i'),
  new RegExp(`${THING}\\s+(?:\\S+\\s+){0,2}cancel(?:l)?ed`, 'i'),
  new RegExp(`cancel(?:l)?ation\\s+of\\s+(?:\\S+\\s+){0,2}${THING}`, 'i')
];

/*
 * Phrases that talk ABOUT cancelling without saying it happened.
 *
 * A seller's own words in a note — "she may cancel if we cannot do 495" — are a negotiating position,
 * not an outcome, and acting on one would call off a visit that is still going ahead. Checked against the
 * matched span rather than the page, so an unrelated hypothetical elsewhere on a long contact page cannot
 * suppress a real cancellation.
 */
/*
 * Words that turn a statement into a possibility, on EITHER side of the phrase.
 *
 * One list, checked before and after, because splitting it produced three false positives in a row that
 * only this project's own tests caught:
 *
 *   "no show risk — she has cancelled on two other buyers"     the hedge TRAILS the phrase
 *   "cancelled visit is a possibility if the tenant refuses"   the cancellation path had its own check
 *   "possible no show, Juan will call ahead"                   "possible" was not on the list at all
 *   "worried about a cancelled walkthrough"                    nor was "worried"
 *
 * Each would have marked a live visit Canceled and told the team not to drive to it. So the rule is one
 * rule, and it errs towards suppression: missing a cancellation leaves the row as it was and the OVERDUE
 * badge still flags it for a person, whereas inventing one sends nobody to a house where a seller is
 * waiting. Those costs are not symmetric and the bias is deliberate.
 *
 * "wants to" and "risk of" stay as phrases rather than bare words — a note reading "seller wants 495k" is
 * not a hedge, and neither is "high risk lead" three sentences away.
 */
const HEDGE_MODAL = /\b(?:may|might|could|would|if|will|going to|wants? to|asked to|threatened to|hoping to|expect|expecting|in case|maybe|perhaps)\b/i;

/*
 * Qualifiers that turn the phrase itself into a possibility. These read the same on either side.
 *
 * Split from the modals by POSITION, because one list checked both ways was wrong in both directions.
 * "cancelled the visit, seller wants to rebook next week" was SUPPRESSED — a plain cancellation lost
 * because "wants to" trailed it — while "no show risk" needed the trailing check to be caught at all. A
 * modal after the phrase is talking about something else; a qualifier after it is talking about the phrase.
 */
const HEDGE_QUALIFIER = /\b(?:risk|risks|potential|potentially|chance|possibility|possible|possibly|likely|unlikely|concern|concerned|worry|worried)\b/i;

/** Is this match hedged by the words immediately around it? */
function isHedged(text, match) {
  const at = match.index ?? 0;
  const end = at + match[0].length;
  const before = text.slice(Math.max(0, at - 40), at);
  const after = text.slice(end, end + 24);
  return HEDGE_MODAL.test(before) || HEDGE_MODAL.test(match[0])
    || HEDGE_QUALIFIER.test(before) || HEDGE_QUALIFIER.test(after);
}

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

    if (isHedged(text, match)) return { cancelled: false, phrase, hypothetical: true };
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

/*
 * A visit that did not happen because nobody was there.
 *
 * "Lead is no show, continue to engage with him" was sitting in the tracker while the card read Visit
 * Scheduled. A no-show is an outcome — the visit is over and it did not happen — but the workbook's Visit
 * Status dropdown has no 'No Show' value, so it maps to Canceled and the report says which wording it
 * came from, because "cancelled" and "they didn't turn up" mean different things to whoever reads it next.
 */
const NOSHOW_PHRASES = [
  /\bno[\s-]?show(?:ed)?\b/i,
  /\bdid\s?n[o']?t\s+show(?:\s+up)?\b/i,
  /\bnobody\s+(?:was\s+)?(?:home|there)\b/i,
  /\bno\s?one\s+(?:was\s+)?(?:home|there)\b/i
];

/*
 * A visit that DID happen.
 *
 * Much tighter than the others, and deliberately so. "Visited" and "met" appear in notes written before a
 * visit as easily as after one ("visited the area last week", "met her at the office"), and marking a
 * visit Completed moves the lead into the section Cherry reads as "decide: offer or pass". So this wants
 * the visit itself named, in the past tense.
 */
const DONE_PHRASES = [
  new RegExp(`${THING}\\s+(?:was\\s+|has\\s+been\\s+)?(?:completed|done|finished)`, 'i'),
  new RegExp(`(?:completed|finished)\\s+(?:the\\s+|his\\s+|her\\s+|their\\s+)?${THING}`, 'i'),
  new RegExp(`${THING}\\s+went\\s+(?:well|ahead|fine|great)`, 'i')
];

/*
 * A visit called off but still wanted — "Reschedule Needed", not "Canceled".
 *
 * Found on the first live run of the notes audit, row 77: "Appointment canceled due to lead needs to work
 * a double shift. Pending reschedule". Reading that as Canceled throws away the only part that matters —
 * Todd still wants the visit. The workbook has a distinct Visit Status for it, and syncVisitCalendar_ tags
 * the event [RESCHEDULE NEEDED] rather than [CANCELED], because the slot is dead but the lead is not.
 *
 * Future INTENT only. "rescheduled to Aug 12" is the past tense of a move that already happened, and that
 * lead has a live appointment rather than a missing one, so it must not land here.
 */
const RESCHEDULE_PHRASES = [
  /pending\s+re-?schedul/i,
  /re-?schedul(?:e|ing)\s+(?:pending|needed|required)/i,
  /(?:needs?|need\s+to|to\s+be|will|wants?\s+to|hoping\s+to|asked\s+to)\s+(?:be\s+)?re-?schedul/i,
  /re-?book(?:ing)?\s+(?:pending|needed|required)/i,
  /(?:needs?|wants?\s+to|will)\s+(?:to\s+)?re-?book/i
];

/*
 * A reschedule that already happened, with a new time.
 *
 * "Appointment cancelled, rescheduled to Aug 12 at 2pm" contains a cancellation and would have been marked
 * Canceled — on a lead that has a LIVE appointment. Past tense plus a preposition is the difference between
 * "this needs rebooking" and "this was rebooked", and only the first is a missing visit.
 */
const ALREADY_MOVED = /(?:re-?scheduled|re-?booked|moved|pushed|shifted)\s+(?:to|for|until|till)\b/i;

/** Does the note say the visit is still wanted, just not on that date? */
export function wantsReschedule(notes) {
  const text = String(notes == null ? '' : notes).replace(/\s+/g, ' ');
  return RESCHEDULE_PHRASES.some((p) => p.test(text));
}

/**
 * What a free-text note says happened to the visit: { status, kind, phrase }.
 *
 * `status` is a real value of the workbook's Visit Status dropdown, or '' for "the note says nothing".
 * `kind` is the finer reading — 'canceled', 'no-show' or 'completed' — because a no-show and a
 * cancellation both become Canceled but a person should be told which was written.
 *
 * This reads the TRACKER'S OWN notes, so it needs no REI link and covers all 378 rows rather than the 4
 * with a REI page. The team records outcomes in notes; nothing ever read them, which is why the dashboard
 * disagreed with what colleagues had already written down.
 */
export function visitOutcomeFromNotes(notes) {
  const text = String(notes == null ? '' : notes).replace(/\s+/g, ' ');
  if (!text.trim()) return { status: '', kind: '', phrase: '' };

  const near = (match) => {
    const at = match.index ?? 0;
    return text.slice(Math.max(0, at - 50), Math.min(text.length, at + match[0].length + 50)).trim();
  };
  const hedged = (match) => isHedged(text, match);

  // Cancelled first: it is the most consequential and the most clearly worded of the three.
  /*
   * A visit that was moved to a new time is not a missing visit. Checked FIRST, before the cancellation
   * that usually sits in the same sentence, and it deliberately writes nothing: REI's appointment fields
   * are the authority on when the new visit is, and the re-check reads those.
   */
  if (ALREADY_MOVED.test(text)) return { status: '', kind: 'already-moved', phrase: '' };

  const cancel = cancellationEvidence(text);
  if (cancel.cancelled) {
    // Still wanted, just not then. Strictly more informative than Canceled, and it keeps the lead alive.
    if (wantsReschedule(text)) {
      return { status: 'Reschedule Needed', kind: 'reschedule', phrase: cancel.phrase };
    }
    return { status: 'Canceled', kind: 'canceled', phrase: cancel.phrase };
  }

  for (const [patterns, status, kind] of [
    [NOSHOW_PHRASES, 'Canceled', 'no-show'],
    [DONE_PHRASES, 'Completed', 'completed']
  ]) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && !hedged(match)) return { status, kind, phrase: near(match) };
    }
  }
  return { status: '', kind: '', phrase: cancel.hypothetical ? cancel.phrase : '' };
}
