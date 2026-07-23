'use client';
import { useEffect, useState, useCallback } from 'react';
import { useSession, signOut } from 'next-auth/react';

const todayStr = () => new Date().toISOString().slice(0, 10);

function cls(r) {
  if (r.daysOverdue > 0) return 'card overdue';
  if (r.stalled) return 'card stalled';
  if (r.dq === 'Exception' || r.dq === 'Incomplete') return 'card exc';
  if (r.stage === 'Contract Signed') return 'card ok';
  return 'card';
}

// Which quick-actions apply to a record, by stage.
function actionsFor(r) {
  const a = [];
  if (r.visitStatus !== 'Completed' && r.stage === 'Visit Scheduled') a.push(['visitCompleted', 'Mark visit completed', true]);
  if (r.stage === 'Visit Completed — Needs Review') { a.push(['recordOfferSent', 'Record offer sent', true]); a.push(['nurture', 'Move to nurture', false]); }
  if (r.stage === 'Offer Sent') { a.push(['logContact', 'Log follow-up', true]); a.push(['sellerCounter', 'Seller countered', false]); a.push(['contractSent', 'Contract sent', false]); }
  if (r.stage === 'Active Negotiation') { a.push(['logContact', 'Log follow-up', true]); a.push(['contractSent', 'Contract sent', false]); }
  if (r.stage === 'Verbal Agreement' || r.stage === 'Contract Sent') { a.push(['contractSigned', 'Contract signed', true]); a.push(['logContact', 'Log follow-up', false]); }
  a.push(['setNextAction', 'Set next action', false]);
  return a;
}

// Field prompts for each action (rendered in the modal).
const ACTION_FIELDS = {
  recordOfferSent: [['amount', 'Approved offer amount', 'number', true], ['date', 'Offer sent date', 'date', true]],
  sellerCounter: [['amount', 'Counteroffer amount', 'number', true], ['result', 'What the seller said', 'text', false]],
  contractSent: [['date', 'Contract sent date', 'date', true]],
  contractSigned: [['date', 'Contract signed date', 'date', true]],
  logContact: [['result', 'Result of contact', 'text', true], ['nextAction', 'Next action', 'text', false], ['due', 'Next action due date', 'date', false]],
  nurture: [['due', 'Future follow-up date', 'date', true], ['nextAction', 'Next action', 'text', false]],
  setNextAction: [['nextAction', 'Next action', 'text', true], ['due', 'Due date', 'date', false], ['owner', 'Assigned owner', 'owner', false]],
};

