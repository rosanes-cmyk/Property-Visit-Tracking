/**
 * Going BACK to REI for leads already in the tracker — the decisions, with no browser in sight.
 *
 * The chain has always been one-way: a booking email arrives, REI is read once, the row and the
 * calendar event are written, and nothing ever looks again. So a visit completed, cancelled or moved
 * inside REI never reaches the tracker, and the board slowly drifts away from reality. The client put
 * it exactly: "Jose Anguiano · OVERDUE — visit was 2026-08-01 and is still marked Scheduled … you will
 * check it time to time the update in rei and then update in the dashboard, it should be accurate."
 *
 * Every judgement about WHICH leads to revisit and WHAT may be overwritten lives here, in pure
 * functions, because the dangerous part of this feature is not the scraping — it is writing over
 * something a person put there on purpose.
 */
/*
 * No luxon, on purpose.
 *
 * The other pure modules in this project (post-gate, propertyradar) import nothing, which is why their
 * tests run from anywhere. This one needs date maths and one timezone-aware format, and Intl does both
 * in the standard library — so the decisions stay testable without the sandbox's node_modules.
 */
import { stageAdvance, nextActionReplaceable, parseReiMoney } from './stage-map.mjs';
import { mapOwner, mapVisitor } from '../google/owner-map.mjs';

const ZONE = 'America/Los_Angeles';

/** A Date as the sheet writes dates: 'MM/dd/yyyy' in the visit timezone. */
function fmtSheetDate(d, zone = ZONE) {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, month: '2-digit', day: '2-digit', year: 'numeric' }).format(d);
}

/** A Date as the sheet writes times: 'h:mm a' in the visit timezone. */
function fmtSheetTime(d, zone = ZONE) {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
}

/** Midnight-to-midnight comparison in the visit timezone, so "yesterday" does not depend on the server. */
function dayKey(d, zone = ZONE) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/**
 * The ONLY sheet columns a re-check may change.
 *
 * This is the whole safety model, so it is a deliberately short list. REI is the authority on when the
 * appointment is and who the seller is; the team is the authority on everything else. A re-check that
 * could rewrite Current Stage would undo a stage somebody advanced by hand, and one that could rewrite
 * Seller Motivation or Visit Notes would erase what the visitor wrote after standing in the property.
 *
 * Explicitly NOT re-checkable, and each for a reason:
 *   Current Stage            the team's pipeline position, moved on the dashboard
 *   Visit Notes              written by whoever did the visit; REI has no equivalent
 *   Seller Motivation etc.   captured in conversation, not a REI field
 *   Approved Offer Amount    a decision, and money
 *   Next Action / Due Date   a commitment somebody made
 *   Assigned Owner/Visitor   a reassignment is a human's call — but see FILL_IF_BLANK: REI may fill one
 *                            that is EMPTY, because nobody chose blank
 */
export const RECHECKABLE = ['Visit Date', 'Visit Time', 'Visit Status', 'Seller Name', 'Phone', 'Email'];

/*
 * Current Stage is not in RECHECKABLE and must not be. These two constants describe the single guarded
 * transition a re-check may make to it — see the comment in diffFromRei for why it is unavoidable and
 * why it is safe only in this one direction. Both strings are exact values of the workbook's own
 * Current Stage dropdown; a value outside it fails the whole row write, not just its own cell.
 */
/*
 * Fields REI may FILL when the tracker's cell is empty — and never overwrite.
 *
 * A different rule from RECHECKABLE, for a different reason. The client: "im not only saying the note, look
 * at amelia still unassigned but in the rei already assigned." REI had "Appointment Assigned To: Juan" and
 * the row was blank, so the dashboard showed "Unassigned" and flagged "Missing: Assigned Owner" on a visit
 * that had an owner all along.
 *
 * These were excluded from RECHECKABLE on the grounds that "a later reassignment is a human's call". That
 * is right about a REASSIGNMENT and wrong about a BLANK. Nobody chose blank; it is missing data, and the
 * workbook's own exception rules already call it a fault. So REI may fill an empty cell and may never touch
 * one that has a name in it — if the team moved a lead from Juan to Kyle, REI's older value must not win.
 *
 * Both columns, because that is what the email path already does (sheets.mjs sets Assigned Owner and
 * Assigned Visitor from the same REI field). Following it rather than inventing a second rule.
 */
