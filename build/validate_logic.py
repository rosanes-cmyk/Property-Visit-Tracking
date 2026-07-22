#!/usr/bin/env python3
"""
Phase 2 validation WITHOUT a spreadsheet engine (LibreOffice needs Java, absent here).

Two independent checks:
  A. Static lint of every formula string in build_workbook.COLUMNS
     (balanced parentheses, balanced double-quotes).
  B. A reference re-implementation of the SAME business rules in Python, computing
     each formula column for all 18 pilot+test records, plus assertions on the
     expected outcomes. This verifies the LOGIC; Google Sheets performs the real
     recalculation on deployment.

Evaluation date is pinned to 2026-07-22 (today, per project context) for determinism.
"""
import datetime
from build_workbook import COLUMNS, PILOT, TEST, ALL_RECORDS, DROPDOWNS

EVAL = datetime.date(2026, 7, 22)


# ----------------------------- A. formula lint -----------------------------
def lint():
    problems = []
    for group, header, dd, fx in COLUMNS:
        if not fx:
            continue
        depth = 0
        for ch in fx:
            if ch == '(':
                depth += 1
            elif ch == ')':
                depth -= 1
                if depth < 0:
                    problems.append((header, 'unbalanced )'))
                    break
        if depth != 0:
            problems.append((header, f'paren depth ends at {depth}'))
        if fx.count('"') % 2 != 0:
            problems.append((header, 'odd number of double-quotes'))
    return problems


# --------------------------- B. reference logic ----------------------------
def d(v):
    return v.date() if isinstance(v, datetime.datetime) else v

def norm(addr):
    if not addr:
        return ''
    s = addr.lower()
    for ch in [',', '.', '#']:
        s = s.replace(ch, '')
    s = s.replace(' apt ', ' ').replace(' unit ', ' ')
    while '  ' in s:
        s = s.replace('  ', ' ')
    return s.strip()

def bizdays(a, b):
    """networkdays(a,b)-1 : business days strictly between, matching formula."""
    if not a or not b:
        return None
    a, b = d(a), d(b)
    if a > b:
        return 0
    n = 0
    cur = a
    while cur < b:
        cur += datetime.timedelta(days=1)
        if cur.weekday() < 5:
            n += 1
    return n

CLOSED_STAGES = {'Lost / Closed Out', 'Long-Term Nurture', 'Contract Signed'}

def compute(rec, all_norms_active):
    g = lambda h: rec.get(h, '')
    addr = g('Property Address')
    out = {}
    out['Normalized Address'] = norm(addr)
    acts = [d(x) for x in [g('Last Contact Date'), g('Last Updated Date'), g('Visit Date')] if x]
    last_act = max(acts) if acts else None
    out['Days Since Last Activity'] = (EVAL - last_act).days if last_act else ''
    due = d(g('Next Action Due Date')) if g('Next Action Due Date') else None
    out['Days Overdue'] = max(0, (EVAL - due).days) if due else ''
    # stalled
    stage = g('Current Stage')
    if stage in CLOSED_STAGES or not last_act:
        out['Stalled Status'] = 'No'
    else:
        out['Stalled Status'] = 'Yes' if bizdays(last_act, EVAL) >= 3 else 'No'
    # missing required
    req = [('Property Address', addr), ('Current Stage', stage), ('Next Action', g('Next Action')),
           ('Next Action Due Date', g('Next Action Due Date')), ('Assigned Owner', g('Assigned Owner')),
           ('REI BlackBook Link', g('REI BlackBook Link'))]
    # required-field check applies to ACTIVE records only (Lost / Closed Out is exempt)
    out['Missing Required Fields'] = '' if stage == 'Lost / Closed Out' else ', '.join(name for name, val in req if not val)
    # duplicate
    out['Duplicate Address Flag'] = 'Duplicate' if all_norms_active.count(out['Normalized Address']) > 1 and out['Normalized Address'] else ''
    # priority
    base = {'Verbal Agreement':100,'Contract Sent':95,'Active Negotiation':85,'Offer Sent':70,
            'Offer Preparation':60,'Visit Completed — Needs Review':50,'Visit Scheduled':30,
            'Long-Term Nurture':10,'Contract Signed':5}.get(stage, 0)
    ov = out['Days Overdue'] if out['Days Overdue'] != '' else 0
    out['Opportunity Priority'] = base + min(ov, 20) + (5 if out['Stalled Status'] == 'Yes' else 0)
    # exception reason (rules 1-10)
    ex = []
    vs = g('Visit Status')
    if vs == 'Completed' and not g('Visit Notes'): ex.append('Completed visit missing Visit Notes')
    if vs == 'Completed' and not g('Seller Motivation'): ex.append('Completed visit missing Seller Motivation')
    if stage == 'Offer Sent' and (not g('Approved Offer Amount') or not g('Offer Sent Date')):
        ex.append('Offer Sent needs Approved Offer Amount + Offer Sent Date')
    if stage == 'Active Negotiation' and (not g('Last Contact Result') or not g('Next Action') or not g('Assigned Owner') or not g('Next Action Due Date')):
        ex.append('Active Negotiation needs LCR + Next Action + Owner + Due')
    if stage == 'Contract Sent' and not g('Contract Sent Date') and not g('File Link'):
        ex.append('Contract Sent needs Contract Sent Date or File Link')
    if stage == 'Contract Signed' and not g('Contract Signed Date'):
        ex.append('Contract Signed needs Contract Signed Date')
    if stage == 'Long-Term Nurture' and (not due or due <= EVAL):
        ex.append('Long-Term Nurture needs a FUTURE follow-up date')
    if stage == 'Lost / Closed Out' and (not g('Final Disposition') or not g('Closeout Reason')):
        ex.append('Lost / Closed Out needs Final Disposition + Closeout Reason')
    if g('Gift Status') == 'Sent' and (not g('Gift Approved By') or not g('Gift Approval Date')):
        ex.append('Gift Sent without approval')
    if out['Duplicate Address Flag'] == 'Duplicate':
        ex.append('Duplicate active record')
    out['Exception Reason'] = ' | '.join(ex)
    # data quality
    if not addr:
        out['Data Quality Status'] = ''
    elif out['Exception Reason']:
        out['Data Quality Status'] = 'Exception'
    elif out['Missing Required Fields']:
        out['Data Quality Status'] = 'Incomplete'
    else:
        out['Data Quality Status'] = 'OK'
    return out


