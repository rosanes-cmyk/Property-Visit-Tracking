/**
 * Deciding WHAT group to create, for WHICH visit, with WHO in it.
 *
 * Everything here is pure: calendar events in, a plan out. No browser, no network, no side effects,
 * and deliberately no dependencies — this layer decides who gets added to a group chat that a
 * seller can read, so it has to be testable in a bare checkout, not only after npm install.
 *
 * Covered by tests/whatsapp-plan.test.mjs.
 */

const OUR_EVENT = /^Property Visit\b/i;

/**
 * Digits only, then to E.164.
 *
 * The cases, in order of how much they can be trusted:
 *   +anything          -> taken as given; the writer said what country it is
 *   11-15 digits       -> already carries a country code, so just add the "+".
 *                         This is what makes a Philippine number written 639054537035 work; it used
 *                         to be REFUSED, which silently dropped the seller from the group.
 *   exactly 10 digits  -> no country code at all. Prefixed with defaultCountry ("1" for the US
 *                         sellers this reads from REI; set PHONE_DEFAULT_COUNTRY to change it).
 *   11 digits from 1   -> US with its country code.
 *   anything else      -> refused. An extension, a partial, a typo. A wrong number here means
 *                         adding a stranger to a chat about someone's house.
 */
export function toE164(value, defaultCountry = '1') {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  // An extension has to be caught on the TEXT, before the digits are stripped. "(650) 771-7814 x22"
  // is twelve digits — the same length as a Philippine mobile — so once the "x22" is gone the two are
  // indistinguishable and the extension digits get dialled as part of the number.
  if (/(?:^|[\s\-.,)])(?:x|ext|extn|extension)\.?\s*\d+/i.test(raw)) return '';

  const explicit = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (explicit) return digits.length >= 8 ? `+${digits}` : '';
  // A leading 0 is a national trunk prefix (09054537035 is how a Philippine mobile is written
  // locally). It is NOT a country code, and no country code starts with 0 — so which country this
  // belongs to is unknowable from the digits alone. Refused rather than guessed.
  if (digits.startsWith('0')) return '';
  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return '';
}

/**
 * Flag a number that parses but is probably mistyped, so it is caught before a run rather than by
 * a group quietly missing a member.
 *
 * The case this exists for: a Philippine mobile entered as +9928379192 instead of +639928379192.
 * It is valid E.164 on its face — it just reads as +992 (Tajikistan) and matches nobody. Almost
 * every real mobile written with a country code is 11 digits or more; 10 means a country code was
 * probably dropped.
 */
export function suspiciousNumber(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const e164 = toE164(raw);
  if (!e164) {
    if (/(?:^|[\s\-.,)])(?:x|ext|extn|extension)\.?\s*\d+/i.test(raw)) {
      return 'has an extension on the end — remove it, the extension digits are not part of the number';
    }
    return /^\D*0/.test(raw)
      ? 'starts with a 0 (a local trunk prefix, not a country code) — write it with the country ' +
        'code instead, e.g. 09054537035 becomes +639054537035'
      : 'could not be read as a phone number';
  }
  const digits = e164.slice(1);
  if (digits.startsWith('1') && digits.length === 11) return '';          // US/Canada, correct
  if (digits.startsWith('63') && digits.length === 12) return '';         // Philippines, correct
  if (digits.length < 11) {
    return `only ${digits.length} digits after the "+" — a country code looks missing ` +
           `(a Philippine mobile is +63 then 10 digits, e.g. +639171234567)`;
  }
  return '';
}

/** Read "Label: value" out of the event description the calendar module writes. */
export function fieldFromDescription(description, label) {
  const prefix = `${label}:`.toLowerCase();
  for (const line of String(description ?? '').split('\n')) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().startsWith(prefix)) {
      const value = trimmed.slice(prefix.length).trim();
      return value === 'Not found' ? '' : value;
    }
  }
  return '';
}

/** "2145 Capitol Ave, East Palo Alto, CA, 94303, UNITED STATES" -> "2145 Capitol Ave" */
export function shortAddress(address) {
  return String(address ?? '').split(',')[0].replace(/\s+/g, ' ').trim();
}