export const FILL_IF_BLANK = ['Assigned Owner', 'Assigned Visitor', 'Approved Offer Amount'];

export const STAGE_ADVANCE_FROM = 'Visit Scheduled';
export const STAGE_ON_COMPLETION = 'Visit Completed — Needs Review';

/*
 * How long before a lead is asked about again, in MINUTES.
 *
 * 20, at the client's request: "why this is two hour? should be every 20 mins check it."
 *
 * The cost is bounded by the per-run cap rather than by this number, which is what makes 20 safe. A run
 * takes at most 5 leads, so three runs an hour is at most 360 REI page loads a day however many active
 * leads there are. Lowering this does not increase that ceiling; it only means the ceiling is reached.
 *
 * It is expressed in minutes because it used to be hours, and "0.33 hours" in a config is how somebody
 * later sets it to 20 by writing 20 and gets twenty hours.
 */
export const RECHECK_MINUTES = 20;

/** Stages worth revisiting. A finished lead is not going to change in REI in a way we care about. */
export const ACTIVE_STAGES = [
  'Visit Scheduled',
  'Visit Completed — Needs Review',
  'Offer Preparation',
  'Offer Sent',
  'Active Negotiation',
  'Verbal Agreement',
  'Contract Sent'
];

const text = (v) => String(v == null ? '' : v).trim();

/**
 * Is this row worth asking REI about at all?
 *
 * Needs a REI link — there is nothing to open otherwise, which rules out every imported row — and an
 * active stage. Returns the reason it was skipped, so a run can say why it looked at 4 rows out of 380
 * instead of leaving that to be guessed at.
 */
export function recheckSkipReason(row) {
  if (!text(row['REI BlackBook Link'])) return 'no REI link';
  if (text(row['Source']) === 'TEST') return 'test row';
  const stage = text(row['Current Stage']);
  if (!stage) return 'no stage';
  if (!ACTIVE_STAGES.includes(stage)) return `stage "${stage}" is not active`;
  return '';
}

/**
 * How overdue a re-check is, in hours — higher is more urgent, 0 means not due.
 *
 * A lead whose visit date has passed while it still says Scheduled is checked FIRST and on a much
 * shorter clock, because that is the case the client actually hit: the appointment is in the past, the
 * row still claims it is coming, and every hour that stays true the board is wrong about today.
 */
export function recheckUrgency(row, lastCheckedIso, { now, minutes = RECHECK_MINUTES } = {}) {
  if (recheckSkipReason(row)) return 0;
  const last = lastCheckedIso ? new Date(lastCheckedIso) : null;
  const since = last && !Number.isNaN(last.getTime())
    ? (now.getTime() - last.getTime()) / 60000
    : Infinity;

  const visitKey = sheetDayKey(row['Visit Date']);
  const todayKey = dayKey(now);
  const stillScheduled = text(row['Visit Status']) === 'Scheduled';
  const passedButScheduled = Boolean(visitKey) && stillScheduled && visitKey < todayKey;

  /*
   * A visit happening TODAY or TOMORROW is on the short clock too.
   *
   * Only past-dated visits used to get it, which left the most consequential window uncovered: a seller
   * who calls off a 2pm visit at 10am would not be looked at again for up to 24 hours — hours after Juan
   * had already driven there. The point of a re-check is to catch that before the drive, not to file an
   * accurate report afterwards.
   */
  const tomorrowKey = dayKey(new Date(now.getTime() + 86400000));
  const imminent = Boolean(visitKey) && stillScheduled
    && visitKey >= todayKey && visitKey <= tomorrowKey;

  if (since < minutes) return 0;

  /*
   * One window for every active lead, and the tiers now only decide ORDER.
   *
   * There used to be two windows — 24 hours normally, 2 for a visit that was imminent or already past. The
   * client asked for 20 minutes flat, and a split window would have made "checked every 20 minutes" true
   * of a handful of leads and false of the rest, which is the kind of half-truth this feature has already
   * been corrected for three times. So there is one window, and it means what it says.
   *
   * The tiers survive because they still matter when more leads are due than a run may take:
   *   past-but-still-Scheduled  >  happening today/tomorrow  >  everything else
   * The base term for a never-checked lead is 1e5, so both bumps sit above it.
   */
  const base = since === Infinity ? 1e5 : since - minutes;
  const tier = passedButScheduled ? 2e6 : imminent ? 1e6 : 0;
  return base + tier;
}

