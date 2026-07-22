# Data Dictionary — Twin Visit Logger (`Data` sheet)

One row per property. Headers on row 1; data from row 2. 59 columns in 9 groups.
`✏️` = user-entered · `⚙️` = formula (never hand-edit) · `🔽` = dropdown (data validation).

## Property information
| # | Field | Type | Notes |
|---|---|---|---|
| 1 | Property ID | ✏️ text (key) | Stable primary key `TVL-####` / `TEST-##`. A future web app keys on this, not row position. |
| 2 | Property Address | ✏️ text | Full street address. Required for active records. |
| 3 | Normalized Address | ⚙️ | Lower-cased, punctuation/`apt`/`unit` stripped, spaces collapsed — used for duplicate detection & cross-system matching. |
| 4 | Seller Name | ✏️ text | |
| 5 | Phone | ✏️ text | |
| 6 | Email | ✏️ text | |
| 7 | Lead Source | 🔽 | Direct Mail · Direct Mail - Postcard · PPC · TV · Facebook · SEO · PPL - Property Leads · PPL - Motivated Leads |
| 8 | REI BlackBook Link | ✏️ URL | Link to the record in REI BlackBook (source of truth). Required for active records. |

## Visit information
| # | Field | Type | Notes |
|---|---|---|---|
| 9 | Visit Date | ✏️ date | |
| 10 | Visit Time | ✏️ text/time | |
| 11 | Visit Status | 🔽 | **Scheduled · Completed · Canceled · Reschedule Needed** |
| 12 | Assigned Visitor | 🔽 | Owners + legacy field reps (assumption): Juan, Kyle, Cherry, Jonathan, JM, Cesar, Jose Herrera, Manny Morales, Lily, Alan Hernandez |
| 13 | Visit Notes | ✏️ text | Required when Visit Status = Completed (rule 1). |
| 14 | Property Condition | 🔽 (assumption) | Excellent · Good · Fair · Poor · Distressed |
| 15 | Occupancy Status | 🔽 (assumption) | Owner-Occupied · Tenant-Occupied · Vacant · Unknown |
| 16 | Photos Link | ✏️ URL | |
| 17 | Video Link | ✏️ URL | |
| 18 | File Link | ✏️ URL | e.g. contract / SignNow file. |

## Seller information
| # | Field | Type | Notes |
|---|---|---|---|
| 19 | Seller Motivation | ✏️ text | Required when Visit Status = Completed (rule 2) or add an Exception note. |
| 20 | Seller Timeline | 🔽 (assumption) | ASAP · 30 days · 60 days · 90+ days · Unknown |
| 21 | Asking Price | ✏️ currency | |
| 22 | Price Expectation | ✏️ currency | |
| 23 | Seller Concerns | ✏️ text | |

## Offer information
| # | Field | Type | Notes |
|---|---|---|---|
| 24 | Approved Offer Amount | ✏️ currency | Entering this triggers Offer Preparation → Kyle (automation). |
| 25 | Offer Status | 🔽 (assumption) | Not Started · In Preparation · Sent · Countered · Accepted · Rejected · Withdrawn |
| 26 | Offer Prepared Date | ✏️ date | |
| 27 | Offer Sent Date | ✏️ date | Entering this triggers Offer Sent + follow-up (automation). |
| 28 | Offer Received Confirmation | 🔽 | Yes · No |
| 29 | Counteroffer Amount | ✏️ currency | Entering this triggers Active Negotiation (automation). |

## Follow-up information
| # | Field | Type | Notes |
|---|---|---|---|
| 30 | Last Contact Date | ✏️ date | Feeds Days Since Last Activity / Stalled. |
| 31 | Last Contact Result | ✏️ text | Required in Active Negotiation (rule 4). |
| 32 | **Next Action** | ✏️ text | Required for active records. |
| 33 | **Next Action Due Date** | ✏️ date | Required for active records. |
| 34 | **Assigned Owner** | 🔽 | **Jonathan · Kyle · Cherry · Juan · JM** — required for active records. |
| 35 | Blocker | 🔽 | Price · Title · Tenant · Family · Access · Timing · Documents · Property Condition · Seller Unresponsive · Other |
| 36 | Days Since Last Activity | ⚙️ | `TODAY() − MAX(Last Contact, Last Updated, Visit Date)` |
| 37 | Days Overdue | ⚙️ | `TODAY() − Next Action Due Date` if past due else 0 |
| 38 | Stalled Status | ⚙️ | "Yes" if ≥3 business days since activity & stage not Nurture/Signed/Closed |

