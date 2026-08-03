# The note that goes in the visit WhatsApp group

Paste this into the group after it appears. The groups are **team only** — no seller — so the
financials and motivation notes are safe here. If that ever changes, cut the Lead Summary and
Motivation lines before posting.

---

## Template

```
🏠 PROPERTY INSPECTION
📍 Property: <full address>
🧑 Seller: <name>
📞 Phone: <phone>
🔗 Rei Blackbook Link: <REI contact URL>
📅 Appointment: <Day Mon D, YYYY, h:mm–h:mm AM/PM> (In-Person Property Visit)
📣 Lead Source: <source>

📊 Lead Summary:
💵 Estimated Value - $<value>
🏛️ Assessed Value - $<value>
🏦 Estimated Open Loans Balance - $<value>
📈 Estimated Equity - $<value>
🗓️ Purchase Date - <MM/DD/YYYY> ($<price>)

🌡️ Motivation Level: <Cold / Warm / Hot> — <one line on why>
🤝 Reason for Selling: <in the seller's words>
👥 Occupancy: <owner-occupied / tenant-occupied / vacant> — <access notes>
🔧 Property Condition: <what needs work>
⚠️ Known Issues: <anything that could kill or complicate the deal>
```

---

## Where each line comes from

| Line | Source |
|---|---|
| Property, Seller, Phone, REI Link, Appointment, Lead Source | **Automatic** — already scraped from REI into the tracker |
| Estimated / Assessed Value, Loan Balance, Equity, Purchase Date | REI's property data — *not captured yet*, see below |
| Motivation, Reason for Selling, Occupancy, Condition, Known Issues | REI custom fields or notes — *not captured yet* |

The bottom two groups are being mapped now. Once `scripts/rei-fields.mjs` has reported the real REI
label names, they land in the tracker automatically and this note can be assembled from the sheet
instead of typed.

---

## Writing the judgement lines well

The top half is facts and copies itself. The bottom half is the part that decides whether the visit
goes well, and it is worth writing properly.

**Motivation Level** — one of Cold / Warm / Hot, then *why* in a few words. "Warm — open to selling
for the right price" tells the visitor how hard to push. "Warm" on its own tells them nothing.

**Occupancy** — always say whether access needs arranging. "Tenant-occupied (long-term tenants in 2
units; vacant 4bd main house) — needs advance notice to access occupied units" is the difference
between a productive visit and a wasted drive.

**Known Issues** — anything that could kill or complicate the deal, however awkward:

- Title and signing authority. *"Owner of record is a TRUST — verify signing authority"* is exactly
  the kind of thing that surfaces at closing if nobody wrote it down.
- Data that disagrees with the seller. *"PropertyRadar lists Single Family 6/3 3,200sf while the
  seller describes a triplex"* — the visitor should resolve that on site, not discover it later.
- Conditions the seller has attached, like keeping tenants in place.

**Do not soften these.** An issue left out of the note is an issue found at the worst possible
moment.