export default function Dashboard() {
  const { data: session } = useSession();
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('all');
  const [owner, setOwner] = useState('');
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState(null); // {action, id, seller} or {add:true}

  const load = useCallback(async () => {
    const res = await fetch('/api/data', { cache: 'no-store' });
    const j = await res.json();
    if (j.ok) setData(j.data); else setToast('Error: ' + (j.error || 'load failed'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2800); };

  async function runAction(action, id, params) {
    flash('Saving…');
    const res = await fetch('/api/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id, params }),
    });
    const j = await res.json();
    if (j.ok) { setData(j.data); flash('Saved ✔'); } else { flash('Error: ' + (j.error || 'action failed')); }
    setModal(null);
  }

  if (!data) return <div className="center"><div>Loading live data…</div></div>;

  const owners = data.owners || [];
  const keep = (r) => {
    if (owner && r.owner !== owner) return false;
    if (filter === 'overdue') return r.daysOverdue > 0;
    if (filter === 'today') return r.due === todayStr();
    if (filter === 'stalled') return r.stalled;
    return true;
  };

  return (
    <>
      <div className="header">
        <div>
          <h1>🏠 Twin Visit Logger</h1>
          <div className="who">{data.generatedAt} · {data.totalLive} live records</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="who">{session?.user?.email}</span>
          <button onClick={() => signOut({ callbackUrl: '/signin' })}>Sign out</button>
        </div>
      </div>

      <div className="bar">
        {[['all', 'All'], ['today', 'Due Today'], ['overdue', 'Overdue'], ['stalled', 'Stalled']].map(([k, label]) => (
          <span key={k} className={'chip' + (filter === k ? ' on' : '')} onClick={() => setFilter(k)}>{label}</span>
        ))}
        <select value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">All owners</option>
          {owners.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <span className="chip" onClick={load}>↻ Refresh</span>
      </div>

      <div className="wrap">
        {(data.sections || []).map((s) => {
          const rows = s.rows.filter(keep);
          if (!rows.length && filter !== 'all') return null;
          return (
            <div key={s.title}>
              <div className="sec">{s.title}<span className="n">{rows.length}</span></div>
              {rows.length === 0 ? <div className="empty">— none —</div> : (
                <div className="grid">
                  {rows.map((r) => (
                    <div key={r.id + r.rowNum} className={cls(r)}>
                      <div className="top">
                        <div>
                          <div className="seller">{r.seller || '(no name)'}</div>
                          <div className="addr">{r.address}</div>
                        </div>
                        <div className="stg">{r.stage || '—'}</div>
                      </div>
                      <div className="meta">
                        <span>👤 <b>{r.owner || '—'}</b></span>
                        <span className={'due' + (r.daysOverdue > 0 ? ' od' : '')}>📅 {r.due || '—'}{r.daysOverdue > 0 ? ` (${r.daysOverdue}d over)` : ''}</span>
                        {r.blocker ? <span>⛔ {r.blocker}</span> : null}
                        {r.stalled ? <span>🟠 stalled</span> : null}
                      </div>
                      {r.nextAction ? <div className="na">➡ {r.nextAction}</div> : null}
                      {r.lastResult ? <div className="na" style={{ color: '#666' }}>🗒 {r.lastResult}</div> : null}
                      {(r.exceptionReason || r.missing) ? <div className="flag">⚠ {r.exceptionReason || ('Missing: ' + r.missing)}</div> : null}
                      <div className="acts">
                        {r.rei ? <a className="rei" href={r.rei} target="_blank" rel="noreferrer">REI ↗</a> : null}
                        {actionsFor(r).map(([act, label, primary]) => (
                          <button key={act} className={'act' + (primary ? ' p' : '')}
                            onClick={() => (ACTION_FIELDS[act] ? setModal({ action: act, id: r.id, seller: r.seller }) : runAction(act, r.id, {}))}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button className="fab" onClick={() => setModal({ add: true })}>＋ Add property</button>
      {toast ? <div id="toast">{toast}</div> : null}

      {modal && modal.add ? <AddModal owners={owners} onClose={() => setModal(null)} onSave={(p) => runAction('addRecord', null, p)} /> : null}
      {modal && modal.action ? (
        <ActionModal m={modal} owners={owners}
          onClose={() => setModal(null)}
          onSave={(params) => runAction(modal.action, modal.id, params)} />
      ) : null}
    </>
  );
}

const STAGES = ['Visit Scheduled', 'Visit Completed — Needs Review', 'Offer Preparation', 'Offer Sent', 'Active Negotiation', 'Verbal Agreement', 'Contract Sent', 'Contract Signed', 'Long-Term Nurture', 'Lost / Closed Out'];
const LEAD_SOURCES = ['Direct Mail', 'Direct Mail - Postcard', 'PPC', 'TV', 'Facebook', 'SEO', 'PPL - Property Leads', 'PPL - Motivated Leads'];
const VISIT_STATUS = ['Scheduled', 'Completed', 'Canceled', 'Reschedule Needed'];

function Field({ label, children }) {
  return <div className="field"><label>{label}</label>{children}</div>;
}

function ActionModal({ m, owners, onClose, onSave }) {
  const fields = ACTION_FIELDS[m.action] || [];
  const [vals, setVals] = useState(() => {
    const v = {}; fields.forEach(([k, , type]) => { v[k] = type === 'date' ? todayStr() : ''; }); return v;
  });
  const titleMap = {
    recordOfferSent: 'Record offer sent', sellerCounter: 'Seller countered', contractSent: 'Contract sent',
    contractSigned: 'Contract signed', logContact: 'Log follow-up', nurture: 'Move to long-term nurture', setNextAction: 'Set next action',
  };
  const set = (k, v) => setVals((p) => ({ ...p, [k]: v }));
  const missingReq = fields.some(([k, , , req]) => req && !String(vals[k] || '').trim());
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{titleMap[m.action] || m.action}{m.seller ? ' — ' + m.seller : ''}</h3>
        {fields.map(([k, label, type, req]) => (
          <Field key={k} label={label + (req ? ' *' : '')}>
            {type === 'owner'
              ? <select value={vals[k]} onChange={(e) => set(k, e.target.value)}><option value="">(keep current)</option>{owners.map((o) => <option key={o} value={o}>{o}</option>)}</select>
              : <input type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'} value={vals[k]} onChange={(e) => set(k, e.target.value)} />}
          </Field>
        ))}
        <div className="actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn p" disabled={missingReq} onClick={() => onSave(vals)}>Save</button>
        </div>
      </div>
    </div>
  );
}

function AddModal({ owners, onClose, onSave }) {
  const [v, setV] = useState({
    'Property Address': '', 'Seller Name': '', 'Phone': '', 'Email': '', 'Lead Source': 'PPL - Property Leads',
    'Visit Date': todayStr(), 'Visit Status': 'Scheduled', 'Assigned Visitor': '', 'Current Stage': 'Visit Scheduled',
    'Assigned Owner': '', 'Next Action': 'Conduct scheduled visit & log outcome', 'Next Action Due Date': todayStr(),
    'REI BlackBook Link': '', 'Visit Notes': '',
  });
  const set = (k, val) => setV((p) => ({ ...p, [k]: val }));
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Add a property visit</h3>
        <Field label="Property Address *"><input value={v['Property Address']} onChange={(e) => set('Property Address', e.target.value)} /></Field>
        <div className="row2">
          <Field label="Seller Name"><input value={v['Seller Name']} onChange={(e) => set('Seller Name', e.target.value)} /></Field>
          <Field label="Phone"><input value={v['Phone']} onChange={(e) => set('Phone', e.target.value)} /></Field>
        </div>
        <div className="row2">
          <Field label="Lead Source"><select value={v['Lead Source']} onChange={(e) => set('Lead Source', e.target.value)}>{LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="REI BlackBook Link"><input value={v['REI BlackBook Link']} onChange={(e) => set('REI BlackBook Link', e.target.value)} /></Field>
        </div>
        <div className="row2">
          <Field label="Visit Date"><input type="date" value={v['Visit Date']} onChange={(e) => set('Visit Date', e.target.value)} /></Field>
          <Field label="Visit Status"><select value={v['Visit Status']} onChange={(e) => set('Visit Status', e.target.value)}>{VISIT_STATUS.map((s) => <option key={s}>{s}</option>)}</select></Field>
        </div>
        <div className="row2">
          <Field label="Current Stage"><select value={v['Current Stage']} onChange={(e) => set('Current Stage', e.target.value)}>{STAGES.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Assigned Owner"><select value={v['Assigned Owner']} onChange={(e) => set('Assigned Owner', e.target.value)}><option value="">(none)</option>{owners.map((o) => <option key={o}>{o}</option>)}</select></Field>
        </div>
        <div className="row2">
          <Field label="Assigned Visitor"><input value={v['Assigned Visitor']} onChange={(e) => set('Assigned Visitor', e.target.value)} /></Field>
          <Field label="Next Action Due Date"><input type="date" value={v['Next Action Due Date']} onChange={(e) => set('Next Action Due Date', e.target.value)} /></Field>
        </div>
        <Field label="Next Action"><input value={v['Next Action']} onChange={(e) => set('Next Action', e.target.value)} /></Field>
        <Field label="Visit Notes"><textarea rows={2} value={v['Visit Notes']} onChange={(e) => set('Visit Notes', e.target.value)} /></Field>
        <div className="actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn p" disabled={!v['Property Address'].trim()} onClick={() => onSave(v)}>Add to sheet</button>
        </div>
      </div>
    </div>
  );
}