## Relationship information
| # | Field | Type | Notes |
|---|---|---|---|
| 39 | Gift Status | 🔽 | Not Reviewed · Recommended · Approved · Sent · Not Appropriate |
| 40 | Gift Recommendation Reason | ✏️ text | |
| 41 | Gift Approval Owner | 🔽 | Cherry · Juan — required before Gift Status = Sent (rule 9). |
| 42 | Gift Sent Date | ✏️ date | |

## Closeout information
| # | Field | Type | Notes |
|---|---|---|---|
| 43 | **Current Stage** | 🔽 | The 10 canonical stages (below). Required for active records. |
| 44 | Final Disposition | 🔽 | Contracted · Lost · Long-Term Nurture · Closed Out |
| 45 | Closeout Reason | ✏️ text | Required when Lost / Closed Out (rule 8). |
| 46 | Contract Sent Date | ✏️ date | Triggers Contract Sent (automation). |
| 47 | Contract Signed Date | ✏️ date | Triggers Contract Signed → JM handoff (automation). |
| 48 | Transaction Handoff Status | 🔽 (assumption) | Not Ready · Ready for Handoff · Handed Off to JM · JM Confirmed |

## Computed flags
| # | Field | Type | Notes |
|---|---|---|---|
| 49 | Missing Required Fields | ⚙️ | List of blank required fields (active records only; Lost/Closed Out exempt). |
| 50 | Duplicate Address Flag | ⚙️ | "Duplicate" if >1 non-closed record shares Normalized Address. |
| 51 | Opportunity Priority | ⚙️ | Stage weight (Verbal 100 → Lost 0) + min(Days Overdue,20) + stalled bump. Board sort key. |

## System information
| # | Field | Type | Notes |
|---|---|---|---|
| 52 | Created Date | ✏️/auto date | |
| 53 | Last Updated Date | ✏️/auto date | Set by automation on edit. |
| 54 | Updated By | 🔽/auto | |
| 55 | Source | 🔽 | Manual · Apps Script · Import · TEST |
| 56 | Data Quality Status | ⚙️ | OK · Incomplete · Exception (drives board section 10). |
| 57 | Exception Reason | ⚙️ | Concatenated cross-field rule failures (rules 1–10). |
| 58 | REI Update Required | 🔽 | Yes · No |
| 59 | REI Update Completed | 🔽 | Yes · No |

---

## Current Stage — the 10 canonical values
`Visit Scheduled` → `Visit Completed — Needs Review` → `Offer Preparation` → `Offer Sent` →
`Active Negotiation` → `Verbal Agreement` → `Contract Sent` → `Contract Signed` ·
`Long-Term Nurture` · `Lost / Closed Out`

---

## Formulas (Google Sheets syntax — the live variants)

Portable functions only; the reference `.xlsx` uses `_xlfn.TEXTJOIN` and bounded ranges, the live
sheet uses plain `TEXTJOIN` and open-ended ranges. `r` = the row.

```
Normalized Address:
=IF($B{r}="","",TRIM(LOWER(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(
  $B{r},",",""),".",""),"  "," "),"#","")," apt "," "))))

Days Since Last Activity:
=IF($B{r}="","",IF(MAX($AD{r},$BA{r},$I{r})=0,"",TODAY()-MAX($AD{r},$BA{r},$I{r})))

Days Overdue:
=IF($B{r}="","",IF($AG{r}="","",IF(TODAY()>$AG{r},TODAY()-$AG{r},0)))

Stalled Status:
=IF($B{r}="","",IF(OR($AQ{r}="Lost / Closed Out",$AQ{r}="Long-Term Nurture",$AQ{r}="Contract Signed"),
  "No",IF(MAX($AD{r},$BA{r},$I{r})=0,"No",
  IF(NETWORKDAYS(MAX($AD{r},$BA{r},$I{r}),TODAY())-1>=3,"Yes","No"))))

Missing Required Fields:  (active only — Lost/Closed Out exempt)
=IF(OR($B{r}="",$AQ{r}="Lost / Closed Out"),"",TEXTJOIN(", ",TRUE,
  IF($B{r}="","Property Address",""), IF($AQ{r}="","Current Stage",""),
  IF($AF{r}="","Next Action",""), IF($AG{r}="","Next Action Due Date",""),
  IF($AH{r}="","Assigned Owner",""), IF($H{r}="","REI BlackBook Link","")))

Duplicate Address Flag:
=IF($C{r}="","",IF(COUNTIFS($C$2:$C,$C{r},$AQ$2:$AQ,"<>Lost / Closed Out")>1,"Duplicate",""))

Opportunity Priority:
=IF($B{r}="","",IFS($AQ{r}="Verbal Agreement",100,$AQ{r}="Contract Sent",95,
  $AQ{r}="Active Negotiation",85,$AQ{r}="Offer Sent",70,$AQ{r}="Offer Preparation",60,
  $AQ{r}="Visit Completed — Needs Review",50,$AQ{r}="Visit Scheduled",30,
  $AQ{r}="Long-Term Nurture",10,$AQ{r}="Contract Signed",5,TRUE,0)
  +IF($AK{r}="",0,MIN($AK{r},20))+IF($AL{r}="Yes",5,0))

Data Quality Status:
=IF($B{r}="","",IF($BE{r}<>"","Exception",IF($AW{r}<>"","Incomplete","OK")))

Exception Reason:  TEXTJOIN of the 10 cross-field rule messages (see Automation-Rules.md §Validation)
```
(Column letters above are from the 59-column layout; the builder computes them programmatically, so
they stay correct even if the layout changes. See `build/build_workbook.py`.)

