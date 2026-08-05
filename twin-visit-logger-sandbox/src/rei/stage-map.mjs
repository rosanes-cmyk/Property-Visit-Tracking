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
 *   "Dead" / "Lost"    closing a lead out is a decision about somebody's deal. Reported, never written —
 *                      the same rule the dead-lead TAGS follow, and the same one syncVisitCalendar_ uses.
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
