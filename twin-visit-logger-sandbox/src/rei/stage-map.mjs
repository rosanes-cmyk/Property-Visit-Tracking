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
 * THE CLIENT'S ACTUAL REI DROPDOWN, sent as a screenshot after I asked what the stages really are:
 *
 *   0 Invalid Leads      -> Lost / Closed Out   not a real lead; there is nothing to work
 *   1 New Lead           -> (nothing)           earlier than this tracker's first stage
 *   2 Follow Up          -> (nothing)           ambiguous; REI uses it before a visit AND after an offer
 *   3 Appointment Booked -> Visit Scheduled
 *   4 Offer Sent         -> Offer Sent
 *   5 Under Contract     -> Contract Signed     both parties have signed; the deal is executed
 *   6 Cancelled Contract -> Active Negotiation  still ACTIVE — see stageContractCancelled
 *   7 Reinstated         -> Active Negotiation  still ACTIVE, back in play
 *   8 Clear to Close     -> Contract Signed     unambiguously past signing
 *   9 Lost / Dead Lead   -> handled by stageCloseOut
 *  10 Acquired           -> Contract Signed + Final Disposition 'Contracted'  — WON
 *
 * Before this list arrived only three of the eleven mapped — 3, 4 and 9. The other patterns were guesses at
 * wordings, and one of them turned out to be exactly right: "5 Under Contract" was already handled by the
 * under\s*contract pattern, so that value needed no new code, only confirming. The rest of the guesses
 * ("Verbal Agreement", "Negotiating", "Offer Preparation") fire on nothing in this account and are kept only
 * because a dropdown can grow.
 *
 * Under Contract maps to Contract Signed rather than Contract Sent on purpose: in this trade "under contract"
 * means both parties have signed, while the tracker's Contract Sent means it has gone out for signature. Sent
 * and executed are different weeks of work and different sections of the board.
 *
 * THE CHEAT SHEET SETTLED 6 AND 7, and I had them wrong.
 *
 * The client sent the team's own CRM cheat sheet, which says outright:
 *
 *   ACTIVE  = stages 1-8   ("Still working the lead. There is still opportunity.")
 *   LOST    = stages 0, 9
 *   WON     = stage 10
 *
 * So "6 Cancelled Contract" is an ACTIVE lead, not a dead one — its dispositions are "Seller Backed Out" and
 * "Price Disagreement", and stage 7 "Reinstated" exists precisely because these come back. I had been treating
 * a cancelled contract as something to report and leave alone, which would have left the board showing a deal
 * as signed after it had collapsed. That is the most expensive kind of wrong: a contract that is not there.
 *
 * Both map to Active Negotiation, whose action line is "Decide the counter response and keep it moving" —
 * which is exactly what stage 6 and stage 7 leads need. The tracker has no finer distinction to offer, and
 * inventing one would be worse than sharing a stage.
 *
 * Deliberately unmapped, each for a reason:
 *   "2 Follow Up"   genuinely means two different places in the pipeline — before a visit and after an offer.
 *                   The cheat sheet confirms it: Follow Up is the only stage with its own "Follow-Up Reason"
 *                   field, because the stage alone does not say where the lead is.
 *   "1 New Lead"    before anything this tracker tracks. Its first stage is a booked visit.
 */
const REI_STAGE_PATTERNS = [
  [/appointment\s*(?:booked|set|scheduled)/i, 'Visit Scheduled'],
  [/(?:visit|appointment)\s*(?:completed|done)/i, 'Visit Completed — Needs Review'],
  [/offer\s*(?:prep|preparation|pending|in\s*progress)/i, 'Offer Preparation'],
  [/offer\s*(?:sent|submitted|presented|made)/i, 'Offer Sent'],
  [/(?:negotiat|counter)/i, 'Active Negotiation'],
  [/verbal\s*(?:agreement|yes|accept)/i, 'Verbal Agreement'],
  /*
   * "Cancelled Contract" must not reach the Contract Sent pattern below, and would not — that one requires
   * sent/out/pending after the word. Asserted in the tests, because the failure would be silent and wrong in
   * the most expensive direction: a dead contract reading as a live one.
   */
  [/contract\s*(?:sent|out|pending)/i, 'Contract Sent'],
  [/(?:contract\s*signed|under\s*contract|executed)/i, 'Contract Signed'],
  /* From the real list: both mean the deal is past signing, and Contract Signed is as far as the tracker goes. */
  [/clear\s*to\s*close/i, 'Contract Signed'],
  [/\bacquired\b/i, 'Contract Signed']
];

/*
 * "0 Invalid Leads" closes a lead out as surely as "9 Lost / Dead Lead" does.
 *
 * It is not in REI_LOST_STAGE's lost|dead wording, so it was being ignored entirely. An invalid lead is one
 * there is nothing to work — a wrong number, a duplicate, a property that was never for sale — and leaving it
 * sitting in an active section is the same fault as leaving a dead one there.
 */
