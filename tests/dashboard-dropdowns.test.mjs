/**
 * Every dropdown the booking form can WRITE has to offer exactly what the sheet ACCEPTS.
 *
 *   node tests/dashboard-dropdowns.test.mjs
 *
 * Two live faults, found a day apart, were the same fault:
 *
 *   "the mls getting like this in the tab ann then gogne again what happening?"
 *   "is ut the rifgt in text visit status? at all"
 *
 * Dashboard.html declares each list twice — a copy in the file, and the real one webGetData() returns from
 * DROPDOWNS. MLS was in the second and not the first, so it appeared a second or two after the tab opened
 * and was missing before that. Visit Status was worse: it was not in the payload AT ALL, so the file's copy
 * was the only one there had ever been, and it had been a value short for months with nothing to show it.
 *
 * Why this matters more than a missing menu entry: Google Sheets validates the cell, and a value outside the
 * list fails the WHOLE row write, not just its own cell. The colleague is told "Saved" and the row never
 * lands. A form that offers less than the sheet loses work quietly; a form that offers more destroys it.
 *
 * So: the file's copies must equal DROPDOWNS, and the payload must carry every one of them.
 */
import fs from 'node:fs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

const cfg = fs.readFileSync('apps-script/Config.gs', 'utf8');
const html = fs.readFileSync('apps-script/Dashboard.html', 'utf8');
const webapp = fs.readFileSync('apps-script/WebApp.gs', 'utf8');
const combined = fs.readFileSync('apps-script/Code.combined.gs', 'utf8');

/** A quoted list out of a source file, by the text that introduces it. */
function listAfter(src, intro) {
  const at = src.indexOf(intro);
  if (at < 0) return null;
  const open = src.indexOf('[', at);
  const close = src.indexOf(']', open);
  if (open < 0 || close < 0) return null;
  return (src.slice(open, close).match(/'((?:[^'\\]|\\.)*)'/g) || []).map((s) => s.slice(1, -1));
}

/*
 * [ the sheet's dropdown, the page's variable, the payload key ]
 *
 * Assigned Owner and Assigned Visitor are absent on purpose: the page narrows those to the people actually
 * booking today (bookingList_), so they are meant to be a SUBSET, not a copy. Narrowing is safe — every name
 * offered is still a legal value. Widening is what breaks the write.
 */
const LISTS = [
  ['Lead Source',   'var LEADS=',   'leadSources'],
  ['Visit Status',  'var VSTATUS=', 'visitStatuses'],
  ['Current Stage', 'var STAGES=',  'stages']
];

console.log('=== The page\'s own copies match the workbook ===');
for (const [dropdown, intro] of LISTS) {
  const want = listAfter(cfg, `'${dropdown}':`);
  const got = listAfter(html, intro);
  check(`${dropdown}: the sheet's list was found`, Array.isArray(want) && want.length > 0, true);
  check(`${dropdown}: the form's copy is identical`, (got || []).join(' | '), (want || []).join(' | '));
}

/*
 * The specific values the two live reports were about. Named individually so a regression reads as the
 * complaint that found it rather than as a diff of two long lists.
 */
console.log('\n=== The values that were actually missing ===');
check('MLS is offered', (listAfter(html, 'var LEADS=') || []).includes('MLS'), true);
check('Skipped — Offer Made is offered',
  (listAfter(html, 'var VSTATUS=') || []).includes('Skipped — Offer Made'), true);
check('...and the sheet really does accept it',
  (listAfter(cfg, "'Visit Status':") || []).includes('Skipped — Offer Made'), true);

/*
 * The payload. Without this the file's copy is the only one there is, which is exactly how Visit Status went
 * a value short and stayed that way — a matching pair of lists today proves nothing about tomorrow.
 */
console.log('\n=== The sheet sends every one of them ===');
for (const [dropdown, , key] of LISTS) {
  const sent = new RegExp(`${key}:\\s*DROPDOWNS\\['${dropdown}'\\]`);
  check(`${key} is in the payload`, sent.test(webapp), true);
  /* Code.combined.gs is what actually gets pasted into Apps Script — a fix only in WebApp.gs ships nothing. */
  check(`${key} is in the pasted copy too`, sent.test(combined), true);
  check(`the page applies ${key}`,
    new RegExp(`if\\(d\\.${key}&&d\\.${key}\\.length\\)`).test(html), true);
}

/*
 * ---- And the sheet's OWN writers have to obey the same lists ----
 *
 * The booking form is not the only thing that fills these columns. The Gmail intake creates a row for every
 * "booked appointment" task REI emails, and it wrote 'REI Task (email)' into Lead Source — not one of the
 * nine. Lead Source is validated with setAllowInvalid(false), so setValue THROWS on it and takes the whole
 * row down, exactly as it once did on G379. processReiTaskEmails_ catches that into errors++ and moves on,
 * so an emailed booking could fail with nothing on the board to show a lead had been missed.
 *
 * Blank is the fix rather than a tenth dropdown value: 'REI Task (email)' is how the booking ARRIVED, not
 * where the lead came from, and putting a delivery channel in the lead-source column would show up in every
 * report built on it. mapLeadSource already sets that rule for a source it cannot place.
 */
console.log('\n=== the Gmail intake writes legal values ===');
const LEAD_OK = listAfter(cfg, "'Lead Source':");
const VS_OK = listAfter(cfg, "'Visit Status':");
const STAGE_OK = listAfter(cfg, "'Current Stage':");

for (const [label, src] of [['GmailIntake.gs', fs.readFileSync('apps-script/GmailIntake.gs', 'utf8')],
  ['the pasted copy', combined]]) {
  const declared = (src.match(/LEAD_SOURCE:\s*'([^']*)'/) || [])[1];
  check(`${label}: LEAD_SOURCE is blank or legal`,
    declared === '' || LEAD_OK.includes(declared), true);
  /* Named outright, because this exact string is what broke it. */
  check(`${label}: it is not 'REI Task (email)'`, declared === 'REI Task (email)', false);
  /* The other two the intake writes as literals — legal today, and they must stay that way. */
  const vs = (src.match(/'Visit Status':\s*'([^']*)',\s*\/\/ a booking is always/) || [])[1];
  const stage = (src.match(/'Current Stage':\s*'([^']*)',\s*\/\/ \.\.\.so it shows/) || [])[1];
  check(`${label}: the visit status it writes is legal`, VS_OK.includes(vs), true);
  check(`${label}: the stage it writes is legal`, STAGE_OK.includes(stage), true);
}

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
