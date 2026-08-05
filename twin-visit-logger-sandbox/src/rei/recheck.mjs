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
 *   Assigned Owner/Visitor   REI fills these once at intake; a later reassignment is a human's call
 */
export const RECHECKABLE = ['Visit Date', 'Visit Time', 'Visit Status', 'Seller Name', 'Phone', 'Email'];

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
export function recheckUrgency(row, lastCheckedIso, { now, hours = 24, staleHours = 2 } = {}) {
  if (recheckSkipReason(row)) return 0;
  const last = lastCheckedIso ? new Date(lastCheckedIso) : null;
  const since = last && !Number.isNaN(last.getTime())
    ? (now.getTime() - last.getTime()) / 3600000
    : Infinity;

  const visit = parseSheetDate(row['Visit Date']);
  const passedButScheduled = Boolean(visit)
    && dayKey(visit) < dayKey(now)
    && text(row['Visit Status']) === 'Scheduled';

  const due = passedButScheduled ? staleHours : hours;
  if (since < due) return 0;
  // The bump keeps a passed-but-scheduled lead above every merely stale one, however long that has waited.
  return (since === Infinity ? 1e5 : since - due) + (passedButScheduled ? 1e6 : 0);
}

/**
 * Which rows to re-check this run, most urgent first, capped.
 *
 * Capped because each one opens a REI page in a real browser. Unbounded, a first run over 380 rows
 * would sit there for an hour and hammer REI — the same shape of mistake that got a WhatsApp number
 * banned. Bounded and repeated is slower and survivable.
 */
export function pickRecheckCandidates(rows, state = {}, { now, limit = 5, hours = 24, staleHours = 2 } = {}) {
  return rows
    .map((row) => ({
      row,
      urgency: recheckUrgency(row, state[recheckKey(row)]?.lastCheckedAt, { now, hours, staleHours })
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
 * What REI now says, in the sheet's own shape — only the re-checkable fields.
 *
 * Deliberately mirrors visitToRecord's formats ('MM/dd/yyyy', 'h:mm a') so a diff compares like with
 * like. Comparing a Luxon object against a formatted cell would report a change on every single run.
 */
export function reiFieldsFromScrape(scraped, { zone = ZONE } = {}) {
  const startRaw = scraped.appointmentStartIso ? new Date(scraped.appointmentStartIso) : null;
  const start = startRaw && !Number.isNaN(startRaw.getTime()) ? startRaw : null;
  const cancelled = /cancel/i.test(text(scraped.taskStatus));
  const out = {};

  if (cancelled) {
    // REI says it is off. The date it WAS booked for stays: it is a record of the slot that was held,
    // and syncVisitCalendar_ in the workbook needs it to find the event it has to tag.
    out['Visit Status'] = 'Canceled';
  } else if (start) {
    out['Visit Date'] = fmtSheetDate(start, zone);
    out['Visit Time'] = fmtSheetTime(start, zone);
  }

  for (const [field, value] of [['Seller Name', scraped.sellerName], ['Phone', scraped.phone], ['Email', scraped.email]]) {
    if (text(value)) out[field] = text(value);
  }
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
export function describeChanges(row, changes, reiFields = null) {
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
  return head + 'REI agrees with the sheet';
}
