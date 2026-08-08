/**
 * The gate in front of the only write this project makes to REI BlackBook.
 *
 * Marking a task complete is a one-way door from the automation's point of view: nothing here will
 * ever put it back. So the decision to open that door is a pure function, separated from the browser
 * code, and every reason to refuse is explicit and tested.
 *
 * The rule: the task is only cleared once the booking demonstrably exists in BOTH places it needs to
 * live — an event on Juan's calendar, and a handover the team has actually received. If either is
 * missing, the task stays, because an open task in REI is the only thing that will make anyone notice.
 *
 * "Handover" used to mean the WhatsApp group, full stop. WhatsApp is out — the client's number is
 * restricted — so a rule that insists on a group can never be satisfied and the task would stay open
 * forever, which is not caution, it is a broken feature. The Google Chat briefing is the handover now:
 * same content, same team, and this project can prove it posted because notifyChat says whether the
 * webhook accepted it. Either one counts; NEITHER counting is still a refusal.
 *
 * The client's wording, which this implements: *"completing the task once added in the calendar,
 * sending the notif the gc, and got task appointment, and then complete task."*
 *
 * Covered by tests/rei-task-gate.test.mjs.
 */

/** Digits-only comparison on the last 10, so formatting differences cannot cause a false match. */
export function samePhone(a, b) {
  const left = String(a ?? '').replace(/\D/g, '').slice(-10);
  const right = String(b ?? '').replace(/\D/g, '').slice(-10);
  return left.length === 10 && left === right;
}

/**
 * Does this REI task belong to this visit?
 *
 * Matching on the phone alone is not enough — a seller with two properties has two tasks, and
 * completing the wrong one hides a visit that is still coming. The date has to agree too.
 */
export function taskMatchesVisit(task, visit) {
  if (!task || !visit) return false;
  if (!samePhone(task.phone, visit.phone)) return false;
  if (!task.date || !visit.date) return false;
  return task.date === visit.date;   // both YYYY-MM-DD, in the same timezone
}

/**
 * Decide whether to complete the task. Returns { complete, reason }.
 *
 * `evidence` must be the result of actually re-checking, not of remembering what this run did.
 */
export function shouldCompleteTask({
  enabled = false,
  apply = false,
  task = null,
  visit = null,
  groupVerified = false,
  briefingPosted = false,
  rowWritten = false,
  calendarVerified = false,
  alreadyComplete = false
} = {}) {
  const no = (reason) => ({ complete: false, reason });

  if (!enabled) return no('REI task completion is switched off (REI_COMPLETE_TASKS)');
  if (!task) return no('no matching REI task was found on the contact');
  if (alreadyComplete) return no('task is already complete');
  if (!taskMatchesVisit(task, visit)) return no('the task found does not match this visit (phone + date)');
  /*
   * At least one handover, and it has to be one this run can PROVE.
   *
   * `rowWritten` joined the list when the client asked for the booking and the closed task to arrive as
   * ONE Chat message: "i need the template that will notify in the gc about booked and the task is
   * completed." To report the closure in that message, the closure has to happen BEFORE it is sent — so
   * a posted briefing cannot be a precondition any more, or nothing would ever close.
   *
   * The dashboard row is a fair substitute, and arguably the better one. It is what the team actually
   * works from, it is what the 11am and 3pm cards are built from, and unlike a chat message it does not
   * scroll away. The point of this condition was never "a message was sent" — it was "the booking is
   * recorded somewhere a person will see it".
   *
   * The cost, stated because it is real: with the row as the proof, a Chat delivery that then fails
   * leaves the task closed and nobody told. The calendar event and the dashboard row are still there,
   * and the failure is in the log — but it is not in front of anybody. The two-message ordering avoided
   * that; one message cannot.
   */
  if (!groupVerified && !briefingPosted && !rowWritten) {
    return no('no handover confirmed — no WhatsApp group, Chat briefing or dashboard row — leaving the task open');
  }
  if (!calendarVerified) return no("calendar event not verified on Juan's calendar — leaving the task open");
  if (!apply) return no('dry run — would complete the task');

  const proof = groupVerified ? 'the WhatsApp group'
    : briefingPosted ? 'the Chat briefing'
      : 'the dashboard row';
  return { complete: true, reason: `calendar verified and ${proof} confirmed` };
}

/**
 * Selectors that could destroy something never get used, even if REI's markup shifts under them.
 * "Complete" and "done" are permitted; delete, remove, archive and cancel are not.
 */
const FORBIDDEN = /delete|remove|trash|archive|cancel|discard/i;

export function assertCompletionSelector(selector) {
  const text = String(selector);
  if (FORBIDDEN.test(text)) {
    throw new Error(
      `Refusing this selector: it could destroy the task rather than complete it — ${text}`
    );
  }
  return text;
}
