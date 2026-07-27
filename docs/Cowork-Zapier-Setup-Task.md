# Cowork Task — Finish the REI BlackBook → Twin Visit Logger Zap

**Give this whole file to a Claude Cowork agent (with browser/computer control of the user's
Zapier tab).** It is self-contained: everything needed to finish the Zap is here.

---

## Goal
Finish configuring **one Zap** in Zapier so that when an REI BlackBook contact's **Appointment
Date** is set, the appointment is auto-POSTed to our Google Apps Script endpoint, which creates a
row in the Twin Visit Logger, puts an event on the calendar, and writes to the Automation Log.

## Current state (already done — do NOT redo)
- **Trigger** (Step 1): App = **REI BlackBook**, Event = **Contact Field Updated**, Field =
  **Appointment Date**. Connected + tested (test record loaded).
- **Action** (Step 2): App = **Webhooks by Zapier**, Event = **POST**.
  - **URL:** already filled with the `/exec` URL:
    `https://script.google.com/a/macros/twinhomebuyer.com/s/AKfycbxp7ACEnlumHkspmbOOuY7PO4InKOUeMEmAuejfft-GTfNJI23Hr5izbt2Cxgelo3nLOg/exec`
  - **Payload Type:** `Json` ✅

## What to do (finish Step 2)

### 1. Fill the **Data** section — 10 key/value rows
Left box = KEY (type exactly, capitals + spaces matter). Right box = VALUE. Click
**"+ Add value set"** to add each new row.

| KEY (type) | VALUE |
|---|---|
| `token` | type: `ORP9pfVWhZQKHuSYW9HMnoqYFwASBpy` |
| `action` | type: `intake` |
| `Seller Name` | insert **Contact Name First Name** + space + **Contact Name Last Name** |
| `Phone` | insert **Phone** |
| `Email` | insert **Email** |
| `Property Address` | insert **Contact Address** (if absent, use **Address1**, else **Mailing Address**) |
| `Visit Date` | insert **Appointment Date** |
| `Visit Time` | insert **Appointment Time** |
| `Assigned Visitor` | insert **Appointment Assigned To** |
| `Lead Source` | insert **Lead Source** |

### 2. Remaining toggles
- **Wrap Request In Array:** **No**
- **File:** empty
- **Unflatten:** **No**

### 3. Continue → Test
- Click **Continue**, then **Test step**.
- Zapier will POST to the endpoint. **A 200 response is success.** Expected outcomes:
  - Response `{"ok":true,"created":true,...}` or `{"ok":true,"updated":true,...}` → **great.**
  - Response `{"ok":false,"error":"Property Address is required ..."}` → **also acceptable** — it
    only means the current *test contact* has no address; the pipe + token work. Real appointment
    contacts have an address.
- If the response is `{"ok":false,"error":"unauthorized"}` → the `token` value is wrong. Re-check
  Row 1 equals `ORP9pfVWhZQKHuSYW9HMnoqYFwASBpy` exactly.

### 4. Publish
- Click **Publish** to turn the Zap ON.

## Definition of done
- The Zap is **Published/ON** with the trigger and the 10-row POST mapping above.
- A test POST returned HTTP 200 with an `ok` field (true, or false only due to a missing address
  on the empty test contact).
- Report back: the final response body, and a screenshot of the published Zap.

## Guardrails (do not violate)
- **Do not** change the trigger, the URL, or the Payload Type.
- **Do not** add any step that emails, texts, or messages a seller.
- **Do not** create additional Zaps or automations.
- **Do not** turn off sandbox or touch anything in Google Sheets / Apps Script.
- This Zap only sends appointment data to our endpoint — nothing else.

## After it's live — real end-to-end test (optional, human-run)
In REI BlackBook, open a **test contact**, set its **Appointment Date** to today, save. Within
seconds the Zap fires → a row appears in the DEV COPY logger (Source = `Intake-Sandbox`), an event
on the calendar, and an `INTAKE` line in the Automation Log. Delete the test row from the dashboard
when done.
