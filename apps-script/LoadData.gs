/**
 * Twin Visit Logger — pilot/test data loader (menu: "Load pilot + test data").
 * Writes the 10 migrated pilot records + demo test records into the Data sheet,
 * leaving the formula columns intact (they recompute). Idempotent: it overwrites
 * from row 2 down for exactly the SEED rows. Use clearAllData() to wipe them.
 */
var SEED = [
  {"Property ID":"TVL-0001", "Property Address":"2607 Gimelli Pl, Apt 115, San Jose, CA 95133", "Seller Name":"Cyn Ku", "Phone":"(510) 284-7867", "Lead Source":"PPL - Property Leads", "Visit Date":new Date(2026,6,24), "Visit Status":"Scheduled", "Assigned Visitor":"Juan", "Visit Notes":"Cyn still interested in selling; 2nd property she wants to sell to us.", "Current Stage":"Visit Scheduled", "Next Action":"Conduct scheduled visit & log outcome", "Next Action Due Date":new Date(2026,6,24), "Assigned Owner":"Juan", "Created Date":new Date(2026,6,24), "Last Updated Date":new Date(2026,6,24), "Updated By":"Import", "Source":"Import", "REI Update Required":"Yes"},
  {"Property ID":"TVL-0002", "Property Address":"1253 Edgewood Rd, Redwood City, CA 94062", "Seller Name":"Steve Giorgi", "Phone":"(650) 333-8189", "Lead Source":"PPL - Property Leads", "Visit Date":new Date(2026,6,22), "Visit Status":"Scheduled", "Assigned Visitor":"Juan", "Visit Notes":"Appointment booked; note outcome after visit.", "Current Stage":"Visit Scheduled", "Next Action":"Conduct scheduled visit & log outcome", "Next Action Due Date":new Date(2026,6,22), "Assigned Owner":"Juan", "Created Date":new Date(2026,6,22), "Last Updated Date":new Date(2026,6,22), "Updated By":"Import", "Source":"Import", "REI Update Required":"Yes"},
  {"Property ID":"TVL-0003", "Property Address":"519 S 17th St, Richmond, CA 94804", "Seller Name":"Carmen Green", "Phone":"(916) 752-5759", "Lead Source":"PPL - Motivated Leads", "Visit Date":new Date(2026,6,20), "Visit Status":"Completed", "Assigned Visitor":"Juan", "Visit Notes":"Offer sent via email + SignNow contract; Juan following up directly.", "Seller Motivation":"Interested in selling (motivation detail not captured in legacy)", "Current Stage":"Offer Sent", "Offer Status":"Sent", "Next Action":"Follow up on sent offer", "Next Action Due Date":new Date(2026,6,23), "Assigned Owner":"Juan", "Last Contact Date":new Date(2026,6,20), "Last Contact Result":"Offer emailed; awaiting seller response", "Created Date":new Date(2026,6,20), "Last Updated Date":new Date(2026,6,20), "Updated By":"Import", "Source":"Import", "REI Update Required":"Yes"},
  {"Property ID":"TVL-0004", "Property Address":"5 Lancaster Cir Apt 121, Bay Point, CA 94565", "Seller Name":"Dorol Conrad", "Phone":"(415) 370-9841", "Lead Source":"PPL - Property Leads", "Visit Date":new Date(2026,6,20), "Visit Status":"Canceled", "Visit Notes":"Equity 100% but property already listed on the MLS.", "Current Stage":"Lost / Closed Out", "Final Disposition":"Lost", "Closeout Reason":"We're Passing — already listed on MLS", "Created Date":new Date(2026,6,20), "Last Updated Date":new Date(2026,6,20), "Updated By":"Import", "Source":"Import"},
  {"Property ID":"TVL-0005", "Property Address":"15340 Canyon 2 Rd, Guerneville, CA 95446", "Seller Name":"Jon Box", "Phone":"(707) 481-7040", "Lead Source":"PPL - Property Leads", "Visit Date":new Date(2026,6,20), "Visit Status":"Canceled", "Assigned Visitor":"Juan", "Visit Notes":"Passing on this lead.", "Current Stage":"Lost / Closed Out", "Final Disposition":"Lost", "Closeout Reason":"We're Passing", "Created Date":new Date(2026,6,18), "Last Updated Date":new Date(2026,6,18), "Updated By":"Import", "Source":"Import"},
  {"Property ID":"TVL-0006", "Property Address":"18 Hampton Rd, Occidental, CA 95465", "Seller Name":"Chris J. Giro", "Phone":"(707) 292-9001", "Lead Source":"PPC", "Visit Date":new Date(2026,6,18), "Visit Status":"Completed", "Assigned Visitor":"Juan", "Visit Notes":"House is structurally failing; passing.", "Seller Motivation":"Motivated but property condition too poor for our criteria", "Current Stage":"Lost / Closed Out", "Final Disposition":"Lost", "Closeout Reason":"We're Passing — structural condition", "Created Date":new Date(2026,6,16), "Last Updated Date":new Date(2026,6,18), "Updated By":"Import", "Source":"Import"},
  {"Property ID":"TVL-0007", "Property Address":"4107 Randolph Ave, Oakland, CA 94602", "Seller Name":"Yvette D Rose", "Phone":"(510) 457-6727", "Lead Source":"TV", "Visit Date":new Date(2026,6,18), "Visit Status":"Completed", "Visit Notes":"Heavily tenant-occupied; City of Oakland code violations.", "Seller Motivation":"Good location but tenant/code issues; passing", "Occupancy Status":"Tenant-Occupied", "Blocker":"Tenant", "Current Stage":"Lost / Closed Out", "Final Disposition":"Lost", "Closeout Reason":"We're Passing — tenant-occupied + code violations", "Created Date":new Date(2026,6,16), "Last Updated Date":new Date(2026,6,17), "Updated By":"Import", "Source":"Import"},
  {"Property ID":"TVL-0008", "Property Address":"16125 Bittner Rd, Occidental, CA 95465", "Seller Name":"Liam", "Phone":"(530) 545-1943", "Lead Source":"PPL - Property Leads", "Visit Date":new Date(2026,6,15), "Visit Status":"Canceled", "Visit Notes":"Internal cancellation of confirmed visit; passing.", "Current Stage":"Lost / Closed Out", "Final Disposition":"Lost", "Closeout Reason":"We're Passing — internal cancellation", "Created Date":new Date(2026,6,15), "Last Updated Date":new Date(2026,6,15), "Updated By":"Import", "Source":"Import"},
  {"Property ID":"TVL-0009", "Property Address":"39224 Guardino Dr Apt 208, Fremont, CA 94538", "Seller Name":"James White", "Phone":"(209) 221-1240", "Lead Source":"PPL - Property Leads", "Visit Date":new Date(2026,6,14), "Visit Status":"Completed", "Assigned Visitor":"Cesar", "Visit Notes":"Offer emailed; James (trustee) + sister Lisa reviewing together. Cherry following up.", "Seller Motivation":"Trustee sale; reviewing offer with family", "Current Stage":"Offer Sent", "Offer Status":"Sent", "Next Action":"Follow up on offer with James/Lisa", "Next Action Due Date":new Date(2026,6,17), "Assigned Owner":"Cherry", "Last Contact Date":new Date(2026,6,15), "Last Contact Result":"Cherry emailing offer breakdown; family reviewing", "Blocker":"Family", "Created Date":new Date(2026,6,14), "Last Updated Date":new Date(2026,6,15), "Updated By":"Import", "Source":"Import", "REI Update Required":"Yes"},
  {"Property ID":"TVL-0010", "Property Address":"1323 Oxford St, Berkeley, CA 94709", "Seller Name":"Mark Lempert", "Phone":"(510) 816-1221", "Lead Source":"Direct Mail - Postcard", "Visit Date":new Date(2026,6,13), "Visit Status":"Completed", "Assigned Visitor":"Cesar", "Visit Notes":"SERVICE FAILURE: walkthrough done 7/13 but no offer ever sent; seller displeased.", "Seller Motivation":"Was open to offer; lost due to our delay/no-offer", "Current Stage":"Lost / Closed Out", "Final Disposition":"Lost", "Closeout Reason":"Did Not Proceed — service failure (no offer sent)", "Blocker":"Documents", "Created Date":new Date(2026,6,13), "Last Updated Date":new Date(2026,6,15), "Updated By":"Import", "Source":"Import"},
  {"Property ID":"TEST-01", "Property Address":"100 Test Verbal Ln, Testville, CA 90001", "Seller Name":"Val Verbal", "Phone":"(000) 000-0001", "Lead Source":"PPC", "REI BlackBook Link":"https://app.reiblackbook.com/lead/test01", "Visit Date":new Date(2026,6,18), "Visit Status":"Completed", "Assigned Visitor":"Juan", "Visit Notes":"Great condition; seller keen.", "Seller Motivation":"Relocating for job — motivated", "Approved Offer Amount":640000, "Offer Status":"Accepted", "Offer Sent Date":new Date(2026,6,19), "Current Stage":"Verbal Agreement", "Next Action":"Prepare purchase contract", "Next Action Due Date":new Date(2026,6,23), "Assigned Owner":"Kyle", "Last Contact Date":new Date(2026,6,21), "Last Contact Result":"Seller verbally agreed to $640k", "Created Date":new Date(2026,6,18), "Last Updated Date":new Date(2026,6,21), "Updated By":"Cherry", "Source":"TEST", "REI Update Required":"Yes"},
  {"Property ID":"TEST-02", "Property Address":"200 Test Contract Sent Ave, Testville, CA 90002", "Seller Name":"Sam Sent", "Phone":"(000) 000-0002", "Lead Source":"TV", "REI BlackBook Link":"https://app.reiblackbook.com/lead/test02", "Visit Date":new Date(2026,6,15), "Visit Status":"Completed", "Assigned Visitor":"Juan", "Visit Notes":"Clean title; ready to move.", "Seller Motivation":"Downsizing — motivated", "Approved Offer Amount":720000, "Offer Status":"Accepted", "Offer Sent Date":new Date(2026,6,16), "Current Stage":"Contract Sent", "Contract Sent Date":new Date(2026,6,20), "File Link":"https://drive.google.com/test02-contract", "Next Action":"Confirm signature", "Next Action Due Date":new Date(2026,6,22), "Assigned Owner":"Cherry", "Last Contact Date":new Date(2026,6,21), "Last Contact Result":"Seller reviewing contract", "Created Date":new Date(2026,6,15), "Last Updated Date":new Date(2026,6,21), "Updated By":"Cherry", "Source":"TEST", "REI Update Required":"Yes"},
  {"Property ID":"TEST-03", "Property Address":"300 Test Signed Blvd, Testville, CA 90003", "Seller Name":"Sid Signed", "Phone":"(000) 000-0003", "Lead Source":"Direct Mail", "REI BlackBook Link":"https://app.reiblackbook.com/lead/test03", "Visit Date":new Date(2026,6,10), "Visit Status":"Completed", "Assigned Visitor":"Juan", "Visit Notes":"Signed.", "Seller Motivation":"Estate sale — motivated", "Approved Offer Amount":555000, "Offer Status":"Accepted", "Offer Sent Date":new Date(2026,6,11), "Current Stage":"Contract Signed", "Final Disposition":"Contracted", "Contract Sent Date":new Date(2026,6,14), "Contract Signed Date":new Date(2026,6,18), "Transaction Handoff Status":"Ready for Handoff", "Next Action":"Hand off signed contract to JM", "Next Action Due Date":new Date(2026,6,20), "Assigned Owner":"JM", "Last Contact Date":new Date(2026,6,18), "Last Contact Result":"Contract signed", "Created Date":new Date(2026,6,10), "Last Updated Date":new Date(2026,6,18), "Updated By":"Cherry", "Source":"TEST", "REI Update Required":"Yes"},
  {"Property ID":"TEST-04", "Property Address":"400 Test Needs Review St, Testville, CA 90004", "Seller Name":"Nia Needs-Review", "Phone":"(000) 000-0004", "Lead Source":"PPC", "REI BlackBook Link":"https://app.reiblackbook.com/lead/test04", "Visit Date":new Date(2026,6,21), "Visit Status":"Completed", "Assigned Visitor":"Juan", "Visit Notes":"Visit done; needs offer/pass decision.", "Seller Motivation":"Job relocation", "Current Stage":"Visit Completed — Needs Review", "Next Action":"Decide: make offer or pass", "Next Action Due Date":new Date(2026,6,21), "Assigned Owner":"Jonathan", "Last Contact Date":new Date(2026,6,21), "Last Contact Result":"Walkthrough complete", "Created Date":new Date(2026,6,21), "Last Updated Date":new Date(2026,6,21), "Updated By":"Jonathan", "Source":"TEST", "REI Update Required":"Yes"},
  {"Property ID":"TEST-05", "Property Address":"500 Test Nurture Way, Testville, CA 90005", "Seller Name":"Nora Nurture", "Phone":"(000) 000-0005", "Lead Source":"SEO", "REI BlackBook Link":"https://app.reiblackbook.com/lead/test05", "Visit Date":new Date(2026,5,20), "Visit Status":"Completed", "Assigned Visitor":"Juan", "Visit Notes":"Not ready yet; call back in ~60 days.", "Seller Motivation":"Will sell later this year", "Current Stage":"Long-Term Nurture", "Next Action":"Nurture check-in call", "Next Action Due Date":new Date(2026,8,20), "Assigned Owner":"Cherry", "Last Contact Date":new Date(2026,5,20), "Last Contact Result":"Asked for callback in 60 days", "Gift Status":"Recommended", "Gift Recommendation Reason":"Strong rapport; long-term seller", "Created Date":new Date(2026,5,20), "Last Updated Date":new Date(2026,5,20), "Updated By":"Cherry", "Source":"TEST", "REI Update Required":"Yes"},
  {"Property ID":"TEST-06", "Property Address":"600 Test Stalled Ct, Testville, CA 90006", "Seller Name":"Stan Stalled", "Phone":"(000) 000-0006", "Lead Source":"PPC", "REI BlackBook Link":"https://app.reiblackbook.com/lead/test06", "Visit Date":new Date(2026,6,1), "Visit Status":"Completed", "Assigned Visitor":"Juan", "Visit Notes":"Offer sent; seller gone quiet.", "Seller Motivation":"Was motivated; now unresponsive", "Approved Offer Amount":500000, "Offer Status":"Sent", "Offer Sent Date":new Date(2026,6,2), "Current Stage":"Offer Sent", "Next Action":"Re-attempt contact", "Next Action Due Date":new Date(2026,6,8), "Assigned Owner":"Juan", "Blocker":"Seller Unresponsive", "Last Contact Date":new Date(2026,6,2), "Last Contact Result":"Offer sent; no reply since", "Created Date":new Date(2026,6,1), "Last Updated Date":new Date(2026,6,2), "Updated By":"Juan", "Source":"TEST", "REI Update Required":"Yes"},
  {"Property ID":"TEST-07", "Property Address":"700 Test Negotiation Rd, Testville, CA 90007", "Seller Name":"Neil Negotiate", "Phone":"(000) 000-0007", "Lead Source":"TV", "REI BlackBook Link":"https://app.reiblackbook.com/lead/test07", "Visit Date":new Date(2026,6,16), "Visit Status":"Completed", "Assigned Visitor":"Juan", "Visit Notes":"Seller countered.", "Seller Motivation":"Motivated but wants more money", "Approved Offer Amount":610000, "Offer Status":"Countered", "Offer Sent Date":new Date(2026,6,17), "Counteroffer Amount":660000, "Current Stage":"Active Negotiation", "Next Action":"Cherry/Juan decide counter response", "Next Action Due Date":new Date(2026,6,22), "Assigned Owner":"Cherry", "Blocker":"Price", "Last Contact Date":new Date(2026,6,21), "Last Contact Result":"Seller countered at $660k", "Created Date":new Date(2026,6,16), "Last Updated Date":new Date(2026,6,21), "Updated By":"Cherry", "Source":"TEST", "REI Update Required":"Yes"},
  {"Property ID":"TEST-08", "Property Address":"700 Test Negotiation Rd., Testville, CA 90007", "Seller Name":"Duplicate Entry", "Phone":"(000) 000-0008", "Lead Source":"TV", "REI BlackBook Link":"https://app.reiblackbook.com/lead/test08", "Visit Date":new Date(2026,6,16), "Visit Status":"Scheduled", "Assigned Visitor":"Juan", "Current Stage":"Visit Scheduled", "Next Action":"Verify duplicate", "Next Action Due Date":new Date(2026,6,23), "Assigned Owner":"Cherry", "Created Date":new Date(2026,6,16), "Last Updated Date":new Date(2026,6,16), "Updated By":"Cherry", "Source":"TEST", "REI Update Required":"Yes"},
  {"Property ID":"TEST-09", "Property Address":"900 Test Revival Dr, Testville, CA 90009", "Seller Name":"Rita Revival", "Phone":"(000) 000-0009", "Lead Source":"Direct Mail", "REI BlackBook Link":"https://app.reiblackbook.com/lead/test09", "Visit Date":new Date(2026,3,1), "Visit Status":"Completed", "Assigned Visitor":"Juan", "Visit Notes":"Passed in spring; seller wanted more than numbers allowed.", "Seller Motivation":"Was motivated; timing/price gap at the time", "Current Stage":"Lost / Closed Out", "Final Disposition":"Lost", "Closeout Reason":"Seller Rejected Offer — price gap (revisit later)", "Last Contact Date":new Date(2026,3,3), "Last Contact Result":"Seller declined; open to future contact", "Created Date":new Date(2026,3,1), "Last Updated Date":new Date(2026,3,3), "Updated By":"Cherry", "Source":"TEST"}
];

