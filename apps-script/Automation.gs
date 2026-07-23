/**
 * Twin Visit Logger — Phase 3 automation (event + time driven).
 *
 * SAFETY: This NEVER sends a message to a seller. All "notifications" are internal
 * (a row in the Automation Log sheet and/or an email to internal staff only).
 *
 * Install triggers with installTriggers() (see Deployment-Guide.md):
 *   - onEditInstallable  -> from spreadsheet "On edit"
 *   - checkNoDecision    -> time-driven, every 1 hour (business-day aware)
 *   - checkStalled       -> time-driven, daily
 *   - sendDailyReport    -> time-driven, daily on business days
 */

function installTriggers() {
  const ss = SpreadsheetApp.getActive();
  removeAllTriggers();  // clear existing project triggers to avoid duplicates
  ScriptApp.newTrigger('onEditInstallable').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('checkNoDecision').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('checkStalled').timeBased().everyDays(1).atHour(6).create();
  ScriptApp.newTrigger('sendDailyReport').timeBased().everyDays(1).atHour(7).create();
  SpreadsheetApp.getActive().toast('Automation triggers installed.', 'Twin Visit Logger', 6);
}

/** KILL SWITCH: remove every trigger this project installed. Data is untouched. */
function removeAllTriggers() {
  const t = ScriptApp.getProjectTriggers();
  t.forEach(function(x){ ScriptApp.deleteTrigger(x); });
  try { SpreadsheetApp.getActive().toast('All ' + t.length + ' triggers removed.', 'Twin Visit Logger', 6); } catch (e) {}
}

/* ---------------------------- edit-driven ---------------------------- */

function onEditInstallable(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (sh.getName() !== CFG.DATA_SHEET) return;
    const row = e.range.getRow();
    if (row < CFG.FIRST_DATA_ROW) return;
    const editedCol = e.range.getColumn();
    const R = new RowAccessor_(sh, row);
    if (!R.get('Property Address')) return; // ignore blank rows

    const header = HEADERS[editedCol - 1];
    stamp_(R); // Last Updated Date / Updated By

    switch (header) {
      case 'Visit Status':        onVisitStatus_(R); break;
      case 'Approved Offer Amount': onOfferApproved_(R); break;
      case 'Offer Sent Date':     onOfferSent_(R); break;
      case 'Counteroffer Amount': onSellerCounter_(R); break;
      case 'Offer Status':        if (R.get('Offer Status') === 'Countered') onSellerCounter_(R);
                                  else if (R.get('Offer Status') === 'Accepted') onVerbalAgreement_(R); break;
      case 'Contract Sent Date':  onContractSent_(R); break;
      case 'Contract Signed Date':onContractSigned_(R); break;
      case 'Gift Status':         if (R.get('Gift Status') === 'Recommended') onGiftRecommended_(R); break;
      case 'Current Stage':       onStageManual_(R); break;
    }
    R.flush();
  } catch (err) {
    logAuto_('ERROR', 'onEdit', String(err));
  }
}

function onVisitStatus_(R) {
  const v = R.get('Visit Status');
  if (v === 'Scheduled') {
    R.setIfBlank('Current Stage', 'Visit Scheduled');
    R.setIfBlank('Next Action', 'Conduct scheduled visit & log outcome');
    R.setIfBlank('Next Action Due Date', R.get('Visit Date') || today_());
    if (isDuplicateActive_(R)) logAuto_('WARN', R.get('Property ID'), 'Possible duplicate active record for this address');
    // Real reminder: a Task Queue item (not just a log line) for the visitor, due on the visit date.
    var visitor = R.get('Assigned Visitor') || R.get('Assigned Owner') || 'Juan';
    enqueueTask_(visitor, R.get('Property ID'), R.get('Property Address'),
      'Scheduled-visit reminder — conduct visit & log outcome', R.get('Visit Date') || today_());
    logAuto_('INFO', R.get('Property ID'), 'Visit scheduled; reminder queued for ' + visitor + ' due ' + fmt_(R.get('Visit Date')));
  } else if (v === 'Completed') {
    R.set('Current Stage', 'Visit Completed — Needs Review');
    R.setIfBlank('Assigned Owner', 'Jonathan');
    R.set('Next Action Due Date', today_());          // same-day review
    R.setIfBlank('Next Action', 'Review completed visit: make offer or pass');
    if (!R.get('Visit Notes')) logAuto_('EXCEPTION', R.get('Property ID'), 'Completed visit missing Visit Notes');
    enqueueTask_('Jonathan', R.get('Property ID'), R.get('Property Address'), 'Review completed visit: make offer or pass', today_());
    logAuto_('TASK', R.get('Property ID'), 'Review task -> Jonathan (same-day)');
  }
}

