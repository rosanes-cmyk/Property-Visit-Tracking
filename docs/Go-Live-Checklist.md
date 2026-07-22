# Go-Live Checklist — Twin Visit Logger

**Current status:** Phase 2 + Phase 3 **independently verified in the development copy** (30/30 tests
passed). **NOT yet fully operational.** The system becomes fully operational only when **both**:
1. the four REI BlackBook records below are completed, **and**
2. live automation triggers are installed successfully (steps 5–6).

> Do **not** invent or estimate the missing values — enter them from REI BlackBook.

**Prerequisite — complete these four records first (manual, from REI BlackBook):**
- **TVL-0001, TVL-0002** → add **REI BlackBook Link**
- **TVL-0003, TVL-0009** → add **REI BlackBook Link**, **Approved Offer Amount**, **Offer Sent Date**

Entering these clears them from the Exception Queue automatically (the formulas recompute).

---

## Steps

### 1. Review the Exception Queue
Open the **Exception Queue** tab. Before completion it shows exactly: **TVL-0001, TVL-0002,
TVL-0003, TVL-0009**. Enter the missing REI BlackBook values on the **Data** tab for each.

### 2. Confirm it is empty or approved
Re-open the **Exception Queue**. It should now be **empty** (`— none —`). If any record remains, it
is genuinely still missing a required field — either complete it, or make a deliberate decision to
accept it as a known exception. Do not proceed to trigger install until the queue is empty or every
remaining row is an approved, understood exception.

### 3. Set `CFG.REPORT_TO`
**Extensions → Apps Script → `Code.gs`** → find `CFG.REPORT_TO: ''` near the top → set it to an
**internal** address (e.g. `rosanes@twinhomebuyer.com`) → **Save**. (Leave blank to keep the report
sheet-only, no email.) Never use a seller address.

### 4. Preview the Daily Report
Sheet → **🏠 Twin Visit Logger → Send daily report now (preview)**. Confirm the **Daily Report** tab
lists only real (non-TEST) actionable records. If `CFG.REPORT_TO` is set, confirm the internal email
arrived. This is safe to run repeatedly.

### 5. Install automation triggers
**🏠 Twin Visit Logger → 4) Install automation triggers.** Authorize if prompted. This creates:
- `onEditInstallable` — on edit
- `checkNoDecision` — hourly
- `checkStalled` — daily ~06:00
- `sendDailyReport` — daily ~07:00 (business days)

### 6. Confirm the triggers are active
**Apps Script → Triggers (clock icon in the left rail).** Confirm all four above are listed and
enabled. (Optional: run `testTriggerCycle` once to prove install+remove both work — it leaves
triggers off, so re-run step 5 afterward.)

### 7. Test one real property update
On the **Data** tab, make one real change on a real record and confirm the automation reacts:
- e.g. enter an **Offer Sent Date** on an offer row → Current Stage becomes **Offer Sent**, a
  follow-up **Next Action Due Date** is set, and a row appears in the **Task Queue**; or
- change **Visit Status → Completed** on a scheduled visit → stage becomes **Visit Completed —
  Needs Review**, owner **Jonathan**, same-day due date, Task Queue entry.
Confirm **no message was sent to any seller** (only Task Queue / internal report activity).

### 8. Emergency kill switch
To stop all automation instantly: **🏠 Twin Visit Logger → ⛔ Remove ALL triggers**, or run
**`removeAllTriggers()`** from the Apps Script editor. Data is untouched; re-enable later with step 5.

---

## Mark fully operational
Only after step 2 (queue empty/approved) **and** step 6 (triggers confirmed active) **and** step 7
(one real update verified) — update `docs/Change-Log.md` to record the go-live date. Until then the
system is **verified but not operational**.