function loadPilotData() {
  const sh = dataSheet_();
  if (!sh) { SpreadsheetApp.getUi().alert('Run "Build structure (setup)" first.'); return; }
  const start = CFG.FIRST_DATA_ROW;
  var skipped = [];
  SEED.forEach(function(rec, i){
    const row = start + i;
    Object.keys(rec).forEach(function(h){
      try { sh.getRange(row, col(h)).setValue(rec[h]); }
      catch (e) { skipped.push(rec['Property ID'] + '/' + h); }  // never let one cell abort the load
    });
  });
  SpreadsheetApp.flush();
  const msg = SEED.length + ' pilot + test rows loaded.' + (skipped.length ? ' Skipped: ' + skipped.join(', ') : '');
  SpreadsheetApp.getActive().toast(msg + ' Check the Cherry Opportunity Board.', 'Twin Visit Logger', 8);
}

/**
 * Remove ONLY Source=TEST records (demo + harness rows), in place. Does NOT delete sheet
 * rows and does NOT affect formulas/validation/formatting — each matching row is cleared and
 * its computed formulas restored via clearRecordRow_. Real pilot rows (Source=Import) are kept.
 */
function removeTestData() {
  const sh = dataSheet_();
  if (!sh) return;
  const src = sh.getRange(CFG.FIRST_DATA_ROW, col('Source'), CFG.MAX_ROWS - 1, 1).getValues();
  var n = 0;
  for (var i = 0; i < src.length; i++) {
    if (String(src[i][0]).trim() === 'TEST') { clearRecordRow_(sh, CFG.FIRST_DATA_ROW + i); n++; }
  }
  SpreadsheetApp.getActive().toast('Removed ' + n + ' Source=TEST records (rows, formulas, validation & formatting preserved).', 'Twin Visit Logger', 7);
}