function onOfferApproved_(R) {
  if (!R.get('Approved Offer Amount')) return;
  R.set('Current Stage', 'Offer Preparation');
  R.set('Assigned Owner', 'Kyle');
  R.setIfBlank('Offer Status', 'In Preparation');
  R.set('Next Action', 'Prepare offer (' + money_(R.get('Approved Offer Amount')) + ')');
  R.setIfBlank('Next Action Due Date', addBiz_(today_(), 1));
  enqueueTask_('Kyle', R.get('Property ID'), R.get('Property Address'),
    'Prepare offer (' + money_(R.get('Approved Offer Amount')) + ') — REI ' + (R.get('REI BlackBook Link') || 'n/a'),
    R.get('Next Action Due Date'));
  logAuto_('TASK', R.get('Property ID'),
    'Offer-prep -> Kyle | ' + R.get('Property Address') + ' | ' + money_(R.get('Approved Offer Amount')) +
    ' | due ' + fmt_(R.get('Next Action Due Date')) + ' | REI ' + (R.get('REI BlackBook Link') || 'n/a'));
}

function onOfferSent_(R) {
  if (!R.get('Offer Sent Date')) return;
  R.set('Current Stage', 'Offer Sent');
  R.setIfBlank('Offer Status', 'Sent');
  R.set('Next Action', 'Confirm seller received offer, then follow up');
  R.set('Next Action Due Date', addBiz_(R.get('Offer Sent Date'), 2));
  R.setIfBlank('Assigned Owner', 'Cherry');
  enqueueTask_(R.get('Assigned Owner') || 'Cherry', R.get('Property ID'), R.get('Property Address'),
    'Follow up on sent offer', R.get('Next Action Due Date'));
  logAuto_('TASK', R.get('Property ID'), 'Offer follow-up scheduled ' + fmt_(R.get('Next Action Due Date')));
}

function onSellerCounter_(R) {
  R.set('Current Stage', 'Active Negotiation');
  R.setIfBlank('Assigned Owner', 'Cherry');
  R.setIfBlank('Next Action', 'Decide response to seller counter');
  R.setIfBlank('Next Action Due Date', addBiz_(today_(), 1));
  enqueueTask_(R.get('Assigned Owner') || 'Cherry', R.get('Property ID'), R.get('Property Address'),
    'Negotiation decision — respond to seller counter (needs Last Contact Result + Next Action + Owner + Due)', R.get('Next Action Due Date'));
  logAuto_('NOTIFY', R.get('Property ID'), 'Negotiation: notify Cherry/Juan. Requires Last Contact Result + Next Action + Owner + Due.');
}

function onVerbalAgreement_(R) {
  R.set('Current Stage', 'Verbal Agreement');
  R.set('Assigned Owner', 'Kyle');
  R.set('Next Action', 'Prepare purchase contract');
  R.setIfBlank('Next Action Due Date', addBiz_(today_(), 1));
  enqueueTask_('Kyle', R.get('Property ID'), R.get('Property Address'), 'HIGHEST PRIORITY: prepare purchase contract', R.get('Next Action Due Date'));
  logAuto_('TASK', R.get('Property ID'), 'HIGHEST PRIORITY: contract-prep -> Kyle');
}

function onContractSent_(R) {
  if (!R.get('Contract Sent Date')) return;
  R.set('Current Stage', 'Contract Sent');
  R.set('Next Action', 'Confirm signature (daily internal follow-up)');
  R.set('Next Action Due Date', addBiz_(today_(), 1));
  enqueueTask_(R.get('Assigned Owner') || 'Cherry', R.get('Property ID'), R.get('Property Address'),
    'Confirm signature — daily internal follow-up until signed/declined', R.get('Next Action Due Date'));
  logAuto_('TASK', R.get('Property ID'), 'Daily internal follow-up until signed/declined');
}