---

## Migration mapping (legacy → new)

| Legacy field | New field(s) | Rule | Confidence |
|---|---|---|---|
| Address | Property Address (+ Normalized Address) | verbatim; normalized computed | High |
| Name | Seller Name | verbatim | High |
| Phone | Phone | verbatim | High |
| Lead Source | Lead Source | values already match | High |
| Appointment date / col A | Visit Date | copied | High |
| Inspection Status | Visit Status | Inspected→Completed · Pending Inspection→Scheduled · Cancelled→Canceled · Skipped - offer made→Completed | High |
| Inspector | Assigned Visitor | Juan Diaz→Juan; Cesar→Cesar; others kept in visitor list | Medium |
| Closer / Agent | Assigned Owner | Cherry→Cherry; Juan Diaz→Juan; blank/other → left blank → Exception Queue | Low where blank |
| Deal Stage + Deal Status | Current Stage (+ Final Disposition) | see stage table below | Medium — uncertain → Exception Queue |
| Status Update (prose) | Last Contact Result / Next Action / Visit Notes | clear "next step" → Next Action; full text → Visit Notes; ambiguous → Exception | Low — never guessed |
| Notes | Visit Notes / Seller Motivation | Notes→Visit Notes; motivation only if explicit | Medium |
| Golden Needle (unused) | (dropped) | audit-flagged unused | n/a |
| Contract (dropdown) | Final Disposition / Handoff | Acquired→Contracted; Cancelled Contract→Lost; Under Contract→context | Medium |

### Legacy Deal Status → Current Stage
| Legacy Deal Status | New Current Stage |
|---|---|
| Lead Received / Appointment scheduled | Visit Scheduled |
| Under Review (after Inspected) | Visit Completed — Needs Review |
| Offer Made | Offer Sent |
| Under Contract | Contract Signed |
| On Hold - Follow Up Scheduled / Nurture / Awaiting Seller / Seller Timeline | Long-Term Nurture |
| Seller Rejected Offer / We're Passing / Did Not Proceed / Not Qualified / Sold … | Lost / Closed Out |
| Acquired / Acquired - Sold / Wholesale - Deal Closed | Contract Signed / Lost per context (Final Disposition = Contracted) |

**Uncertain rows are not guessed** — migrated with what is certain and routed to the Exception
Queue with legacy prose preserved in Visit Notes.

---

## Hidden sheets (preserved — dependencies documented; not deleted)
| Sheet | Role | Dependency |
|---|---|---|
| `Legacy Pipeline (archive)` | Original 370-row `Data` (renamed by Setup.gs) | Source of migration; historical record |
| `Summary`, `Sheet10/12/19` | Legacy scratch/mail data | Referenced by legacy `Calc`/`KPI` |
| `Contracts` | Closed-deal revenue + 6-touch mail cadence | Historical; informs follow-up cadence design |
| `Appointments` | Legacy appointments feed | Legacy dashboard input |
| `direct mail` | Direct-mail inspected leads | Historical |
| `KPI`, `Calc` | Legacy Google-native dashboards (FILTER/REGEXMATCH) | Superseded by Cherry Opportunity Board; left intact |
| `Pivot Table 1` | Broken `#REF!` pivot | To be repaired against the new `Data` range |
