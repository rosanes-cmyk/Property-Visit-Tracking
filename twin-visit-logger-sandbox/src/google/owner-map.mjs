/**
 * REI's owner wording -> a value the workbook's dropdown will actually accept.
 *
 * This exists because of a write that was about to fail. The re-check found REI holding
 * "Appointment Assigned To: Thea, Cherry" for Maria Ramos and offered it straight to the sheet — and
 * "Thea, Cherry" is not a value in the Assigned Owner dropdown. A rejected cell does not fail on its own,
 * it fails THE WHOLE WRITE, which is how one bad Lead Source value ("G379 violates the data validation
 * rules") took down an entire row earlier in this project.
 *
 * With 367 REI links just imported, the re-check now reads hundreds of contacts instead of four, so one
 * unmappable name would stop a batch of corrections from landing at all.
 *
 * Pure and importless so the mapping is testable from anywhere — same as lead-source.mjs, which solved the
 * identical problem for a different column.
 */

/*
 * The dropdowns, copied from the workbook (HEADERS/VALIDATION in Code.combined.gs).
 *
 * Two different lists on purpose: the sheet's own. "Thea" is in NEITHER, which is why Maria Ramos's
 * "Thea, Cherry" cannot simply be passed through — and why an unrecognised name must map to '' rather than
 * to a guess. REI's field is free text and holds whatever a person typed.
 */
export const OWNER_VALUES = ['Jonathan', 'Kyle', 'Cherry', 'Juan', 'Arly', 'Matt', 'Darius', 'Danica',
  'Team', 'Matt/Arly', 'Matt/Juan', 'Cherry/Matt'];
export const VISITOR_VALUES = ['Juan', 'Juan Diaz', 'Kyle', 'Cherry', 'Jonathan', 'Cesar', 'Jose Herrera',
  'Manny Morales', 'Lily', 'Alan Hernandez'];

const text = (v) => String(v == null ? '' : v).trim();

/*
 * Two more of the workbook's dropdowns, copied from the sheet's own validation lists.
 *
 * They are here for the same reason the owner lists are: a value outside a dropdown fails the ENTIRE row
 * write, not just its own cell, and this project has been bitten by that twice. The re-check writes to both
 * columns now that it can close a lead out from REI, so both need checking before the batch goes.
 */
export const STAGE_VALUES = ['Visit Scheduled', 'Visit Completed — Needs Review', 'Offer Preparation',
  'Offer Sent', 'Active Negotiation', 'Verbal Agreement', 'Contract Sent', 'Contract Signed',
  'Long-Term Nurture', 'Lost / Closed Out'];
export const DISPOSITION_VALUES = ['Contracted', 'Lost', 'Long-Term Nurture', 'Closed Out'];

/**
 * A legal dropdown value, or '' when REI's wording cannot be recognised.
 *
 *   'Juan'          -> 'Juan'
 *   'Thea, Cherry'  -> 'Cherry'      (Thea is not on the list; Cherry is)
 *   'Thea'          -> ''            (nobody recognised — write nothing)
 *   'Matt/Juan'     -> 'Matt/Juan'   (a real combined value, matched before either single name)
 *
 * Returning '' is the important case: it means the cell is left blank rather than filled with something
 * the sheet will reject. A blank owner is a visible gap the dashboard already flags; a failed write is
 * silent and takes every other correction in the batch down with it.
 */
export function mapOwner(raw, allowed = OWNER_VALUES) {
  const value = text(raw);
  if (!value) return '';

  // 1. The whole string is already a legal value, including the combined ones.
  const exact = allowed.find((a) => a.toLowerCase() === value.toLowerCase());
  if (exact) return exact;

  /*
   * 2. Find the first legal name INSIDE the string, longest candidates first.
   *
   * Longest first so "Juan Diaz" is preferred over "Juan" and "Matt/Juan" over "Matt" — otherwise the
   * shorter name matches at an earlier position and the more specific value is lost. Word boundaries so
   * "Juanita" does not read as "Juan".
   */
  const byLength = [...allowed].sort((a, b) => b.length - a.length);
  let best = null;
  for (const candidate of byLength) {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const at = value.toLowerCase().search(new RegExp(`\\b${escaped.toLowerCase()}\\b`));
    if (at < 0) continue;
    // Earliest position wins; on a tie the longer name does, which the sort order already gives us.
    if (!best || at < best.at) best = { candidate, at };
  }
  return best ? best.candidate : '';
}

/** The same thing for the Assigned Visitor column, which has its own list. */
export function mapVisitor(raw) {
  return mapOwner(raw, VISITOR_VALUES);
}
