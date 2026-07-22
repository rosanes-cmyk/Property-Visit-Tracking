# Automation Rules — Twin Visit Logger (Phase 3, Apps Script)

**Files:** `apps-script/Config.gs`, `Setup.gs`, `Automation.gs`, `DailyReport.gs`, `Tests.gs`
**Golden safety rule:** the system **never** sends a message to a seller. Every "notification" is
internal only.

## Internal task delivery (pilot)
Every task the automation creates is delivered two ways, both internal:
- **Task Queue sheet** (visible): one row per task — `Created · Owner · Property ID · Address ·
  Task · Due · Status`. This is the team's pilot task inbox for Jonathan, Kyle, Cherry/Juan, JM.
- **Optional internal email** via `OWNER_EMAILS` in `Config.gs` (blank by default = Task Queue
  only). Set an owner's **internal** address to also email them their tasks. Never a seller address.
- The hidden **Automation Log** keeps a full audit trail of every automation action.

The **scheduled-visit reminder** is a real Task Queue item (due on the visit date) for the assigned
visitor — not just a log line.

## Trigger model
| Trigger | Type | Function |
|---|---|---|
| On edit | installable spreadsheet edit | `onEditInstallable` |
| No-decision check | time-driven, hourly | `checkNoDecision` |
| Stalled check | time-driven, daily 06:00 | `checkStalled` |
| Daily report | time-driven, daily 07:00 (business days) | `sendDailyReport` |

Install with `installTriggers()` after `setup()`.

## Edit-driven rules

| # | Trigger (field change) | Actions |
|---|---|---|
| 1 | **Visit Status → Scheduled** | Current Stage=Visit Scheduled · fill Next Action + Due (visit date) if blank · duplicate-active check → log warning · log reminder |
| 2 | **Visit Status → Completed** | Current Stage=Visit Completed — Needs Review · Assigned Owner=Jonathan (if blank) · Next Action Due=today (same-day review) · require Visit Notes (else Exception) · log review task |
| 3 | **Approved Offer Amount entered** | Current Stage=Offer Preparation · Assigned Owner=Kyle · Offer Status=In Preparation · Next Action="Prepare offer ($amount)" · Due=+1 business day · log offer-prep task w/ address+amount+due+REI link |
| 4 | **Offer Sent Date entered** | Current Stage=Offer Sent · Offer Status=Sent · Next Action=confirm receipt then follow up · Due=+2 business days · Owner=Cherry (if blank) · log follow-up |
| 5 | **Counteroffer Amount entered** *or* **Offer Status → Countered** | Current Stage=Active Negotiation · Owner=Cherry (if blank) · require Last Contact Result + Next Action + Owner + Due (else Exception) · log notify Cherry/Juan |
| 6 | **Offer Status → Accepted** *or* **Current Stage → Verbal Agreement** | Current Stage=Verbal Agreement · Owner=Kyle · Next Action=Prepare purchase contract · Due=+1 business day · log HIGHEST-PRIORITY contract-prep task |
| 7 | **Contract Sent Date entered** | Current Stage=Contract Sent · Next Action=confirm signature (daily internal follow-up) · Due=+1 business day · log daily follow-up until signed/declined |
| 8 | **Contract Signed Date entered** | Current Stage=Contract Signed · Final Disposition=Contracted · Transaction Handoff Status=Ready for Handoff · Owner=JM · Next Action=Hand off to JM · REI Update Required=Yes · sales follow-up stops · log JM handoff |
| 9 | **Current Stage → Long-Term Nurture** | Owner=Cherry (if blank) · require exact FUTURE follow-up date (else Exception) |
| 10 | **Current Stage → Lost / Closed Out** | require Final Disposition + Closeout Reason (else Exception) · active follow-up stops |
| 11 | **Gift Status → Recommended** | log gift-review task → Kyle to coordinate · requires Cherry/Juan approval · **no gift purchased or sent** |
| — | **any edit** | stamp Last Updated Date + Updated By |

## Time-driven rules

| # | Rule | Logic |
|---|---|---|
| 12 | **No offer decision** (`checkNoDecision`, hourly) | If Visit Completed — Needs Review and ≥1 business day old: force Due=today, escalate to Cherry once (keep Jonathan as reviewer), log ESCALATE. Duplicate-alert-safe via a per-row note marker. |
| 13 | **Stalled deal** (`checkStalled`, daily) | If Stalled Status=Yes and not already notified: log NOTIFY to owner; set a note marker to avoid repeat daily alerts; clear the marker when activity resumes. |
| 14 | **Daily Opportunity Report** (`sendDailyReport`, business days 07:00) | Build the 10 sections; email to `CFG.REPORT_TO` if set (internal), always write the "Daily Report" sheet. Skips empty report unless configured otherwise. |

## Validation rules (formula-enforced, always on)
Evaluated live in `Exception Reason`; any non-empty result ⇒ Data Quality Status = Exception.
Required-field blanks (active records) ⇒ Incomplete.

1. Completed visit ⇒ Visit Notes
2. Completed visit ⇒ Seller Motivation (or Exception note)
3. Offer Sent ⇒ Approved Offer Amount + Offer Sent Date
4. Active Negotiation ⇒ Last Contact Result + Next Action + Owner + Due Date
5. Contract Sent ⇒ Contract Sent Date or File Link
6. Contract Signed ⇒ Contract Signed Date
7. Long-Term Nurture ⇒ exact future follow-up date
8. Lost / Closed Out ⇒ Final Disposition + Closeout Reason
9. Gift Sent ⇒ prior approval recorded (**Gift Approved By** + **Gift Approval Date**)
10. One active record per Normalized Address (Duplicate Address Flag)
11. Unclear records → Exception Queue (via Incomplete/Exception status)
12. No record is "complete" while required fields are blank

## REI BlackBook handling
REI BlackBook remains the source of truth. No API / browser automation is built (per instruction).
Instead: keep the direct **REI BlackBook Link**; **REI Update Required** / **REI Update Completed**
flags track manual CRM updates; Contract Signed sets REI Update Required=Yes; unresolved updates
(Required=Yes, Completed≠Yes) surface via the Exception/Daily Report layer.

## Scope / safety
- Automation is written to run on the pilot rows first; it does not bulk-process the 370 legacy
  rows (those live in `Legacy Pipeline (archive)`).
- All handlers are wrapped in try/catch and log errors to the Automation Log.
