/**
 * REI's lead stage -> the workbook's Current Stage, and the rule for when it may move.
 *
 * The client, after seeing Amelia Middel: REI had her at "4 Offer Sent" with an Amount Offer of $930,000
 * and a Next Step about confirming the formal offer, while the tracker said "Visit Scheduled" and told the
 * team to go and visit her. His instruction: "its automation right so what it gets in the rei should be
 * update in the dashboard and data its important."
 *
 * REI's stage has only ever been written into a note ("REI stage: 4 Offer Sent") and never mapped, so the
 * pipeline position on the board came exclusively from whoever last touched the dashboard.
 *
 * Pure and importless, like the other decision modules, so the mapping is testable without a browser.
 */

/*
 * FORWARD ONLY, and this ordering is what makes that meaningful.
 *
 * The workbook's own Current Stage dropdown, in pipeline order. A lead may be advanced along it from REI
 * and may never be moved back: REI's copy can easily be older than the team's, and rewinding a lead from
 * Contract Sent to Visit Scheduled would erase real progress and put a signed deal back in the visit
 * queue. Advancing is safe because REI knowing something later than the sheet is the whole problem here.
 */
export const STAGE_ORDER = [
  'Visit Scheduled',
  'Visit Completed — Needs Review',
  'Offer Preparation',
  'Offer Sent',
  'Active Negotiation',
  'Verbal Agreement',
  'Contract Sent',
  'Contract Signed'
];

/*
 * REI's wording -> ours. Matched loosely because REI prefixes a number ("4 Offer Sent", "2 Follow Up").
 *
 * Deliberately incomplete. Only stages whose meaning maps unambiguously are here; anything else returns ''
 * and leaves the stage alone, because a wrong stage is worse than a stale one — it moves a lead into a
 * section of the 3pm work queue that tells somebody to do the wrong thing.
 *
 * Left out, each for a reason:
 *   "Follow Up"        ambiguous. Could be before a visit or after an offer; REI uses it for both.
 *   "New Lead"         earlier than anything this tracker holds, and forward-only would ignore it anyway.
 *   "Dead" / "Lost"    handled by stageCloseOut below, which is a backwards move and cannot use this list.
 *   "Nurture"          a downgrade, and forward-only would refuse it.
 */
const REI_STAGE_PATTERNS = [
  [/appointment\s*(?:booked|set|scheduled)/i, 'Visit Scheduled'],
  [/(?:visit|appointment)\s*(?:completed|done)/i, 'Visit Completed — Needs Review'],
  [/offer\s*(?:prep|preparation|pending|in\s*progress)/i, 'Offer Preparation'],
  [/offer\s*(?:sent|submitted|presented|made)/i, 'Offer Sent'],
  [/(?:negotiat|counter)/i, 'Active Negotiation'],
  [/verbal\s*(?:agreement|yes|accept)/i, 'Verbal Agreement'],
  [/contract\s*(?:sent|out|pending)/i, 'Contract Sent'],
  [/(?:contract\s*signed|under\s*contract|executed)/i, 'Contract Signed']
];

const text = (v) => String(v == null ? '' : v).trim();

/**
 * The workbook stage REI's wording means, or '' when it is ambiguous or unmapped.
 *
 * Order matters in REI_STAGE_PATTERNS: "offer sent" must be tested before the looser patterns, and
 * "contract signed" before "contract sent" would match the wrong one. The list is ordered so the first
 * match is the right one, and the first match wins.
 */
export function mapReiStage(contactStage) {
  const s = text(contactStage);
  if (!s) return '';
  // "Contract Signed" contains "contract s..." — check the most specific patterns first.
  for (const pattern of [/(?:contract\s*signed|under\s*contract|executed)/i]) {
    if (pattern.test(s)) return 'Contract Signed';
  }
  for (const [pattern, stage] of REI_STAGE_PATTERNS) {
    if (pattern.test(s)) return stage;
  }
  return '';
}

/**
 * The stage to write, or '' to leave it alone. Advances only.
 *
 * Returns '' when the target is unmapped, equal to the current stage, EARLIER than it, or when the current
 * stage is outside STAGE_ORDER — which covers 'Lost / Closed Out' and 'Long-Term Nurture'. A lead somebody
 * has closed out must not be dragged back into the pipeline because REI still holds an older stage.
 */
export function stageAdvance(currentStage, reiStage) {
  const target = mapReiStage(reiStage);
  if (!target) return '';
  const to = STAGE_ORDER.indexOf(target);
  if (to < 0) return '';

  const current = text(currentStage);
  // A blank stage is not "position zero" — it is unknown, and a lead with no stage at all should be given
  // the one REI knows rather than left out of the pipeline.
  if (!current) return target;

  const from = STAGE_ORDER.indexOf(current);
  if (from < 0) return '';                 // Lost / Closed Out, Long-Term Nurture — a human put it there
  return to > from ? target : '';
}