function onContractSigned_(R) {
  if (!R.get('Contract Signed Date')) return;
  R.set('Current Stage', 'Contract Signed');
  R.set('Final Disposition', 'Contracted');
  R.setIfBlank('Transaction Handoff Status', 'Ready for Handoff');
  R.set('Next Action', 'Hand off signed contract for transaction coordination');
  R.setIfBlank('Next Action Due Date', addBiz_(today_(), 1));
  R.set('REI Update Required', 'Yes');
  enqueueTask_('', R.get('Property ID'), R.get('Property Address'), 'Contract handoff — signed; also confirm REI BlackBook update', R.get('Next Action Due Date'));
  logAuto_('TASK', R.get('Property ID'), 'HANDOFF created; sales follow-up stopped; REI update required');
}

function onGiftRecommended_(R) {
  // Approval is recorded via Gift Approved By + Gift Approval Date; Gift Status=Sent stays an
  // Exception until both are filled (see Exception Reason rule 9). Nothing is purchased or sent.
  enqueueTask_('Kyle', R.get('Property ID'), R.get('Property Address'),
    'Coordinate gift review — requires Cherry/Juan approval (set Gift Approved By + Gift Approval Date). NO gift sent automatically.', '');
  logAuto_('TASK', R.get('Property ID'),
    'Gift review -> Kyle to coordinate; requires Cherry/Juan approval. NO gift purchased/sent automatically.');
}

function onStageManual_(R) {
  const s = R.get('Current Stage');
  if (s === 'Long-Term Nurture') {
    R.setIfBlank('Assigned Owner', 'Cherry');
    if (!R.get('Next Action Due Date') || R.get('Next Action Due Date') <= today_())
      logAuto_('EXCEPTION', R.get('Property ID'), 'Long-Term Nurture needs an exact FUTURE follow-up date');
  } else if (s === 'Lost / Closed Out') {
    if (!R.get('Final Disposition') || !R.get('Closeout Reason'))
      logAuto_('EXCEPTION', R.get('Property ID'), 'Lost / Closed Out needs Final Disposition + Closeout Reason');
    logAuto_('INFO', R.get('Property ID'), 'Closed: active follow-up stopped');
  } else if (s === 'Verbal Agreement') {
    onVerbalAgreement_(R);
  }
}

/* ---------------------------- time-driven ---------------------------- */

/** Completed visit with no offer/pass decision within 1 business day -> overdue + escalate to Cherry. */
function checkNoDecision() {
  eachDataRow_(function(R){
    if (R.get('Current Stage') !== 'Visit Completed — Needs Review') return;
    const visit = R.get('Visit Date') || R.get('Last Updated Date');
    if (!visit) return;
    if (bizDaysBetween_(visit, today_()) >= CFG.NO_DECISION_BUSINESS_DAYS) {
      if (R.get('Assigned Owner') !== 'Cherry' && !R.getNote('_escalated')) {
        enqueueTask_('Cherry', R.get('Property ID'), R.get('Property Address'),
          'ESCALATED: completed visit has no offer/pass decision after 1 business day (Jonathan still reviewer)', today_());
        logAuto_('ESCALATE', R.get('Property ID'), 'No offer decision > 1 business day; escalating to Cherry (kept Jonathan as reviewer)');
        R.setNote('_escalated', '1');
      }
      if (!R.get('Next Action Due Date') || R.get('Next Action Due Date') > today_()) R.set('Next Action Due Date', today_());
      R.flush();
    }
  });
}

/** No meaningful activity for 3 business days -> Stalled (formula sets flag); notify owner once. */
function checkStalled() {
  eachDataRow_(function(R){
    if (R.get('Stalled Status') === 'Yes' && !R.getNote('_stalled_notified')) {
      enqueueTask_(R.get('Assigned Owner') || 'Cherry', R.get('Property ID'), R.get('Property Address'),
        'STALLED > 3 business days — re-engage this deal', R.get('Next Action Due Date') || today_());
      logAuto_('NOTIFY', R.get('Property ID'), 'STALLED (>3 business days). Owner: ' + (R.get('Assigned Owner') || 'unassigned'));
      R.setNote('_stalled_notified', fmt_(today_()));
      R.flush();
    }
    if (R.get('Stalled Status') !== 'Yes' && R.getNote('_stalled_notified')) {
      R.setNote('_stalled_notified', ''); R.flush(); // reset when activity resumes
    }
  });
}

/* ---------------------------- helpers ---------------------------- */

function stamp_(R) {
  R.set('Last Updated Date', today_());
  var u = Session.getActiveUser().getEmail();
  R.set('Updated By', u ? u.split('@')[0] : 'Apps Script');
}