/** The calendar day an instant falls on, in the target timezone, as YYYY-MM-DD. */
export function localDay(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const at = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${at('year')}-${at('month')}-${at('day')}`;
}

function formatIn(date, timezone, options) {
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, ...options }).format(date);
}

/**
 * WhatsApp's group subject limit was 25 characters for years and is 100 today. It is a parameter
 * rather than a constant so a shorter cap can be set without a code change if that ever bites.
 */
export const GROUP_NAME_MAX = 100;

/**
 * Matches the naming the team already uses by hand — the full address, no date, e.g.
 * "728 Tampico, Walnut Creek, CA 94598". Deliberately dateless: one group per PROPERTY, reused if
 * the visit is rescheduled or a second visit happens, rather than a new group each time.
 * Tokens: {fullAddress} · {address} (street only) · {date}
 */
export const DEFAULT_GROUP_TEMPLATE = '{fullAddress}';

/**
 * Build the group subject. If it has to be shortened, the ADDRESS gives way and the date survives:
 * a group named for the wrong day is worse than one with a clipped street.
 */
export function groupName(address, start, timezone, template = DEFAULT_GROUP_TEMPLATE, max = GROUP_NAME_MAX) {
  const date = start ? formatIn(start, timezone, { month: 'short', day: 'numeric' }) : '';
  // The country suffix REI appends is noise in a chat title; the team's own groups never carry it.
  const full = String(address ?? '').replace(/,\s*(united states|usa|us)\s*$/i, '').replace(/\s+/g, ' ').trim();

  // Whichever address token the template uses is the one that gets shortened.
  const usesFull = template.includes('{fullAddress}');
  const value = usesFull ? full : shortAddress(full);
  const fill = (addr) => template
    .replace('{fullAddress}', addr)
    .replace('{address}', addr)
    .replace('{date}', date)
    .replace(/\s+/g, ' ')
    .trim();

  const built = fill(value);
  if (built.length <= max) return built;

  // Give the address exactly the room left over once everything else in the template is placed.
  // Measuring the FULL address while the template substitutes the street was the earlier mistake:
  // the arithmetic came out short and a trailing .slice() cut the date off the end, which is the one
  // part that must survive.
  const room = Math.max(0, max - fill('').length - 1);
  return fill(value.slice(0, room).trim());
}

/**
 * Who goes in. Team numbers always; the seller only when includeSeller is on AND their number
 * parses cleanly. Duplicates and the account's own number are removed — WhatsApp rejects a group
 * that tries to add its own owner as a participant.
 */
export function participants({ teamNumbers = [], sellerPhone = '', includeSeller = false, ownNumber = '', defaultCountry = '1' }) {
  const own = toE164(ownNumber, defaultCountry);
  const seen = new Set();
  const out = [];

  const add = (value, role) => {
    const e164 = toE164(value, defaultCountry);
    if (!e164 || (own && e164 === own) || seen.has(e164)) return;
    seen.add(e164);
    out.push({ number: e164, role });
  };

  for (const number of teamNumbers) add(number, 'team');
  if (includeSeller) add(sellerPhone, 'seller');
  return out;
}

/**
 * Turn one calendar event into a plan, or explain why it is being skipped.
 * `now` is injected so the decision is testable and stable.
 */
export function planForEvent(event, options) {
  const {
    timezone = 'America/Los_Angeles',
    teamNumbers = [],
    includeSeller = false,
    ownNumber = '',
    defaultCountry = '1',
    template = DEFAULT_GROUP_TEMPLATE,
    now = new Date(),
    alreadyDone = new Set()
  } = options || {};

  const title = String(event?.summary ?? '');
  const skip = (reason) => ({ create: false, reason, event });

  if (!OUR_EVENT.test(title)) return skip('not a Property Visit event');
  if (event.status === 'cancelled') return skip('event is cancelled');

  const startIso = event?.start?.dateTime || event?.start?.date || '';
  if (!startIso) return skip('event has no start time');

  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return skip('event start could not be parsed');
  // Compare calendar days in the target timezone, so a 5pm visit today is never "in the past"
  // just because the run happens at 6pm, and no UTC-offset arithmetic can drift it a day.
  if (localDay(start, timezone) < localDay(now, timezone)) return skip('visit is in the past');

  // Location is authoritative; the description is the fallback, and the title the last resort.
  const address = event.location
    || fieldFromDescription(event.description, 'Property')
    || title.replace(/^Property Visit\s*[-|·—]?\s*/i, '').trim();
  if (!address) return skip('no property address on the event');

  const name = groupName(address, start, timezone, template);
  if (alreadyDone.has(event.id)) return skip(`group already created (${name})`);

  const sellerPhone = fieldFromDescription(event.description, 'Phone');
  const people = participants({ teamNumbers, sellerPhone, includeSeller, ownNumber, defaultCountry });
  if (!people.length) return skip('no valid participant numbers — nobody to add');

  return {
    create: true,
    eventId: event.id,
    name,
    address,
    startIso,
    sellerPhone,
    // Kept so the REI task step can find the contact link without re-fetching the event.
    rawDescription: String(event.description ?? ''),
    startLocal: formatIn(start, timezone, {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
      hour: 'numeric', minute: '2-digit'
    }),
    participants: people,
    sellerIncluded: people.some((p) => p.role === 'seller')
  };
}

/** Plan a whole calendar page. Returns { create: [...], skipped: [...] }. */
export function planForEvents(events, options) {
  const create = [];
  const skipped = [];
  for (const event of events || []) {
    const plan = planForEvent(event, options);
    (plan.create ? create : skipped).push(plan);
  }
  // Two events for the same property on the same day only need one group.
  const seen = new Set();
  const deduped = [];
  for (const plan of create) {
    if (seen.has(plan.name)) {
      skipped.push({ create: false, reason: `duplicate of "${plan.name}"`, event: plan.event });
      continue;
    }
    seen.add(plan.name);
    deduped.push(plan);
  }
  return { create: deduped, skipped };
}
