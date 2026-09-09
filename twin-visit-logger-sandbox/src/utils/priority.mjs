import fs from 'node:fs';
import path from 'node:path';

/**
 * A booking is waiting for the browser — long sweeps should get out of the way.
 *
 * WHY THIS EXISTS. There is one REI browser and one lock, taken first-come-first-served. A bucket sweep
 * over forty leads holds it for the best part of an hour, and the board-intake job — the one finishing a
 * booking a colleague is watching a timer on — queued politely behind it. On the client's machine that
 * meant a visit booked for the next day sat unprocessed for six hours while the browser was busy
 * re-checking leads nobody was waiting for. Their words: "the booking should be prio at always."
 *
 * They are right, and the ordering was backwards. A bulk re-check has no audience and its next run is
 * minutes away; a booking has somebody watching it and a visitor who needs to be told where to drive.
 *
 * HOW. Cooperative, not forceful. The booking job leaves a claim here before it queues for the lock; the
 * sweep checks between leads and stops cleanly when it sees one. Nothing is killed mid-lead, no lock is
 * taken away, and a sweep that yields has still done and written every lead it finished.
 *
 * THE STALENESS WINDOW IS THE SAFETY CATCH. A claim is honoured for fifteen minutes only. If the booking
 * job crashes between claiming and releasing, a forgotten file would otherwise stop every sweep on this
 * machine for ever — a deadlock created by the thing meant to prevent one. Fifteen minutes is well past
 * the twelve the booking job itself will wait, so a live claim is never ignored.
 */
const CLAIM_PATH = path.resolve('./data/BOOKING-WAITING');
const CLAIM_GOOD_FOR_MS = 15 * 60 * 1000;

/** Say a booking is queueing for the browser. Never throws — this must not be able to fail a run. */
export function claimBookingPriority(detail = '') {
  try {
    fs.mkdirSync(path.dirname(CLAIM_PATH), { recursive: true });
    fs.writeFileSync(CLAIM_PATH, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, detail }));
    return true;
  } catch { return false; }
}

/** Withdraw the claim. Safe to call when none was made, and safe to call twice. */
export function clearBookingPriority() {
  try { fs.unlinkSync(CLAIM_PATH); } catch { /* not there — fine */ }
}

/**
 * Is a booking waiting right now? Called by the long jobs between leads.
 *
 * A claim older than the window is treated as absent AND deleted, so one crashed run cannot leave every
 * future sweep yielding to a booking that finished hours ago.
 */
export function bookingIsWaiting() {
  try {
    const stat = fs.statSync(CLAIM_PATH);
    if (Date.now() - stat.mtimeMs <= CLAIM_GOOD_FOR_MS) return true;
    clearBookingPriority();
    return false;
  } catch { return false; }
}

/* ======================================================================================================
 * YIELDING FOREVER IS NOT YIELDING. IT IS STARVATION.
 *
 * This half exists because the half above ran for five days and stopped the bucket sweep completing even
 * once. From the client's Automation Log, one line an hour, all day, for days:
 *
 *     Bucket sweep stood down for a booking after 1 of 20 lead(s) - not stamped as a completed sweep.
 *     Work queue HELD - buckets not swept yet (last sweep 7057 min ago).
 *
 * 7057 minutes is 4.9 days. The sweep runs hourly, so that is around 118 consecutive stand-downs, and the
 * work-queue card the whole team reads had been held that entire time. The client, reasonably: "the
 * cheking and alert did not fioree".
 *
 * The mechanism was mine end to end. The board-intake job claims priority BEFORE it queues for the lock,
 * and it ran every two minutes; the sweep needs five to eight minutes for twenty leads and checks for a
 * claim between each one. A two-minute claimer against a five-minute yielder is a job that can never
 * finish. Worse, the claim was made for the REI-LINK BACKFILL as well as for real bookings, and a row
 * whose phone REI cannot match is re-selected every single run for thirty days - so the claim was not
 * occasional, it was permanent.
 *
 * TWO CHANGES, AND THE FIRST IS THE ACTUAL FIX: only a real booking claims (see fill-pending-rei.mjs).
 * The backfill is housekeeping with nobody watching it, which is the very distinction this file's own
 * comment draws.
 *
 * The second is this: a sweep that has not completed in hours stops yielding. Politeness has to have a
 * floor, or "bookings come first" quietly becomes "the buckets are never checked". The cost is bounded and
 * small - the booking job waits 90 seconds for the lock, exits 0, and tries again two minutes later, so
 * the worst case is a booking arriving a few minutes later once every few hours. The cost of the old
 * behaviour was a blind work queue for five days, and nobody noticed because the only thing that said so
 * was a log line nobody reads.
 * ====================================================================================================== */
const SWEEP_PATH = path.resolve('./data/LAST-SWEEP');
const SWEEP_MUST_FINISH_AFTER_MS = 3 * 60 * 60 * 1000;

function readSweepState() {
  try { return JSON.parse(fs.readFileSync(SWEEP_PATH, 'utf8')) || {}; } catch { return {}; }
}

function writeSweepState(state) {
  try {
    fs.mkdirSync(path.dirname(SWEEP_PATH), { recursive: true });
    fs.writeFileSync(SWEEP_PATH, JSON.stringify(state));
  } catch { /* bookkeeping; must never fail a run */ }
}

/** A sweep got all the way through. Resets the stand-down streak. */
export function noteSweepCompleted() {
  writeSweepState({ completedAt: new Date().toISOString(), standDowns: 0 });
}

/** A sweep stood down. Returns how many times in a row that has now happened. */
export function noteSweepStoodDown() {
  const state = readSweepState();
  const standDowns = (Number(state.standDowns) || 0) + 1;
  writeSweepState({ ...state, standDowns });
  return standDowns;
}

/**
 * Minutes since a sweep last finished, or null when none ever has on this machine.
 *
 * Deliberately null rather than 0 or Infinity: "never" and "a long time ago" read the same to a person and
 * must not read the same to code. A fresh install has never swept and is not overdue.
 */
export function minutesSinceSweep() {
  const at = Date.parse(readSweepState().completedAt || '');
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.round((Date.now() - at) / 60000));
}

/** How many sweeps in a row have stood down without finishing. */
export function standDownStreak() {
  return Number(readSweepState().standDowns) || 0;
}

/**
 * Should this sweep get out of the way? The whole yield policy, in one place.
 *
 * A booking still comes first — that has not changed and must not. What changed is that it cannot come
 * first FOREVER: once the buckets have gone unswept for longer than the window, this sweep finishes its
 * work even with a booking queued behind it, because the card that queue feeds is the thing the team
 * actually works from.
 */
export function shouldStandDownForBooking() {
  if (!bookingIsWaiting()) return { standDown: false };
  const since = minutesSinceSweep();
  if (since !== null && since * 60000 > SWEEP_MUST_FINISH_AFTER_MS) {
    return {
      standDown: false,
      overdue: true,
      minutesSinceSweep: since,
      reason: `a booking is waiting, but the buckets have not been swept for ${since} minutes`
        + ' — finishing this sweep first so the work queue is not published blind'
    };
  }
  return { standDown: true, minutesSinceSweep: since };
}