def run():
    print('=== A. FORMULA LINT ===')
    probs = lint()
    if not probs:
        n = sum(1 for c in COLUMNS if c[3])
        print(f'  PASS — {n} formula columns, all parentheses & quotes balanced.')
    else:
        for h, p in probs:
            print(f'  FAIL — {h}: {p}')

    print('\n=== B. COMPUTED VALUES (eval date 2026-07-22) ===')
    active_norms = [norm(r.get('Property Address','')) for r in ALL_RECORDS
                    if r.get('Current Stage') != 'Lost / Closed Out' and r.get('Property Address')]
    results = []
    for rec in ALL_RECORDS:
        c = compute(rec, active_norms)
        results.append((rec.get('Property ID'), rec.get('Current Stage'), c))
    hdr = f"{'ID':9} {'Stage':30} {'DQ':11} {'Ovd':4} {'Stall':5} {'Dup':10} Exception/Missing"
    print(hdr); print('-'*len(hdr))
    for pid, stage, c in results:
        note = c['Exception Reason'] or c['Missing Required Fields'] or ''
        print(f"{pid:9} {str(stage)[:30]:30} {c['Data Quality Status']:11} {str(c['Days Overdue']):4} {c['Stalled Status']:5} {c['Duplicate Address Flag']:10} {note[:60]}")

    print('\n=== C. ASSERTIONS ===')
    idx = {pid: c for pid, _, c in results}
    checks = [
        ('TVL-0001 Incomplete (no REI link)', idx['TVL-0001']['Data Quality Status'] == 'Incomplete'),
        ('TVL-0003 Carmen Offer Sent -> Exception (no amount/date)', idx['TVL-0003']['Data Quality Status'] == 'Exception'),
        ('TVL-0009 James Offer Sent -> Exception (no amount/date)', idx['TVL-0009']['Data Quality Status'] == 'Exception'),
        ('TVL-0004 Dorol Lost -> OK (closed exempt from required)', idx['TVL-0004']['Data Quality Status'] == 'OK'),
        ('TEST-09 dormant Lost -> Revival (>=45d since activity)', idx['TEST-09']['Days Since Last Activity'] >= 45),
        ('TEST-01 Verbal Agreement priority = 100', idx['TEST-01']['Opportunity Priority'] >= 100),
        ('TEST-03 Contract Signed -> OK', idx['TEST-03']['Data Quality Status'] == 'OK'),
        ('TEST-06 Offer Sent stalled = Yes', idx['TEST-06']['Stalled Status'] == 'Yes'),
        ('TEST-07 & TEST-08 duplicate flagged', idx['TEST-07']['Duplicate Address Flag'] == 'Duplicate' and idx['TEST-08']['Duplicate Address Flag'] == 'Duplicate'),
        ('TEST-05 Nurture future date -> OK', idx['TEST-05']['Data Quality Status'] == 'OK'),
    ]
    allok = True
    for name, ok in checks:
        print(f"  {'PASS' if ok else 'FAIL'} — {name}")
        allok = allok and ok
    print('\nRESULT:', 'ALL PASS' if (allok and not probs) else 'SEE FAILURES ABOVE')
    return allok and not probs


if __name__ == '__main__':
    import sys
    sys.path.insert(0, '/home/user/Property-Visit-Tracking/build')
    ok = run()
    sys.exit(0 if ok else 1)
