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
/*
 * The acquisitions team as it stands, set by the client: "add thea, also there should be combo of cherry and
 * thea; remove kyle, Arly, Matt, Darius, Danica, Matt/Arly, Matt/Juan, Cherry/Matt, jonathan."
 *
 * THIS LIST MUST MATCH THE WORKBOOK'S OWN DROPDOWN EXACTLY. It is a copy of the sheet's data validation, not a
 * substitute for it: a value outside the dropdown fails the WHOLE row write, not just its own cell, which this
 * project has been bitten by twice. If the sheet's validation still offers Kyle and this list does not, a lead
 * REI assigns to Kyle simply keeps whatever the cell already has — which is safe. The dangerous direction is
 * the other one: a name here that the sheet does not accept.
 *
 * Removing a name does NOT clear it from rows that already carry it. Nothing here ever blanks a cell.
 */
export const OWNER_VALUES = ['Cherry', 'Juan', 'Thea', 'Team', 'Cherry/Thea'];

/*
 * What REI actually writes, mapped to what the dropdown accepts.
 *
 * Aliases exist because the word-boundary search cannot get there on its own:
 *   "Theavil Marie"  the fuller name. \bThea\b does not match inside "Theavil" — there is no boundary after
 *                    the 'a' — so without this she reads as nobody and the lead stays Unassigned.
 *   "Thea, Cherry"   two people, and REI's own way of writing the pair. This is the exact value that nearly
 *                    failed a whole batch write, so it now resolves to the combined dropdown value instead of
 *                    being thrown away.
 */
const OWNER_ALIASES = [
  [/\bthea(?:vil)?(?:\s+marie)?\s*(?:,|\/|&|and)\s*cherry\b/i, 'Cherry/Thea'],
  [/\bcherry\s*(?:,|\/|&|and)\s*thea(?:vil)?(?:\s+marie)?\b/i, 'Cherry/Thea'],
  [/\btheavil\b/i, 'Thea']
];
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
   * 1b. REI's own wordings, checked BEFORE the name search below.
   *
   * Before it, so "Thea, Cherry" resolves to the pair rather than to whichever single name the search happens
   * to reach first — the search has no way of knowing that two names separated by a comma mean both of them.
   * Only applied when the alias target is actually in `allowed`, so the visitor column does not inherit
   * owner-only values.
   */
  for (const [pattern, target] of OWNER_ALIASES) {
    if (pattern.test(value) && allowed.includes(target)) return target;
  }

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
