/**
 * Read the tracker's OWN notes for visit outcomes — in Google's cloud, on a schedule.
 *
 * The client: "the should be start like the auto checker in calendar something." He is right, and the
 * distinction matters: the 3pm digest and the calendar sync run on GOOGLE'S servers, so they work whether
 * his PC is on, asleep or shut down. The REI re-check cannot join them — it needs a real browser to log
 * into REI, which Apps Script has no way to drive.
 *
 * But this job never touches REI. It reads the sheet and writes the sheet, nothing more. So it belongs
 * here, where it runs unattended and forever, rather than on a Windows timer that stops when the laptop
 * sleeps.
 *
 * What it finds, in the client's own words: "as you see in the dashboard its not the same in the rei that
 * already updated at all by my colleagues." The team records outcomes in notes. Lili's row said
 * "Cancelled the property visit" while the card read Visit Scheduled / OVERDUE; Todd's said "Appointment
 * canceled ... Pending reschedule". Nothing was reading them.
 *
 * The phrase rules here are a deliberate mirror of src/rei/cancel-signal.mjs. tests/notes-audit-parity.
 * test.mjs pins the two together so they cannot drift — the same approach address-normalization.test.mjs
 * uses for the three copies of the address key.
 */

/** Columns a colleague might type an outcome into. Visit Notes is where it belongs; the rest are real. */
var NOTE_COLUMNS = ['Visit Notes', 'Next Action', 'Seller Motivation', 'Last Contact Result'];

/*
 * Up to two words may sit between "cancelled" and the thing cancelled.
 *
 * Two, not unlimited. Jose's REI note read "cancelled booked appointment" and an adjacent-words rule
 * missed it for five days. But a paragraph containing both words fifteen apart — "we cancelled the mailer
 * campaign before her appointment" — must not match. The bound is the whole safety margin.
 *
 * "visit" and "walkthrough" count as well as "appointment": Lili's note contains no "appointment" at all.
 */
var NA_THING = '(?:appointment|visit|walk\\s?through|showing|meeting)';

function naCancelPatterns_() {
  return [
    new RegExp('cancel(?:l)?ed\\s+(?:\\S+\\s+){0,2}' + NA_THING, 'i'),
    new RegExp(NA_THING + '\\s+(?:\\S+\\s+){0,2}cancel(?:l)?ed', 'i'),
    new RegExp('cancel(?:l)?ation\\s+of\\s+(?:\\S+\\s+){0,2}' + NA_THING, 'i')
  ];
}

/*
 * Words that turn a statement into a possibility. Split by POSITION, because one list checked both ways
 * was wrong in both directions: "cancelled the visit, seller wants to rebook" is a real cancellation with
 * a modal trailing it, while "no show risk" needs the trailing check to be caught at all.
 */
var NA_HEDGE_MODAL = /\b(?:may|might|could|would|if|will|going to|wants? to|asked to|threatened to|hoping to|expect|expecting|in case|maybe|perhaps)\b/i;
var NA_HEDGE_QUALIFIER = /\b(?:risk|risks|potential|potentially|chance|possibility|possible|possibly|likely|unlikely|concern|concerned|worry|worried)\b/i;

/** A visit already moved to a new time is LIVE, not missing. Checked before any cancellation. */
var NA_ALREADY_MOVED = /(?:re-?scheduled|re-?booked|moved|pushed|shifted)\s+(?:to|for|until|till)\b/i;

/** Still wanted, just not then — Reschedule Needed rather than Canceled. */
function naReschedulePatterns_() {
  return [
    /pending\s+re-?schedul/i,
    /re-?schedul(?:e|ing)\s+(?:pending|needed|required)/i,
    /(?:needs?|need\s+to|to\s+be|will|wants?\s+to|hoping\s+to|asked\s+to)\s+(?:be\s+)?re-?schedul/i,
    /re-?book(?:ing)?\s+(?:pending|needed|required)/i,
    /(?:needs?|wants?\s+to|will)\s+(?:to\s+)?re-?book/i
  ];
}

