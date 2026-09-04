// WHEN the Outbox re-reads the server, as a pure decision.
//
// The outbox loaded on mount, when a lifecycle task finished, and after a resend —
// and never again. That is the wrong cadence for what this table is FOR: a dead
// letter is produced by the RELAY, asynchronously, long after the click that queued
// the message, and a bounce receipt arrives minutes later still. A recruiter who left
// the tab open, went to their mail client to check whether the offer landed, and came
// back was reading a snapshot from before the failure existed, with nothing on screen
// saying so.
//
// Returning to the tab is the one moment we KNOW the reader is about to trust what
// they see, so that is when it refreshes. The decision is pure and lives here because
// the two events that mean "returned" overlap: switching back to a background tab
// fires `visibilitychange` AND `focus`, so a naive listener pair fetches twice on
// every return.
//
// Staleness semantics are unchanged and deliberately so: the reload goes through the
// SAME useLoader call the rest of the tab uses, so a failed refresh keeps the last
// good rows on screen, leaves `failed` set, and the existing LoadStatus pill keeps
// saying how old they are. A refresh that silently swapped in an empty table, or one
// that cleared the pill without new data, would be worse than not refreshing.

/** How long after an attempt another return-triggered one is suppressed. Covers the
 *  focus/visibilitychange double-fire with room to spare, and caps a reader who is
 *  alt-tabbing between the app and their mail client to one fetch per window. */
export const OUTBOX_RETURN_MIN_INTERVAL_MS = 15_000;

export type ReturnEvent = "focus" | "visibilitychange";

/**
 * Should this window/document event trigger an outbox reload?
 *
 * `lastAttemptAt` is when the last load was STARTED (null before the first), not when
 * it succeeded: a failing endpoint must not be hammered once per second by a reader
 * clicking between windows, and the stale pill is already telling them what happened.
 */
export function shouldReloadOnReturn(input: {
  event: ReturnEvent;
  /** `document.visibilityState` at the moment the event fired. */
  visibility: "visible" | "hidden";
  lastAttemptAt: number | null;
  now: number;
  minIntervalMs?: number;
}): boolean {
  const { event, visibility, lastAttemptAt, now, minIntervalMs = OUTBOX_RETURN_MIN_INTERVAL_MS } = input;
  // LEAVING is not returning. `visibilitychange` fires in both directions, and a
  // `focus` delivered while the document is hidden is not a reader looking at this
  // table — fetching then spends a request on a tab nobody is reading.
  if (visibility !== "visible") return false;
  // The double-fire: one return, one fetch. Also the alt-tab throttle.
  if (lastAttemptAt != null && now - lastAttemptAt < minIntervalMs) return false;
  // `event` is not read beyond this point: both events mean the same thing once the
  // two guards above have run, and that is the claim worth stating rather than
  // encoding a preference for one of them. Keeping it in the signature is what lets a
  // caller (and this file's tests) name which listener asked.
  void event;
  return true;
}
