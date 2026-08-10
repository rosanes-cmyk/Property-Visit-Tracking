/**
 * REI's lead-source wording -> the eight values the tracker's dropdown allows.
 *
 * Its own module, importing nothing, so the mapping can be tested from the repo root. sheets.mjs pulls in
 * googleapis, which is not resolvable outside the sandbox's node_modules — the same reason post-gate and
 * propertyradar are standalone.
 */
/**
 * REI's lead-source wording, mapped to the eight values the tracker's dropdown allows.
 *
 * REI says "PropertyLeads (PPL)" and "Bing Ads (PPC)"; the sheet allows 'PPL - Property Leads' and
 * 'PPC'. Writing REI's wording straight through was rejected by data validation with:
 *
 *   "The data you entered in cell G379 violates the data validation rules set on this sheet."
 *
 * which fails the WHOLE row write, so a real booking did not get logged because of a label. The raw REI
 * wording is not lost — visitToRecord already puts "source: <raw>" in the provenance note — so an
 * unmapped source writes BLANK rather than guessing at a category or breaking the write. Blank is
 * visible in the sheet's own Missing Required Fields formula; a wrong category is not.
 *
 * Widening the dropdown instead would have been the wrong way round: those eight are the business's
 * vocabulary for where leads come from, and REI's field is a free-text label from a third party.
 */
export function mapLeadSource(raw) {
  const s = String(raw || '').toLowerCase();
  if (!s.trim()) return '';
  if (s.includes('motivated')) return 'PPL - Motivated Leads';
  if (s.includes('propertyleads') || s.includes('property leads')) return 'PPL - Property Leads';
  if (s.includes('postcard')) return 'Direct Mail - Postcard';
  if (s.includes('direct mail') || s.includes('mailer')) return 'Direct Mail';
  // 'ppc' as a whole word, plus the ad platforms that mean the same thing to this business.
  if (/\bppc\b/.test(s) || s.includes('google ads') || s.includes('bing') || s.includes('adwords')) return 'PPC';
  if (s.includes('facebook') || /\bfb\b/.test(s)) return 'Facebook';
  if (/\bseo\b/.test(s) || s.includes('organic')) return 'SEO';
  if (/\btv\b/.test(s) || s.includes('television')) return 'TV';
  /*
   * MLS, and Redfin with it.
   *
   * 'MLS' was added to the workbook's dropdown at the client's request — "for lead source / add Mls" — and
   * without this line nothing could ever reach it: REI writes these as "MLS/ Redfin", which fell through to
   * blank. A legal value the automation cannot produce is only half the change.
   *
   * `\bmls\b` rather than a substring, so a word that merely contains those letters cannot match.
   */
  if (/\bmls\b/.test(s) || s.includes('redfin')) return 'MLS';
  return '';   // unknown: leave it blank and let the raw value stand in the note
}