/**
 * Full go-live cleanup of test artifacts. Safe: preserves the grid, formulas, validation and
 * conditional formatting; keeps the Test Results sheet.
 *   1. Archives the Source=TEST rows into the Test Data sheet (static values).
 *   2. Clears those rows IN PLACE in Data (formulas restored) — no row deletion.
 *   3. Removes TEST / TEST-A tasks from Task Queue (a plain log sheet).
 *   4. Removes TEST / TEST-A entries from Automation Log.
 *   5. Leaves Test Results intact.
 */
function removeTestArtifacts() {
  const ss = SpreadsheetApp.getActive();
  const sh = dataSheet_();
  if (!sh) return;
  const disp = ['Property ID','Property Address','Seller Name','Current Stage','Assigned Owner',
                'Next Action Due Date','Days Overdue','Stalled Status','Data Quality Status','Exception Reason'];
  const all = sh.getRange(CFG.FIRST_DATA_ROW, 1, CFG.MAX_ROWS - 1, HEADERS.length).getValues();
  const si = col('Source') - 1, ai = col('Property Address') - 1;
  const archive = [], clearRows = [];
  for (var i = 0; i < all.length; i++) {
    if (all[i][ai] && String(all[i][si]).trim() === 'TEST') {
      archive.push(disp.map(function(h){ return all[i][col(h) - 1]; }));
      clearRows.push(CFG.FIRST_DATA_ROW + i);
    }
  }
  // 1. archive to Test Data (static)
  const td = ensureSheet_(ss, CFG.TEST_DATA_SHEET);
  td.clear(); td.setTabColor('#999999');
  td.getRange(1,1).setValue('Test Data — archived Source=TEST demo records (isolated from all live views)').setFontWeight('bold').setFontSize(12);
  td.getRange(3,1,1,disp.length).setValues([disp]).setFontWeight('bold').setBackground('#ddebf7');
  if (archive.length) td.getRange(4,1,archive.length,disp.length).setValues(archive);
  else td.getRange(4,1).setValue('— none —');
  td.getRange(1,6,td.getMaxRows(),1).setNumberFormat('yyyy-mm-dd');
  td.getRange(1,7,td.getMaxRows(),1).setNumberFormat('0');
  // 2. clear in place (formulas restored; grid unchanged)
  clearRows.forEach(function(r){ clearRecordRow_(sh, r); });
  // 3 & 4. purge TEST/TEST-A from the log sheets (safe row deletes — not the Data grid)
  const tq = removeRowsByPrefix_(ss, CFG.TASK_QUEUE_SHEET, 3, 'TEST');
  const al = removeRowsByPrefix_(ss, 'Automation Log', 3, 'TEST');
  SpreadsheetApp.getActive().toast(
    'Removed ' + clearRows.length + ' TEST data rows (archived to Test Data), ' + tq + ' Task Queue + ' + al +
    ' Automation Log entries. Test Results kept. Grid rows: ' + sh.getMaxRows() + ' (unchanged).',
    'removeTestArtifacts', 12);
}

/** Delete rows from a plain LOG sheet where column idCol starts with prefix. Returns count. */
function removeRowsByPrefix_(ss, sheetName, idCol, prefix) {
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return 0;
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const vals = sh.getRange(2, idCol, last - 1, 1).getValues();
  var removed = 0;
  for (var r = last; r >= 2; r--) {                 // bottom-up so indices stay valid
    if (String(vals[r - 2][0]).indexOf(prefix) === 0) { sh.deleteRow(r); removed++; }
  }
  return removed;
}

/** Clears data values from row 2 down (keeps headers + formula columns' formulas). */
function clearAllData() {
  const sh = dataSheet_();
  const last = Math.max(sh.getLastRow(), CFG.FIRST_DATA_ROW);
  const nonFormula = [];
  for (var i = 0; i < HEADERS.length; i++) if (COMPUTED_HEADERS.indexOf(HEADERS[i]) < 0) nonFormula.push(i + 1);
  nonFormula.forEach(function(c){ sh.getRange(CFG.FIRST_DATA_ROW, c, last - 1, 1).clearContent(); });
  SpreadsheetApp.getActive().toast('Data rows cleared (headers + formulas kept).', 'Twin Visit Logger', 6);
}
