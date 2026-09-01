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
