/**
 * A date nobody booked is never written, and never printed as if it were.
 *
 *   node tests/visit-date-not-invented.test.mjs
 *
 * THE BUG. A "New property visit booked" card arrived for Linda Perine reading:
 *
 *     🗓 1969-12-31 · time not set
 *
 * The client: "do you see the date is bug". The row genuinely held that date. `new Date(v)` stood at every
 * date write site in WebApp.gs, the booking arrived with no usable Visit Date — a 0, or the "1970-01-01"
 * that an upstream `new Date(0).toISOString()` produces — and `new Date` turned the epoch into a real,
 * valid date. Written into a Pacific spreadsheet, midnight UTC on 1 January 1970 lands at 16:00 on
 * 31 December 1969, which is why it reads 1969 and not 1970.
 *
 * Nothing reported a problem at any point: the row saved, the calendar guard quietly refused it as "in the
 * past", the card posted, and a person was left reading a booking dated fifty-seven years ago. Same shape
 * as every other fault this project has had — silent success.
 *
 * THE SECOND BUG IN THE SAME LINE, which had never shown itself: `new Date('2026-09-02')` parses as UTC, so
 * a date-only ISO string written to a Pacific sheet lands on the DAY BEFORE. dateValue_ splits the parts and
 * rebuilds locally, so it cannot.
 *
 * Both halves are pinned here. dateValue_ so a bad date never reaches the sheet, and bookingDate_ so the
 * rows that ALREADY hold one say so on the card instead of printing it. The helpers are EXECUTED, not just
 * matched against with a regex — this file has produced five assertions that passed on comment text, and a
 * date helper is exactly the kind of thing where the behaviour is the whole point.
 */
import fs from 'node:fs';
import path from 'node:path';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const WEB = read('apps-script/WebApp.gs');
const CHAT = read('apps-script/ChatNotify.gs');
const INBOX = strip(read('apps-script/IntakeInbox.gs'));
const COMBINED = read('apps-script/Code.combined.gs');

/* Pull a top-level function (or var) out of a .gs file by name, so it can actually be run. */
function lift(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`no function ${name} in source`);
  const end = src.indexOf('\n}', start);
  if (end < 0) throw new Error(`could not find the end of ${name}`);
  return src.slice(start, end + 2);
}

console.log('=== dateValue_ runs, and refuses what it cannot vouch for ===');
/*
 * Built in a real function scope with the two collaborators it needs. The floor is lifted verbatim from the
 * source rather than restated here, so a change to the window cannot pass unnoticed.
 */
const floorLine = (WEB.match(/var DATE_FLOOR_MS_ = .*;/) || [])[0];
check('the 2015 floor is declared in the source', !!floorLine, true);
const dateValue_ = new Function(`
  ${floorLine}
  ${lift(WEB, 'dateSane_')}
  ${lift(WEB, 'dateValue_')}
  return dateValue_;
`)();

