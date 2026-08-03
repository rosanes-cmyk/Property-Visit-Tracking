# The note that goes in the visit WhatsApp group

**The automation posts this itself** — `WHATSAPP_POST_NOTE` is on by default, so a group created by
`src/whatsapp/watch.mjs --yes` gets the note straight after it is created. What is left for a person is
filling in the blanks (`_______`): the PropertyRadar figures and the four judgement lines. Nobody has to
paste the skeleton by hand.

The groups are **team only** — no seller — so the financials and motivation notes are safe here. If
that ever changes, the automation refuses to post at all rather than posting a shortened version, and
the Lead Summary and Motivation lines have to be cut by hand.

Two things the posting code guarantees, both learned the hard way:

- It reads back the open conversation's title and refuses unless it matches the group name. The
  header's `title` attribute says "click here for group info", not the subject, which is why the
  first two attempts refused to post into groups that had been created perfectly.
- It recognises its own note by the `🏠 PROPERTY INSPECTION` heading, so re-running never posts a
  second copy — and a group that somehow ended up without one gets picked up again on the next run.

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

Checked against a real REI contact (20473369, Jon Box) on 2026-08-03 with `npm run rei:fields`.

| Line | Source |
|---|---|
| Property, Seller, Phone, Email, REI Link, Appointment, Lead Source | **Automatic** — scraped from REI |
| Beds / Baths / SqFt | **Automatic** — REI shows these as chips (`4 Beds`, `2.0 Baths`, `2,448 SqFt`) |
| Lead Stage, Category, Call Disposition, Next Step, Sales Agent, Campaign | **Automatic** — all present on the contact |
| Motivation, Reason for Selling, Occupancy, Condition, Known Issues | **Typed by hand.** REI has no fields for these; the team writes them into free-text notes |
| Estimated Value, Assessed Value, Loan Balance, Equity, Purchase Date | **Typed by hand — REI does not hold them at all.** See below |

### The financial summary is not in REI

Those five figures were looked for and are genuinely absent from the REI contact page. REI holds only
an `Equity Percentage` figure written into the free-text Notes field (22% on the Jon Box record).

They come from **PropertyRadar**, which the team already cross-checks by hand — their own note says
*"PropertyRadar lists Single Family 6/3 3,200sf while seller describes a triplex"*. So no amount of
scraper work will fill them in; they need either a PropertyRadar integration or continued manual
entry. Recorded in `config/rei-selectors.json` under `_notAvailableInRei` so nobody spends another
afternoon hunting for a selector that does not exist.

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