/**
 * Which rows to re-check this run, most urgent first, capped.
 *
 * Capped because each one opens a REI page in a real browser. Unbounded, a first run over 380 rows
 * would sit there for an hour and hammer REI — the same shape of mistake that got a WhatsApp number
 * banned. Bounded and repeated is slower and survivable.
 */
export function pickRecheckCandidates(rows, state = {}, { now, limit = 5, minutes = RECHECK_MINUTES } = {}) {
  return rows
    .map((row) => ({
      row,
      urgency: recheckUrgency(row, state[recheckKey(row)]?.lastCheckedAt, { now, minutes })
    }))
    .filter((c) => c.urgency > 0)
    .sort((a, b) => b.urgency - a.urgency)
    .slice(0, limit)
    .map((c) => c.row);
}

/** The state-file key for a row: REI record id when there is one, else the link. */
export function recheckKey(row) {
  return text(row['REI Record ID']) || text(row['REI BlackBook Link']);
}

/** A sheet date cell — 'MM/dd/yyyy' as written by visitToRecord, an ISO string, or a Date. */
export function parseSheetDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const s = text(value);
  if (!s) return null;
  // 'MM/dd/yyyy' or 'M/d/yyyy' — what visitToRecord writes.
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2]));
  // 'yyyy-MM-dd' — what the Sheets API hands back for a date cell.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * The calendar day a sheet date cell refers to, as 'YYYY-MM-DD'. Never shifts.
 *
 * parseSheetDate builds a Date at the SERVER's local midnight, and dayKey then renders it in Pacific.
 * On a UTC machine those disagree by one day, so '08/05/2026' came back as '2026-08-04' and a visit
 * happening today was classified as already overdue. The scheduled re-check runs unattended on whatever
 * timezone the machine happens to be set to, so "which day is this" cannot depend on that.
 *
 * A written date has no timezone to convert — '08/05/2026' means the 5th wherever it is read. So the
 * text is used directly, and only a real Date object (which the Sheets API returns for a date-formatted
 * cell) goes through the zone-aware path, where the conversion is genuinely needed.
 */
export function sheetDayKey(value, zone = ZONE) {
  const s = text(value);
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = parseSheetDate(value);
  return parsed ? dayKey(parsed, zone) : '';
}

/**
 * What REI now says, in the sheet's own shape — only the re-checkable fields.
 *
 * Deliberately mirrors visitToRecord's formats ('MM/dd/yyyy', 'h:mm a') so a diff compares like with
 * like. Comparing a Luxon object against a formatted cell would report a change on every single run.
 */