var NA_NOSHOW = [
  /\bno[\s-]?show(?:ed)?\b/i,
  /\bdid\s?n[o']?t\s+show(?:\s+up)?\b/i,
  /\bnobody\s+(?:was\s+)?(?:home|there)\b/i,
  /\bno\s?one\s+(?:was\s+)?(?:home|there)\b/i
];

/*
 * A visit that DID happen — much tighter than the others.
 *
 * "visited" and "met" appear in notes written BEFORE a visit as readily as after ("visited the area last
 * week"), and marking a visit Completed moves the lead into the section Cherry reads as "decide: offer or
 * pass". So the visit itself must be named, in the past tense.
 */
function naDonePatterns_() {
  return [
    new RegExp(NA_THING + '\\s+(?:was\\s+|has\\s+been\\s+)?(?:completed|done|finished)', 'i'),
    new RegExp('(?:completed|finished)\\s+(?:the\\s+|his\\s+|her\\s+|their\\s+)?' + NA_THING, 'i'),
    new RegExp(NA_THING + '\\s+went\\s+(?:well|ahead|fine|great)', 'i')
  ];
}

/** Is this match hedged by the words immediately around it? */
function naHedged_(text, match) {
  var at = match.index || 0;
  var end = at + match[0].length;
  var before = text.slice(Math.max(0, at - 40), at);
  var after = text.slice(end, end + 24);
  return NA_HEDGE_MODAL.test(before) || NA_HEDGE_MODAL.test(match[0])
    || NA_HEDGE_QUALIFIER.test(before) || NA_HEDGE_QUALIFIER.test(after);
}

/**
 * What a free-text note says happened to the visit: { status, kind, phrase }.
 *
 * `status` is an exact value of the workbook's Visit Status dropdown, or '' for "the note says nothing".
 * A value outside that dropdown would fail the whole row write, not just its own cell.
 */
function visitOutcomeFromNotes_(notes) {
  var text = String(notes == null ? '' : notes).replace(/\s+/g, ' ');
  if (!text.replace(/\s/g, '')) return { status: '', kind: '', phrase: '' };

  // A visit moved to a new time is live. REI's appointment fields are the authority on when.
  if (NA_ALREADY_MOVED.test(text)) return { status: '', kind: 'already-moved', phrase: '' };

  var near = function (m) {
    var at = m.index || 0;
    return text.slice(Math.max(0, at - 50), Math.min(text.length, at + m[0].length + 50)).trim();
  };

  var cancels = naCancelPatterns_();
  for (var i = 0; i < cancels.length; i++) {
    var cm = text.match(cancels[i]);
    if (!cm || naHedged_(text, cm)) continue;
    var wantsAgain = naReschedulePatterns_().some(function (p) { return p.test(text); });
    return { status: wantsAgain ? 'Reschedule Needed' : 'Canceled',
      kind: wantsAgain ? 'reschedule' : 'canceled', phrase: near(cm) };
  }

  var groups = [[NA_NOSHOW, 'Canceled', 'no-show'], [naDonePatterns_(), 'Completed', 'completed']];
  for (var g = 0; g < groups.length; g++) {
    var pats = groups[g][0];
    for (var p = 0; p < pats.length; p++) {
      var m = text.match(pats[p]);
      if (m && !naHedged_(text, m)) return { status: groups[g][1], kind: groups[g][2], phrase: near(m) };
    }
  }
  return { status: '', kind: '', phrase: '' };
}

/**
 * Scan every row and correct a Visit Status its own notes contradict.
 *
 * Runs hourly from a time trigger — see installNotesAuditTrigger. Writes Visit Status ONLY onto a row that
 * currently reads 'Scheduled' or nothing: a status a person set is never overwritten, because a regex over
 * prose does not get to overrule a colleague. A contradicting note on a human-set status is logged for
 * somebody to look at instead.
 */
function auditVisitNotes(silent) {
  var sh = dataSheet_();
  var last = sh.getLastRow();
  if (last < CFG.FIRST_DATA_ROW) return;

  var headers = sh.getRange(CFG.HEADER_ROW, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var idx = {};
  headers.forEach(function (h, i) { if (h) idx[h] = i; });
  if (idx['Visit Status'] === undefined) return;

  var n = last - CFG.FIRST_DATA_ROW + 1;
  var vals = sh.getRange(CFG.FIRST_DATA_ROW, 1, n, sh.getLastColumn()).getValues();
  var present = NOTE_COLUMNS.filter(function (c) { return idx[c] !== undefined; });

  var changed = [];
  var conflicts = [];
  for (var r = 0; r < n; r++) {
    var row = vals[r];
    if (!String(row[idx['Property Address']] || '').trim()) continue;

    var notes = present.map(function (c) { return String(row[idx[c]] || '').trim(); })
      .filter(String).join(' · ');
    var found = visitOutcomeFromNotes_(notes);
    if (!found.status) continue;

    var current = String(row[idx['Visit Status']] || '').trim();
    if (current === found.status) continue;
    if (current && current !== 'Scheduled') {
      conflicts.push({ row: CFG.FIRST_DATA_ROW + r, seller: row[idx['Seller Name']], current: current, found: found });
      continue;
    }
    changed.push({ row: CFG.FIRST_DATA_ROW + r, seller: row[idx['Seller Name']], found: found, stage: String(row[idx['Current Stage']] || '').trim() });
  }

  for (var c = 0; c < changed.length; c++) {
    var ch = changed[c];
    sh.getRange(ch.row, idx['Visit Status'] + 1).setValue(ch.found.status);
    /*
     * A completed visit takes the same stage move the workbook makes when a person sets it by hand, and
     * ONLY from Visit Scheduled. A lead somebody has advanced past that is left where it is.
     */
    if (ch.found.status === 'Completed' && ch.stage === 'Visit Scheduled' && idx['Current Stage'] !== undefined) {
      sh.getRange(ch.row, idx['Current Stage'] + 1).setValue('Visit Completed — Needs Review');
    }
    // The sentence it acted on, so a status inferred from prose is never a mystery afterwards.
    logAuto_('INFO', '', 'Notes audit: row ' + ch.row + ' ' + (ch.seller || '(no name)') +
      ' — Visit Status set to ' + ch.found.status + ' (' + ch.found.kind + ') because: "' +
      String(ch.found.phrase).slice(0, 200) + '"');
  }
  for (var k = 0; k < conflicts.length; k++) {
    var cf = conflicts[k];
    logAuto_('EXCEPTION', '', 'Notes audit: row ' + cf.row + ' ' + (cf.seller || '(no name)') +
      ' — row says "' + cf.current + '" but its notes say "' + cf.found.status +
      '". Left for a person: the automation does not overrule a status somebody set.');
  }

  if (!silent) {
    var msg = changed.length
      ? changed.length + ' lead(s) corrected from their own notes.'
      : 'No lead’s notes contradict its status.';
    if (conflicts.length) msg += ' ' + conflicts.length + ' need a person — see the Automation Log.';
    SpreadsheetApp.getActive().toast(msg, 'Notes audit', 8);
  }
  return { changed: changed.length, conflicts: conflicts.length };
}

/** Menu: run it now and say what happened. */
function auditVisitNotesNow() { auditVisitNotes(false); }

/**
 * Turn it on. Hourly, in Google's cloud, so it runs whether the client's PC is on or not.
 *
 * Hourly rather than every few minutes: it reads the whole tab in one pass, but notes do not change minute
 * to minute, and this is the only job that can touch all 378 rows rather than the ~100 with a REI link.
 */
function installNotesAuditTrigger() {
  removeNotesAuditTrigger();
  ScriptApp.newTrigger('auditVisitNotesSilent').timeBased().everyHours(1).create();
  SpreadsheetApp.getActive().toast('Notes audit ON — hourly, runs in Google’s cloud.', 'Twin Visit Logger', 6);
}

function auditVisitNotesSilent() { auditVisitNotes(true); }

function removeNotesAuditTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'auditVisitNotesSilent') ScriptApp.deleteTrigger(t);
  });
}