function isDuplicateActive_(R) {
  const sh = dataSheet_();
  const norm = String(R.get('Property Address') || '').toLowerCase().replace(/[,.#]/g,'').replace(/\s+/g,' ').trim();
  if (!norm) return false;
  const vals = sh.getRange(CFG.FIRST_DATA_ROW, col('Normalized Address'), CFG.MAX_ROWS, 1).getValues();
  const stages = sh.getRange(CFG.FIRST_DATA_ROW, col('Current Stage'), CFG.MAX_ROWS, 1).getValues();
  let count = 0;
  for (let i=0;i<vals.length;i++){ if (String(vals[i][0]).trim()===norm && stages[i][0] !== 'Lost / Closed Out') count++; }
  return count > 1;
}

function today_() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function daysAgo_(n) { const d = today_(); d.setDate(d.getDate() - n); return d; }
function fmt_(d) { return d ? Utilities.formatDate(new Date(d), Session.getScriptTimeZone(), 'yyyy-MM-dd') : ''; }
function money_(n) { return n ? '$' + Number(n).toLocaleString() : ''; }
function addBiz_(d, n) { let r = new Date(d); let added=0; while(added<n){ r.setDate(r.getDate()+1); const g=r.getDay(); if(g!==0&&g!==6) added++; } return new Date(r.getFullYear(),r.getMonth(),r.getDate()); }
function bizDaysBetween_(a, b) { a=new Date(a); b=new Date(b); let n=0; const s=new Date(a); while(s<b){ s.setDate(s.getDate()+1); const g=s.getDay(); if(g!==0&&g!==6) n++; } return n; }

function eachDataRow_(fn) {
  const sh = dataSheet_();
  const last = sh.getLastRow();
  for (let r = CFG.FIRST_DATA_ROW; r <= last; r++) {
    const R = new RowAccessor_(sh, r);
    if (R.get('Property Address')) fn(R);
  }
}

function logAuto_(level, id, msg) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName('Automation Log');
  if (!sh) { sh = ss.insertSheet('Automation Log'); sh.appendRow(['Timestamp','Level','Property ID','Message']); sh.hideSheet(); }
  sh.appendRow([new Date(), level, id, msg]);
}

/**
 * INTERNAL task delivery. Appends a visible row to the Task Queue sheet (the pilot task inbox)
 * and, only if an INTERNAL address is set in OWNER_EMAILS, emails that person. Never a seller.
 */
function enqueueTask_(owner, id, address, task, due) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(CFG.TASK_QUEUE_SHEET) || ensureTaskQueue_(ss);
  sh.appendRow([new Date(), owner || 'Unassigned', id || '', address || '', task || '', due ? fmt_(due) : '', 'Open']);
  const to = OWNER_EMAILS[owner];
  if (to) {
    try {
      MailApp.sendEmail({ to: to,
        subject: 'Twin Visit Logger task: ' + task + ' — ' + (address || id),
        body: 'Owner: ' + owner + '\nProperty: ' + (address || id) + '\nTask: ' + task +
              '\nDue: ' + (due ? fmt_(due) : '—') + '\n\n(Internal task only. No seller was contacted.)' });
    } catch (e) { logAuto_('ERROR', 'enqueueTask', String(e)); }
  }
}

/** Buffered row read/write to minimise Sheet calls. */
function RowAccessor_(sh, row) {
  this.sh = sh; this.row = row;
  this._vals = sh.getRange(row, 1, 1, HEADERS.length).getValues()[0];
  this._dirty = {};
  this.get = function(h){ return this._vals[col(h)-1]; };
  this.set = function(h,v){ this._vals[col(h)-1]=v; this._dirty[col(h)]=v; return this; };
  this.setIfBlank = function(h,v){ if(this.get(h)===''||this.get(h)==null) this.set(h,v); return this; };
  this.getNote = function(key){ const n=this.sh.getRange(this.row,1).getNote()||''; const m=n.match(new RegExp(key+'=([^;]*)')); return m?m[1]:''; };
  this.setNote = function(key,val){ let n=this.sh.getRange(this.row,1).getNote()||''; const re=new RegExp(key+'=[^;]*;?'); n=n.replace(re,''); if(val!=='') n+=key+'='+val+';'; this.sh.getRange(this.row,1).setNote(n); };
  this.flush = function(){ const cols=Object.keys(this._dirty); cols.forEach(function(c){ try { this.sh.getRange(this.row, Number(c)).setValue(this._dirty[c]); } catch(e){} }, this); this._dirty={}; };
}