const REI_INVALID_STAGE = /\binvalid\b/i;

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
  const stage = text(reiStage);
  return REI_LOST_STAGE.test(stage) || REI_INVALID_STAGE.test(stage);
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

/*
 * A CANCELLED CONTRACT is the third guarded backward move, and the cheat sheet is why it exists.
 *
 * "ACTIVE — Still working the lead. There is still opportunity. Stages 1-8" — and 6 is Cancelled Contract.
 * A lead whose contract fell through is live work, not a dead deal, which is why stage 7 Reinstated exists.
 *
 * It has to move BACKWARD to be honest. The lead was at 5 Under Contract, so the tracker says Contract Signed;
 * the contract is now cancelled, and a board still showing it as signed is claiming a deal that does not exist.
 * That is worse than any staleness, so this is allowed to rewind where stageAdvance refuses.
 *
 * The dates are NOT cleared. Contract Sent Date and Contract Signed Date record that a contract really was
 * signed and then cancelled, which is the history somebody will need. Only the stage moves.
 */
const REI_CANCELLED_CONTRACT = /cancell?ed\s*contract|\breinstated\b/i;
export const STAGE_RENEGOTIATING = 'Active Negotiation';

/** 'Active Negotiation' when REI says the contract was cancelled or reinstated, otherwise ''. */
export function stageContractCancelled(currentStage, reiStage) {
  if (!REI_CANCELLED_CONTRACT.test(text(reiStage))) return '';
  const current = text(currentStage);
  if (!current) return STAGE_RENEGOTIATING;
  if (current === STAGE_RENEGOTIATING) return '';                 // already there
  /*
   * Not onto a lead somebody closed out or parked. If the team decided a cancelled contract was the end of it,
   * REI still holding stage 6 must not drag it back into the work queue.
   */
  if (current === STAGE_LOST || current === 'Long-Term Nurture') return '';
  return STAGE_RENEGOTIATING;
}

/*
 * "10 Acquired" is WON, and the tracker has a column for exactly that.
 *
 * Current Stage only reaches Contract Signed, so the stage alone cannot say a deal completed — and the cheat
 * sheet makes WON its own category. Final Disposition 'Contracted' is the workbook's own word for it and a
 * legal value of that dropdown.
 */
const REI_ACQUIRED = /\bacquired\b/i;
export const DISPOSITION_WON = 'Contracted';

/** 'Contracted' when REI says the deal was acquired, otherwise ''. */
export function dispositionFromRei(reiStage) {
  return REI_ACQUIRED.test(text(reiStage)) ? DISPOSITION_WON : '';
}

/**
 * A stage conflict REI cannot settle: REI is BEHIND the tracker. Reported, never written.
 *
 * The client: "how about the lead stage?" — a fair question, because the answer for every other field today was
 * "REI wins". This one keeps its exception, and the reason is not caution for its own sake: the tracker holds
 * Contract Sent Date, Contract Signed Date and Transaction Handoff Status, and REI has no equivalent. So a lead
 * the tracker has at Contract Signed and REI still has at Offer Sent is not a stale cell being corrected — it
 * is REI missing information the tracker has, and rewinding it would drop a signed deal back into offer
 * follow-up and erase the dates that prove otherwise.
 *
 * Silence is not the alternative though. If the two systems disagree about where a deal IS, somebody needs to
 * know, and one of the two is wrong. So it is surfaced exactly like closeOutRefusal — reported, logged as an
 * EXCEPTION, and left for a person.
 *
 * Returns '' when there is no conflict: REI ahead (stageAdvance handles it), equal, unmapped, or off-pipeline.
 */