export function reiFieldsFromScrape(scraped, { zone = ZONE } = {}) {
  const startRaw = scraped.appointmentStartIso ? new Date(scraped.appointmentStartIso) : null;
  const start = startRaw && !Number.isNaN(startRaw.getTime()) ? startRaw : null;
  const status = text(scraped.taskStatus);
  const cancelled = /cancel/i.test(status);
  const completed = /complet/i.test(status);
  const out = {};

  if (cancelled) {
    // REI says it is off. The date it WAS booked for stays: it is a record of the slot that was held,
    // and syncVisitCalendar_ in the workbook needs it to find the event it has to tag.
    out['Visit Status'] = 'Canceled';
  } else if (completed) {
    /*
     * REI has the appointment task ticked off, so the visit happened.
     *
     * This is the case the whole re-check exists for. The client's example was a lead whose visit was
     * four days in the past and still read "Scheduled" on the board; the only way that ever corrects
     * itself is somebody noticing, and nobody was noticing.
     *
     * 'Completed' is a real value of the workbook's own Visit Status dropdown — checked, because a value
     * outside the dropdown does not just fail its own cell, it fails the entire row write.
     *
     * The DATE is kept alongside: a completed visit still needs to say which day it happened, and REI
     * may also have moved it before it took place.
     */
    out['Visit Status'] = 'Completed';
    if (start) {
      out['Visit Date'] = fmtSheetDate(start, zone);
      out['Visit Time'] = fmtSheetTime(start, zone);
    }
  } else if (start) {
    out['Visit Date'] = fmtSheetDate(start, zone);
    out['Visit Time'] = fmtSheetTime(start, zone);
  }

  for (const [field, value] of [['Seller Name', scraped.sellerName], ['Phone', scraped.phone], ['Email', scraped.email]]) {
    if (text(value)) out[field] = text(value);
  }
  // Whoever REI says the appointment belongs to. diffFromRei only lets this land on an EMPTY cell.
  /*
   * Mapped, not passed through. REI's field is free text: it held "Thea, Cherry" for Maria Ramos, and
   * "Thea" is in neither dropdown. A value outside a dropdown does not fail its own cell — it fails the
   * whole write, taking every other correction in the batch with it. mapOwner returns '' when it cannot
   * recognise anybody, which leaves a blank the dashboard already flags rather than a silent failure.
   */
  if (text(scraped.assignedOwner)) {
    const owner = mapOwner(scraped.assignedOwner);
    const visitor = mapVisitor(scraped.assignedOwner);
    if (owner) out['Assigned Owner'] = owner;
    if (visitor) out['Assigned Visitor'] = visitor;
  }

  /*
   * REI's pipeline position, its offer amount and its next step.
   *
   * Added because REI had Amelia Middel at "4 Offer Sent" with $930,000 out, while the board said "Visit
   * Scheduled" and told the team to go and visit her. Each is guarded differently in diffFromRei — the
   * stage advances only forward, the money only fills an empty cell, the next action only replaces the
   * automation's own boilerplate — so none of them can overwrite a person's work.
   */
  if (text(scraped.contactStage)) out['Current Stage'] = text(scraped.contactStage);
  const money = parseReiMoney(scraped.amountOffer);
  if (money) out['Approved Offer Amount'] = money;
  if (text(scraped.nextAction)) out['Next Action'] = text(scraped.nextAction);
  return out;
}

/**
 * The changes a re-check would make: [{ field, from, to }].
 *
 * Three rules, and all three exist to stop this feature doing harm:
 *
 *   1. Only RECHECKABLE fields, ever.
 *   2. A BLANK from REI never overwrites a value in the sheet. A field missing from a scrape usually
 *      means the page did not render or the selector moved — not that the seller has no phone number.
 *      Silence is not data.
 *   3. Nothing is reported when the values already match, so a run over an accurate sheet writes
 *      nothing at all and says so.
 */
