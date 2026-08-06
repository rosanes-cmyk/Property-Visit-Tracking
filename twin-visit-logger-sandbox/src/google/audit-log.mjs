/**
 * Write what the automation did into the workbook's own Automation Log.
 *
 * The client, looking at a lead while talking to a colleague: "how would i know the auto update in the
 * dashboard check in the rei all what happened like this ... its already update".
 *
 * He could not know. The REI re-check corrected rows silently: the Chat webhook returns 404, so nothing was
 * announced, and nothing was recorded either — the only trace was a log file on his own laptop. So a cell
 * would change and there was no way to answer "when was this last checked, and what changed?" while
 * actually looking at the lead.
 *
 * The Apps Script side has always written to an 'Automation Log' tab (Timestamp / Level / Property ID /
 * Message) through logAuto_. This is the same tab, written from Node, so both halves of the system leave
 * their history in one place instead of two.
 */

const LOG_SHEET = 'Automation Log';
const HEADERS = ['Timestamp', 'Level', 'Property ID', 'Message'];

/**
 * Append rows to the Automation Log, creating the tab if it does not exist yet. Never throws.
 *
 * A log write must not be able to fail the correction it is describing. The row is already in the sheet by
 * the time this runs, and losing the note about it is far better than losing the fix — so every error here
 * is swallowed and reported to the console, the same rule notifyChat follows.
 */
export async function appendAuditLog(sheets, spreadsheetId, rows) {
  if (!rows || !rows.length) return 0;
  try {
    let lastRow = await tabLength(sheets, spreadsheetId);
    if (lastRow === null) {
      await createTab(sheets, spreadsheetId);
      lastRow = 1;
    }
    /*
     * An explicit row, not values.append.
     *
     * append() writes to the first column of the TABLE IT DETECTS rather than the range given, and that has
     * already bitten this project once — it put data in the wrong place on the tracker. Reading the length
     * and updating a known row costs one extra call and cannot land anywhere unexpected.
     */
    const start = lastRow + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${LOG_SHEET}!A${start}:D${start + rows.length - 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows.map((r) => [r.at || new Date().toISOString(), r.level || 'INFO', r.id || '', r.message || '']) }
    });
    return rows.length;
  } catch (error) {
    console.log(`    (audit log not written: ${error.message})`);
    return 0;
  }
}

/** Rows currently in the log tab, or null when the tab does not exist. */
async function tabLength(sheets, spreadsheetId) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${LOG_SHEET}!A:A` });
    return (res.data.values || []).length;
  } catch {
    return null;
  }
}

async function createTab(sheets, spreadsheetId) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: LOG_SHEET, hidden: true } } }] }
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${LOG_SHEET}!A1:D1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADERS] }
  });
}

/**
 * One line describing what a re-check did to a lead, for the log.
 *
 * Written so it reads on its own months later, without the run it came from: who, where, which fields, and
 * the old value as well as the new. "Visit Status -> Canceled" is not enough to tell whether the automation
 * corrected something or broke it.
 */
export function auditLine(row, changes) {
  const who = String(row['Seller Name'] || '(no name)').trim();
  const where = String(row['Property Address'] || '').trim();
  const what = changes
    .map((c) => `${c.field}: "${c.from || '(blank)'}" -> "${String(c.to).slice(0, 80)}"`)
    .join(' · ');
  return `REI re-check updated row ${row.__rowNumber} — ${who} · ${where} — ${what}`;
}