export function stageBehindTracker(currentStage, reiStage) {
  const target = mapReiStage(reiStage);
  if (!target) return '';                              // ambiguous or unmapped: REI has not said anything
  const to = STAGE_ORDER.indexOf(target);
  const from = STAGE_ORDER.indexOf(text(currentStage));
  if (to < 0 || from < 0) return '';                   // one of them is off the pipeline entirely
  if (to >= from) return '';                           // REI is level or ahead — not this function's business
  return `REI has this lead at "${text(reiStage)}" (${target}) while the tracker has it further on at `
    + `"${text(currentStage)}". Nothing was changed — moving it back would erase the contract dates the `
    + 'tracker holds and REI does not. One of the two is wrong.';
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

/**
 * Does REI's tag list carry this tag?
 *
 * The client: "there is a tag propery evaluated if the lead has been visit and note and if re sched tag
 * property and double check as well the notes."
 *
 * A substring test, not a split. The contact page flattens the tags together with no separator — one real
 * lead reads `Follow upProperty EvaluatedTHB Inquiry CallTwin Home Buyer Web Inquiries` — so splitting
 * would have to guess where one tag ends and the next begins. Asking whether a known tag is PRESENT needs
 * no guess and cannot get that wrong.
 *
 * Case- and space-insensitive, because a tag typed by hand in a CRM will eventually differ in both.
 */
export function hasReiTag(reiTags, tag) {
  const flat = String(reiTags == null ? '' : reiTags).toLowerCase().replace(/\s+/g, '');
  const want = String(tag || '').toLowerCase().replace(/\s+/g, '');
  return !!want && flat.includes(want);
}

/**
 * The tag REI carries once a property has been visited and written up.
 *
 * Named as a constant rather than typed at each call site: it is the client's wording, it will be compared
 * in more than one place, and a typo in one of them would silently mean "this visit never happened".
 */
export const TAG_PROPERTY_EVALUATED = 'Property Evaluated';

/**
 * Has this visit demonstrably happened, according to REI?
 *
 * TWO signals required, and the second is the important one.
 *
 * The tag alone cannot be trusted. A real lead in this account carries `Follow up` AND `Property Evaluated`
 * at the same time: tags get added and never tidied up, exactly as `Dead Lead` + `Lost Deal` + `Follow up`
 * all sit on David Jackowitz at once. A stale tag moving a visit to Completed would be the automation
 * asserting something about somebody's work that is not true — which is the specific failure that made a
 * colleague angry, and the one this project has spent the most effort designing out.
 *
 * So the tag must be joined by a note dated ON OR AFTER the visit. The pair is what the client described:
 * "tag property and double check as well the notes." Either on its own returns false.
 */
/**
 * Does REI's own Lead Stage already prove the visit happened?
 *
 * The client, on a lead the sweep reported as unverifiable: "not accurate again and then wht is not working".
 * The REI page behind that complaint said `Lead Stage: 4 Offer Sent`, with a note from Cherry recording a
 * verbal offer of $1.1M and a gift delivered to the property. The sweep's line for the same lead was "REI
 * could not tell us whether the visit happened" — because it asked only the Tasks panel, and the panel was
 * empty.
 *
 * It had a plain answer in front of it and did not read it. An offer follows a visit; nobody offers $1.1M for
 * a house nobody walked. Any stage this tracker orders AFTER `Visit Scheduled` is proof the visit is behind
 * the lead, and claiming ignorance while REI says `Offer Sent` is not caution, it is a wrong answer — it
 * keeps a closed question on the work queue and sends somebody to chase a colleague who has already done it.
 *
 * Reads the MAPPED stage, so the eleven REI values and their order stay in one place:
 *   3 Appointment Booked -> 'Visit Scheduled'      index 0  -> proves nothing, the visit is still ahead
 *   4 Offer Sent         -> 'Offer Sent'           index 3  -> proves it
 *   5 / 8 / 10           -> 'Contract Signed'      index 7  -> proves it
 *   0 / 1 / 2 / 9        -> ''                              -> proves nothing, correctly
 *
 * `2 Follow Up` returning nothing is the important non-answer: REI uses it both before a visit and after an
 * offer, which is why it is unmapped, and Jose Anguiano sat on it with no appointment at all.
 *
 * 6 and 7 need the extra clause. mapReiStage does NOT map them — stageContractCancelled owns them, because
 * moving a lead to 'Active Negotiation' is a BACKWARD move with its own guards — so they arrive here as ''
 * and would read as "proves nothing". They prove it more firmly than anything else on the list: a contract
 * was signed and then cancelled, and neither happens without a visit. I wrote the first version of this
 * without that clause and the doc comment above it confidently claimed 6 mapped to index 4; running it
 * against the eleven real values is what caught it.
 */
export function visitEvidencedByStage(reiStage) {
  if (REI_CANCELLED_CONTRACT.test(text(reiStage))) return true;
  const mapped = mapReiStage(reiStage);
  if (!mapped) return false;
  const at = STAGE_ORDER.indexOf(mapped);
  return at > STAGE_ORDER.indexOf('Visit Scheduled');
}

export function visitEvidencedByRei({ reiTags, lastContactAt, visitAt } = {}) {
  if (!hasReiTag(reiTags, TAG_PROPERTY_EVALUATED)) return false;
  if (!(lastContactAt instanceof Date) || Number.isNaN(lastContactAt.getTime())) return false;
  if (!(visitAt instanceof Date) || Number.isNaN(visitAt.getTime())) return false;
  /*
   * Compared at DAY granularity. A note written the same morning as an afternoon visit is still the write-up
   * of that visit as far as anybody is concerned, and demanding it be later to the minute would reject the
   * normal case — somebody typing up the day's visits in one sitting.
   */
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return day(lastContactAt) >= day(visitAt);
}