export function diffFromRei(row, reiFields) {
  const changes = [];
  for (const field of RECHECKABLE) {
    const to = text(reiFields[field]);
    if (!to) continue;                       // rule 2
    const from = text(row[field]);
    if (from === to) continue;               // rule 3
    changes.push({ field, from, to });
  }

  /*
   * The ONE exception to "a re-check never touches Current Stage".
   *
   * Setting Visit Status to Completed and stopping there would leave the lead reading "Visit Scheduled",
   * which means the 3pm message keeps it under "Upcoming Visit — confirm the visit is going ahead" for a
   * visit that already happened, and the dashboard card shows no flag at all. That is a worse lie than
   * the stale "Scheduled" this feature was built to fix, because it looks tidy.
   *
   * The workbook itself makes exactly this move when a person sets Visit Status to Completed
   * (onVisitStatus_ → Current Stage = 'Visit Completed — Needs Review'). A Sheets API write does not
   * fire onEdit, so the re-check has to make the same move itself or the two halves disagree.
   *
   * It is narrowed hard: ONLY from 'Visit Scheduled'. If somebody has already moved the lead on to
   * Offer Preparation, Offer Sent or anything further, that is human forward progress and rewinding it
   * to "Needs Review" would undo a decision. In that case the stage is left exactly where it is.
   */
  /*
   * Fill an empty owner, never replace a named one.
   *
   * The asymmetry is the whole point. A blank cell is missing data — the dashboard flags it as a fault, and
   * REI knows the answer. A cell with "Kyle" in it is somebody's decision, possibly a reassignment made
   * after REI was last touched, and REI's stale value must not win.
   */
  for (const field of FILL_IF_BLANK) {
    const to = text(reiFields[field]);
    if (!to || text(row[field])) continue;
    changes.push({ field, from: '', to, filledBlank: true });
  }

  if (text(reiFields['Visit Status']) === 'Completed' && text(row['Current Stage']) === STAGE_ADVANCE_FROM) {
    changes.push({ field: 'Current Stage', from: text(row['Current Stage']), to: STAGE_ON_COMPLETION });
  } else {
    /*
     * REI's own stage, but only FORWARD.
     *
     * stageAdvance refuses a move that is backwards, sideways, unmapped, or off the pipeline entirely —
     * so a lead somebody closed out or moved to nurture is never dragged back in, and REI holding an
     * older stage than the sheet changes nothing. Ambiguous REI wording ("Follow Up") maps to nothing.
     */
    const advanced = stageAdvance(row['Current Stage'], reiFields['Current Stage']);
    if (advanced) {
      changes.push({ field: 'Current Stage', from: text(row['Current Stage']), to: advanced, advanced: true });
    }
  }

  /*
   * REI's Next Step replaces the cell only when it is empty or still holds the automation's own wording.
   *
   * Amelia's row said "Conduct scheduled visit & log outcome" — typed by this project, not by a person —
   * while REI said "Confirm that Amelia prepared and sent the formal offer". Replacing our own boilerplate
   * is not overwriting anyone's work; replacing a commitment somebody made would be, so that is refused.
   */
  const nextFromRei = text(reiFields['Next Action']);
  if (nextFromRei && nextFromRei !== text(row['Next Action']) && nextActionReplaceable(row['Next Action'])) {
    changes.push({ field: 'Next Action', from: text(row['Next Action']), to: nextFromRei });
  }

  return changes;
}

/**
 * Does this change need the calendar event moved or re-tagged?
 *
 * Moving the date without moving the event is the worst possible half-job: the sheet would be right and
 * Juan would still drive on the old day.
 */
export function calendarAffected(changes) {
  return changes.some((c) => c.field === 'Visit Date' || c.field === 'Visit Time' || c.field === 'Visit Status');
}

/**
 * A one-line summary of a re-check, for the run log and the Chat message.
 *
 * `reiFields` is passed so "REI agrees with the sheet" can be told apart from "REI gave us nothing to
 * compare". The first run said "no change in REI" for a lead whose visit was five days overdue, which
 * reads like a clean bill of health — when it could equally have meant the page returned no appointment
 * at all. Those two need different actions from a person, so they need different words.
 */