const iso = (v) => {
  const d = dateValue_(v);
  return d === '' ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// The exact values that produced the card.
check('a Visit Date of 0 is refused', dateValue_(0), '');
check('the string "1970-01-01" is refused', dateValue_('1970-01-01'), '');
check('a Date sitting on the epoch is refused', dateValue_(new Date(0)), '');
check('a Date at 1969-12-31 16:00 Pacific is refused', dateValue_(new Date(-28800000)), '');
// The 1899 spreadsheet epoch, which has printed on a card twice before now.
check('the Sheets 1899 epoch is refused', dateValue_(new Date(1899, 11, 30)), '');
check('a time-only day fraction is refused', dateValue_(0.5833333), '');
check('unreadable text is refused', dateValue_('sometime next week'), '');
check('an empty value is refused', dateValue_(''), '');
check('null is refused', dateValue_(null), '');

console.log('\n=== ...while every shape a real booking arrives in still works ===');
check('a date-only ISO string keeps its DAY (no UTC shift)', iso('2026-09-02'), '2026-09-02');
/*
 * ...and that plain `new Date()` really does shift it. Stated as an equivalence rather than as
 * "new Date is wrong", because it is only wrong WEST of Greenwich — which is where this workbook lives,
 * but not where CI runs. getTimezoneOffset() is positive west of UTC, so the two must agree exactly:
 * the shift happens if and only if the runtime is west. Asserting the shift outright passes locally and
 * fails in UTC for no reason, which is how this line failed the first time it ran in the suite.
 */
check('...which plain new Date() would have got wrong in Pacific',
  new Date('2026-09-02').getDate() !== 2, new Date(2026, 8, 2).getTimezoneOffset() > 0);
check('a single-digit ISO string', iso('2026-9-2'), '2026-09-02');
check('the US format the workbook types', iso('9/2/2026'), '2026-09-02');
check('a spelled-out date from the REI task body', iso('Sep 2, 2026'), '2026-09-02');
check('a real Date object passes through', iso(new Date(2026, 8, 2)), '2026-09-02');
check('a Sheets date serial', iso(46267), '2026-09-02');
// The legacy import carries visit dates back to 2023 and they must survive.
check('an imported 2023 visit is still accepted', iso('2023-04-11'), '2023-04-11');
check('a booking a year out is accepted', dateValue_(new Date(Date.now() + 365 * 864e5)) !== '', true);
check('a date twenty years out is refused', dateValue_(new Date(Date.now() + 20 * 365 * 864e5)), '');

console.log('\n=== bookingDate_ tells the reader, rather than printing 1969 ===');
const bookingDate_ = new Function(`
  var CARD_DATE_FLOOR_YEAR = ${(CHAT.match(/var CARD_DATE_FLOOR_YEAR = (\d+);/) || [])[1]};
  function fmt_(d) {
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  ${lift(CHAT, 'dateCell_')}
  ${lift(CHAT, 'bookingDate_')}
  return bookingDate_;
`)();

check('the card floor matches dateValue_’s', /CARD_DATE_FLOOR_YEAR = 2015;/.test(CHAT), true);
check('a good date prints normally', bookingDate_('2026-09-02'), '2026-09-02');
check('a US-formatted cell prints normally', bookingDate_('9/2/2026'), '2026-09-02');
check('a real Date prints normally', bookingDate_(new Date(2026, 8, 2)), '2026-09-02');
// The card the client was looking at.
check('the 1969 row says so, and quotes what the sheet holds',
  bookingDate_(new Date(1969, 11, 31)), '⚠️ no usable date (sheet says 1969-12-31)');
check('the 1899 epoch says so too',
  bookingDate_(new Date(1899, 11, 30)), '⚠️ no usable date (sheet says 1899-12-30)');
check('unreadable text is quoted back', bookingDate_('next tuesday'), '⚠️ no usable date (sheet says next tuesday)');
check('a genuinely blank cell reads "no date"', bookingDate_(''), 'no date');
check('a null cell reads "no date"', bookingDate_(null), 'no date');
check('a zero reads "no date"', bookingDate_(0), 'no date');

console.log('\n=== The write sites all go through it, in BOTH files ===');
for (const [label, raw] of [['WebApp.gs', WEB], ['Code.combined.gs', COMBINED]]) {
  const src = strip(raw);
  check(`${label}: dateValue_ is defined`, /function dateValue_\(v\) \{/.test(src), true);
  /*
   * The point of the change: not one date write may still be a bare `new Date(...)` of caller-supplied
   * input. Counted rather than spot-checked, because there were FIVE of these and finding four would have
   * left the bug live on whichever path was missed — which is exactly how the booking-priority fix shipped
   * half-done earlier in this project.
   */
  check(`${label}: no write site still does new Date(v) on a Date column`,
    /indexOf\('Date'\) >= 0.{0,40}new Date\(/.test(src), false);
  check(`${label}: the reschedule form uses it`,
    /value = dateValue_\(params\[h\]\);/.test(src), true);
  check(`${label}: the add form uses it`,
    /var dv = dateValue_\(params\[h\]\);/.test(src), true);
  check(`${label}: the record editor uses it`,
    /var dvu = dateValue_\(val\);/.test(src), true);
  check(`${label}: the intake upsert uses it`, /var dv = dateValue_\(v\);/.test(src), true);
  check(`${label}: the intake create sanitises the map before anything reads it`,
    /if \(map\['Visit Date'\] !== '' && map\['Visit Date'\] != null && dateValue_\(map\['Visit Date'\]\) === ''\) \{/.test(src), true);
  // The map feeds the calendar and the log as well as the row, so clearing it there covers all three.
  check(`${label}: ...and clears it, rather than correcting it`, /map\['Visit Date'\] = '';/.test(src), true);
  check(`${label}: the contract dates fall back to today, not to 1969`,
    (src.match(/dateValue_\(params\.date\) \|\| today_\(\)/g) || []).length, 2);
}

// The cards are in ChatNotify.gs; Code.combined.gs holds both, so it is checked in both lists on purpose.
for (const [label, raw] of [['ChatNotify.gs', CHAT], ['Code.combined.gs', COMBINED]]) {
  const src = strip(raw);
  check(`${label}: bookingDate_ is defined`, /function bookingDate_\(raw\) \{/.test(src), true);
  check(`${label}: the new-booking card reads bookingDate_`, /date: bookingDate_\(rec\['Visit Date'\]\)/.test(src), true);
  check(`${label}: ...and so does the briefing`, /var day = when \? bookingDate_\(when\) : 'date not set';/.test(src), true);
  check(`${label}: fmt_(new Date(when)) is gone from the briefing`, /fmt_\(new Date\(when\)\)/.test(src), false);
  // cellDisplay_ is what printed it: a number <= 1000 and a Date both fall straight through to the card.
  check(`${label}: the card no longer builds its date from cellDisplay_`,
    /cellDisplay_\('Visit Date'/.test(src), false);
}

console.log('\n=== A refused date is SAID, not swallowed ===');
/*
 * The row keeps the date it had, which is right — but a colleague who just typed one has to be told it did
 * not take. Every other version of this failure in this project reported success and reached nobody.
 */
check('the row is flagged Incomplete on intake',
  /map\['Data Quality Status'\] = 'Incomplete';/.test(WEB), true);
check('...with a reason naming the value that was rejected',
  /The booking arrived with an unusable Visit Date \("' \+ badDate \+/.test(WEB), true);
check('the reschedule returns a warning', /that date was NOT changed\./.test(WEB), true);
check('the add returns a warning', /the record was saved WITHOUT it\./.test(WEB), true);
check('the record editor returns a warning', /that field was left as it was\./.test(WEB), true);
check('the log line names the rejected value', /UNUSABLE Visit Date rejected: /.test(WEB), true);
check('the Intake Inbox Status cell carries the warning',
  /\(res\.warning \? ' · ⚠️ ' \+ res\.warning : ''\)/.test(INBOX), true);

console.log('\n=== The rows that ALREADY hold a 1969 date can be repaired ===');
/*
 * dateValue_ stops new ones. It does nothing for the rows already carrying one, and the live tab has at
 * least one: Linda Perine's row reads 12/31/1969 beside a correct seller, phone, address and 9:00 AM.
 *
 * The repair cannot invent the day that was booked, and must not try. What it can do is stop the row
 * presenting a 1969 booking as actionable — clear the cell, flag it, and let Missing Required Fields put it
 * on the work queue where somebody will type the real date.
 */
for (const [label, src] of [['WebApp.gs', strip(WEB)], ['Code.combined.gs', strip(COMBINED)]]) {
  check(`${label}: repairImpossibleVisitDates exists`,
    /function repairImpossibleVisitDates\(\) \{/.test(src), true);
  // The same test as the write path, so the two can never disagree about what counts as impossible.
  check(`${label}: it uses dateValue_ to decide, not its own rule`,
    /dateValue_\(raw\) === ''/.test(src), true);
  check(`${label}: it PREVIEWS and asks before touching anything`,
    /ui\.ButtonSet\.YES_NO\);[\s\S]{0,200}?if \(ok !== ui\.Button\.YES\)/.test(src), true);
  check(`${label}: ...and a No changes nothing`, /Nothing was changed\./.test(src), true);
  check(`${label}: it clears rather than guesses a date`, /R\.set\('Visit Date', ''\);/.test(src), true);
  check(`${label}: ...flags the row so the board shows it`,
    /R\.set\('Data Quality Status', 'Incomplete'\);/.test(src), true);
  check(`${label}: ...and records what was there`,
    /Cleared an impossible date \(/.test(src), true);
  check(`${label}: every row is logged individually`,
    /logAuto_\('INTAKE', h\.id, 'Cleared an impossible date on row /.test(src), true);
  /*
   * Next Action Due Date is tested on its OWN. It is usually copied from the visit date so it is usually
   * wrong the same way — but a row where somebody typed a real due date has to keep it.
   */
  check(`${label}: the due date is judged separately`, /dateValue_\(due\) === ''/.test(src), true);
  check(`${label}: ...and only cleared when it is itself unusable`,
    /if \(h\.badDue\) \{ was\.push\('Next Action Due Date'\); R\.set\('Next Action Due Date', ''\); \}/.test(src), true);
  // Empty rows are not "rows with a bad date" — the tab is padded to MAX_ROWS.
  check(`${label}: empty rows are skipped`, /if \(!at\(v, 'Property Address'\)\) continue;/.test(src), true);
}
check('it is on the menu, under Setup and repair',
  /\.addItem\('📅 Clear impossible visit dates \(1969 \/ 1899\)', 'repairImpossibleVisitDates'\)\)/.test(COMBINED), true);
// Calendar events are deliberately untouched: maybeCreateVisitEvent_ refuses a past date, so no 1969
// event was ever created, and there is nothing to clean up there.
check('it says the calendar is not touched', /Calendar events are not changed\./.test(WEB), true);

console.log('\n=== An existing good date is never blanked by a bad arrival ===');
/*
 * The one way this fix could be worse than the bug. On an upsert, a booking arriving with a broken date
 * must not wipe the real one already on the row: the row is the authority, and the incoming value is only
 * a message. So the write is SKIPPED, never set to ''.
 */
const upsert = strip(WEB).slice(strip(WEB).indexOf('var up = function(h, v){'));
const upsertBody = upsert.slice(0, upsert.indexOf('\n    };'));
check('the upsert skips on refusal', /if \(dv === ''\) \{ badDates\.push\(.*\); return; \}/.test(upsertBody), true);
check('...and never writes the empty value', /U\.set\(h, ''\)/.test(upsertBody), false);
check('...and it is a real slice, not an empty one', upsertBody.length > 200, true);
check('the row is only flagged when it has no date left to fall back on',
  /if \(badDates\.length && !U\.get\('Visit Date'\)\) \{/.test(WEB), true);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
