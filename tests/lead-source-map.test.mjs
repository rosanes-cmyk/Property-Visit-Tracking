/**
 * REI's lead-source wording, mapped to the eight values the tracker allows.
 *
 *   node tests/lead-source-map.test.mjs
 *
 * The failure this exists for, seen in the live sheet:
 *
 *   "The data you entered in cell G379 violates the data validation rules set on this sheet.
 *    Please enter one of the following values: Direct Mail, Direct Mail - Postcard, PPC, TV,
 *    Facebook, SEO, PPL - Property Leads, PPL - Motivated Leads."
 *
 * REI says "PropertyLeads (PPL)" and "Bing Ads (PPC)". Writing that straight through was rejected, and a
 * rejected cell fails the WHOLE row write — so a real booking went unlogged because of a label.
 */
import { mapLeadSource } from '../twin-visit-logger-sandbox/src/google/lead-source.mjs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(want)}\n        but got  ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

/** The dropdown, read from the workbook config rather than retyped here. */
import fs from 'node:fs';
const ALLOWED = (fs.readFileSync('apps-script/Config.gs', 'utf8')
  .match(/'Lead Source':\s*\[([^\]]+)\]/) || [])[1]
  .match(/'([^']+)'/g).map((s) => s.slice(1, -1));

console.log('=== The values actually seen in the live sheet ===');
// These two are the ones that were in the sheet and are NOT dropdown values.
check('PropertyLeads (PPL)', mapLeadSource('PropertyLeads (PPL)'), 'PPL - Property Leads');
check('Bing Ads (PPC)', mapLeadSource('Bing Ads (PPC)'), 'PPC');

console.log('\n=== The rest of REI\'s wording ===');
check('MotivatedLeads (PPL)', mapLeadSource('MotivatedLeads (PPL)'), 'PPL - Motivated Leads');
check('Motivated Leads beats the PPL branch', mapLeadSource('Motivated Leads (PPL)'), 'PPL - Motivated Leads');
check('Google Ads', mapLeadSource('Google Ads'), 'PPC');
check('AdWords', mapLeadSource('AdWords'), 'PPC');
check('Facebook Ads', mapLeadSource('Facebook Ads'), 'Facebook');
check('FB', mapLeadSource('FB'), 'Facebook');
check('SEO', mapLeadSource('SEO'), 'SEO');
check('Organic search', mapLeadSource('Organic search'), 'SEO');
check('Direct Mail', mapLeadSource('Direct Mail'), 'Direct Mail');
check('a postcard is its own value', mapLeadSource('Direct Mail - Postcard'), 'Direct Mail - Postcard');
check('...even worded differently', mapLeadSource('Postcard campaign'), 'Direct Mail - Postcard');
check('mailer', mapLeadSource('Mailer'), 'Direct Mail');
check('TV', mapLeadSource('TV'), 'TV');
check('Television', mapLeadSource('Television spot'), 'TV');
check('case does not matter', mapLeadSource('propertyleads (ppl)'), 'PPL - Property Leads');

console.log('\n=== Anything unknown writes BLANK, never a guess ===');
/*
 * Blank is visible — the sheet's own Missing Required Fields formula catches it, and the raw REI wording
 * survives in the provenance note ("source: <raw>"). A wrong category is invisible and would skew
 * whatever report someone runs on lead sources next quarter.
 */
check('an unrecognised source', mapLeadSource('Zillow'), '');
check('a referral', mapLeadSource('Referral from Bob'), '');
check('empty', mapLeadSource(''), '');
check('whitespace', mapLeadSource('   '), '');
check('null', mapLeadSource(null), '');
check('undefined', mapLeadSource(undefined), '');

console.log('\n=== Every output is a legal dropdown value ===');
// The whole point: nothing this returns can be rejected by data validation.
const outputs = ['PropertyLeads (PPL)', 'MotivatedLeads (PPL)', 'Bing Ads (PPC)', 'Google Ads', 'Facebook Ads',
  'SEO', 'Direct Mail', 'Postcard campaign', 'Television', 'Zillow', '', 'anything at all']
  .map(mapLeadSource);
check('nothing outside the dropdown, blank aside',
  outputs.every((v) => v === '' || ALLOWED.includes(v)), true);
/*
 * NINE now: 'MLS' was added at the client's request — "for lead source / add Mls" — because REI is feeding
 * MLS/Redfin leads in and there was no legal value to put them under.
 *
 * The count is asserted rather than the contents so that adding a tenth is a deliberate act that updates
 * this line. Every value mapLeadSource can return still has to be one of them: an illegal value fails the
 * whole row write, not just its own cell.
 */
check('the dropdown has nine values', ALLOWED.length, 9);
check('...including MLS', ALLOWED.includes('MLS'), true);
/*
 * And something has to REACH it. REI writes these as "MLS/ Redfin", which fell through to blank — a legal
 * value the automation cannot produce is only half the change.
 */
check('"MLS/ Redfin" maps to MLS', mapLeadSource('MLS/ Redfin'), 'MLS');
check('"Redfin" alone maps to MLS', mapLeadSource('Redfin'), 'MLS');
check('"mls" in any case maps to MLS', mapLeadSource('mls listing'), 'MLS');
/* Word-boundary, so a word that merely contains those letters does not match. */
check('"mlsomething" is not MLS', mapLeadSource('mlsomething'), '');
// A whole-word guard: 'ppc' must not fire on a word that merely contains it.
check('"clippings" is not PPC', mapLeadSource('newspaper clippings'), '');
check('"stv" is not TV', mapLeadSource('stvincent'), '');

/*
 * ---- The booking form has to OFFER it, too ----
 *
 * The client, pointing at the Book / reschedule visit dialog: "add in the dashboard of the mls/ redfin
 * right? in adding property tabs". mapLeadSource had covered the automated path for weeks; the form a
 * colleague actually types into had not moved. Two things were wrong there and each is checked below.
 */
const html = fs.readFileSync('apps-script/Dashboard.html', 'utf8');

/*
 * 1. The starting list. boot() overwrites LEADS with the server's copy, so this was easy to leave behind —
 *    and it had been, for every value added since the file was written. It only shows when the boot payload
 *    does not arrive, which is exactly when nobody is in a position to work around it.
 */
const FALLBACK = ((html.match(/var LEADS=\[([^\]]+)\]/) || [])[1] || '')
  .match(/'([^']+)'/g).map((s) => s.slice(1, -1));
check('the form\'s starting list matches the workbook exactly',
  FALLBACK.join('|'), ALLOWED.join('|'));

/*
 * 2. The label. Redfin leads have always been legal — they are stored as 'MLS' — but a colleague reading a
 *    list that says only "MLS" cannot know that, so the lead lands under Direct Mail or nowhere. The option
 *    reads "MLS / Redfin" and still SUBMITS 'MLS': widening the stored value would split one channel across
 *    every report and orphan the rows already filed.
 */
check('MLS is labelled for Redfin as well', /var LEAD_LABELS=\{'MLS':'MLS \/ Redfin'\}/.test(html), true);
check('the option submits the stored value, not the label',
  /<option value="'\+esc\(s\)\+'">'\+esc\(leadLabel\(s\)\)\+'<\/option>/.test(html), true);
/* A label that is not a legal dropdown value must never be what gets written. */
check('the widened label is not itself a dropdown value', ALLOWED.includes('MLS / Redfin'), false);

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