/*
 * Closing a lead out from REI — the one move that goes BACKWARDS, and the rules that make it safe.
 *
 * The client, on David Jackowitz: "add this in david, its already tagged as a dead lead, lost deal, and then
 * you can see the lead stage is dead, so it already updated." REI has him at Lead Stage "9 Lost / Dead Lead",
 * Category "Lost/Dead", Call Disposition "We Passed", and a note reading "We are passing on this lead |
 * Market is slow in that area". The tracker still had him live.
 *
 * This is a SECOND exception to "Current Stage is the team's, not the automation's", and it deserves more
 * suspicion than the first, because closing a lead out takes it off the work queue — the failure mode is a
 * live deal nobody follows up. Three guards:
 *
 *  1. REI's own STAGE FIELD must say it. Not a tag: David carries "Dead Lead" and "Lost Deal" AND "Follow
 *     up" at the same time, so his tags cannot settle anything. The stage field is one value, and a person
 *     in REI chose it.
 *  2. Stages at or past Verbal Agreement are REFUSED. If REI says dead and the sheet says a contract is out,
 *     that is a conflict for a human — closing it automatically could bury a deal that is nearly done.
 *  3. Nothing already closed out or in nurture is touched, so this cannot churn.
 *
 * Both strings are exact values of the workbook's dropdowns ('Lost / Closed Out' on Current Stage, 'Lost' on
 * Final Disposition). A value outside a dropdown fails the whole row write, not just its own cell.
 */
export const STAGE_LOST = 'Lost / Closed Out';
export const DISPOSITION_LOST = 'Lost';

/* Matched against REI's stage FIELD only. "Lost Deal" as a tag never reaches here. */
const REI_LOST_STAGE = /\b(?:lost|dead)\b/i;

/*
 * Stages this will not close out from, each because REI being wrong there is expensive.
 *
 * Verbal Agreement onwards is money in motion. 'Long-Term Nurture' is somewhere a person deliberately parked
 * the lead, and it is already out of the work queue, so there is nothing to gain by overriding them.
 */
const NEVER_CLOSE_FROM = ['Verbal Agreement', 'Contract Sent', 'Contract Signed', 'Long-Term Nurture', STAGE_LOST];

/** Whether REI's stage field says this lead is lost or dead. */
export function reiSaysLost(reiStage) {
  return REI_LOST_STAGE.test(text(reiStage));
}

/**
 * 'Lost / Closed Out' when REI's stage says the lead is dead and it is safe to act on, otherwise ''.
 *
 * A blank current stage returns '' — such a row is already skipped as un-checkable, and inventing a
 * close-out for a row nobody has staged would be writing a conclusion about a lead nobody has started.
 */
export function stageCloseOut(currentStage, reiStage) {
  if (!reiSaysLost(reiStage)) return '';
  const current = text(currentStage);
  if (!current) return '';
  if (NEVER_CLOSE_FROM.indexOf(current) >= 0) return '';
  return STAGE_LOST;
}

/**
 * Why a close-out was refused, for the run summary — or '' when there was nothing to refuse.
 *
 * Refusals are the whole point of guard 2, and a refusal nobody sees is the same as no guard: the conflict
 * sits in the sheet, both systems disagree, and nobody is told. This is the text that gets reported.
 */
export function closeOutRefusal(currentStage, reiStage) {
  if (!reiSaysLost(reiStage)) return '';
  const current = text(currentStage);
  if (!current || current === STAGE_LOST) return '';
  if (NEVER_CLOSE_FROM.indexOf(current) < 0) return '';
  return `REI says "${text(reiStage)}" but the tracker has this at "${current}" — too far along to close out `
    + 'automatically. A person needs to settle which is right.';
}

/*
 * The Next Action this project's own automation writes when it books a visit.
 *
 * Overwriting it is safe in a way that overwriting a person's next action is not: nobody chose these
 * words, the automation typed them. Amelia's row said "Conduct scheduled visit & log outcome" while REI's
 * Next Step read "Confirm that Amelia prepared and sent the formal offer" — the sheet was instructing the
 * team to do something the deal had moved well past.
 */
export const AUTOMATION_NEXT_ACTIONS = [
  'Conduct scheduled visit & log outcome',
  'Scheduled-visit reminder — conduct visit & log outcome',
  'Review completed visit: make offer or pass'
];

/** May REI's Next Step replace what is in the cell? Only if it is empty or the automation's own wording. */
export function nextActionReplaceable(current) {
  const c = text(current);
  return !c || AUTOMATION_NEXT_ACTIONS.some((a) => c === a);
}

/**
 * A REI money string as a number the sheet can hold: "$930,000" -> 930000.
 *
 * Returns '' for anything that is not plainly an amount, so a placeholder like "-" or "TBD" cannot land in
 * a currency cell. The digits are written rather than the formatted string, because "$930,000" as text in
 * a numeric column is a value no formula can add up.
 */
export function parseReiMoney(value) {
  const s = text(value).replace(/[$,\s]/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(s)) return '';
  const n = Number(s);
  // An offer under a thousand is a typo or a placeholder, not a Bay Area property price.
  return Number.isFinite(n) && n >= 1000 ? String(n) : '';
}