export function describeChanges(row, changes, reiFields = null, scraped = null) {
  const who = text(row['Seller Name']) || '(no name)';
  const where = text(row['Property Address']);
  const head = `${who} · ${where} · `;
  if (changes.length) {
    return head + changes.map((c) => `${c.field}: "${c.from || '(blank)'}" -> "${c.to}"`).join(' · ');
  }
  if (reiFields && !Object.keys(reiFields).length) {
    return head + 'REI returned NOTHING to compare — no appointment date and no contact fields. ' +
      'The page may not have rendered, or the contact has no appointment in REI.';
  }

  /*
   * "Agrees" must name the fields REI actually answered on.
   *
   * Rule 2 skips a field REI returned blank, which correctly protects the sheet — but it makes "no
   * changes" indistinguishable from "REI had nothing to say". The message said "dates and contact
   * details agree" for a lead whose REI page turned out to carry no appointment AT ALL: the dates were
   * never compared, because there was nothing to compare them to. Reporting a match that never happened
   * is the same failure as "REI agrees with the sheet", one level finer, so the fields are named.
   */
  // Not told what REI returned is different from told it returned nothing. The runner's summary loop
  // calls this with two arguments; it must stay neutral rather than invent a finding.
  if (!reiFields) return head + 'REI agrees with the sheet';

  /*
   * Visit Status is left out of the reporting.
   *
   * REI only yields one when the appointment is cancelled or the task is ticked off, so on every healthy
   * lead it is legitimately blank. Listing it as "NOT checked" every single run would be noise, and the
   * question it answers — did the visit happen — is already the subject of the task-state sentence below.
   */
  const REPORTED = RECHECKABLE.filter((f) => f !== 'Visit Status');
  const supplied = REPORTED.filter((f) => text(reiFields[f]));
  const missing = REPORTED.filter((f) => !text(reiFields[f]));
  const confirmed = supplied.length ? `REI confirms ${supplied.join(', ')}` : 'REI confirmed nothing';
  const notChecked = missing.length
    ? ` · REI gave no ${missing.join(', ')}, so ${missing.length === 1 ? 'that field was' : 'those were'} NOT checked`
    : '';

  /*
   * "REI holds no appointment any more" is only sayable if we actually LOOKED.
   *
   * This sentence went out for two real leads on the strength of an empty task list — from a Tasks panel
   * that was never opened, because nothing in the code opened it. An empty result from a page where the
   * tasks do not render is not evidence about the appointment; it is evidence about the scraper. So the
   * claim now requires taskPanelOpened, and when the panel could not be opened the run says THAT instead,
   * because the fix is a selector rather than a person marking a visit.
   */
  const noAppointment = !text(reiFields['Visit Date']) && !text(reiFields['Visit Time']);
  const looked = Boolean(scraped?.taskPanelOpened);

  if (scraped && scraped.visitTaskState === 'unknown') {
    const tail = !looked
      ? " This is a SCRAPER problem, not a data problem: REI's Tasks panel could not be opened, so its " +
        'tasks were never read. Nothing can be concluded about the visit from this run. ' +
        'Run scripts/rei-task-doctor.mjs against the lead to see what the page offers.'
      : noAppointment
        ? ' REI holds no appointment for this contact any more, so no future re-check will settle it ' +
          'either. Somebody has to mark the visit Completed or Canceled.'
        : ' Open the lead in REI, or run scripts/rei-task-doctor.mjs against it.';
    return head + `${confirmed}${notChecked}. REI could not tell us whether the visit happened — ` +
      `${scraped.visitTaskReason}.${tail}`;
  }
  if (scraped && scraped.visitTaskState === 'open') {
    return head + `${confirmed}${notChecked}. REI still has the visit task OPEN, so REI does not know ` +
      'the outcome either. Somebody has to mark it Completed or Canceled.';
  }
  return head + confirmed + notChecked;
}
