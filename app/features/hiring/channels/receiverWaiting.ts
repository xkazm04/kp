import type { ChannelWebhookRecord } from "@/app/_lib/db/channels";
import { receiverHealth } from "./receiverHealth";

// "WAITING" IS A STATE THAT ENDS — this module is the arithmetic behind saying so.
//
// A receiver nothing has reached reads "Waiting". Alone that is an endless spinner in
// words: the recruiter cannot tell a source that has not fired yet from one wired to
// the wrong address. We cannot know when a lead will arrive, so we promise no time.
// What we CAN say honestly is what ends the state (the first authenticated inbound
// request), how long it has been waiting (from the receiver's own `createdAt`), and
// after a threshold that this is long enough to go and check the source.
//
// Pure, DOM-free and timer-injectable so the polling contract is unit-tested without
// React: it polls only while a receiver waits, never while the tab is hidden, stops
// itself the tick after the last waiting receiver is reached, and stops on demand
// (the hook calls the returned stop on unmount).

/** How often the receivers list is re-read while one waits. Modest: one small GET. */
export const WAIT_POLL_MS = 20_000;
/** After this long without a first request the card stops reassuring and points at the
 *  existing setup steps. Deliberately not a failure verdict — silence is not proof. */
export const WAIT_STALL_MS = 10 * 60_000;

/** The receivers still waiting for their first inbound request. */
export function waitingReceivers(list: readonly ChannelWebhookRecord[] | null): ChannelWebhookRecord[] {
  return (list ?? []).filter((w) => receiverHealth(w).verdict === "waiting");
}

export type WaitingFor = { elapsedMs: number; stalled: boolean };

/** How long a receiver has waited, or null when its creation stamp is unusable
 *  (then the card says what ends the wait, without an elapsed time). */
export function waitingFor(createdAt: string, nowMs: number): WaitingFor | null {
  const start = Date.parse(createdAt);
  if (!Number.isFinite(start)) return null;
  const elapsedMs = Math.max(0, nowMs - start);
  return { elapsedMs, stalled: elapsedMs >= WAIT_STALL_MS };
}

export type WaitPollDeps = {
  /** Re-read the receivers (the existing /api/channels/webhooks read). */
  load: () => void;
  /** True while at least one receiver still waits — read fresh on every tick. */
  isActive: () => boolean;
  isHidden: () => boolean;
  onTick?: () => void;
  intervalMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
};

/** Start the bounded poll; returns its stop function (idempotent). */
export function startWaitPoll(d: WaitPollDeps): () => void {
  const set = d.setTimer ?? ((fn, ms) => setInterval(fn, ms));
  const clear = d.clearTimer ?? ((id) => clearInterval(id as ReturnType<typeof setInterval>));
  let stopped = false;
  let id: unknown = null;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (id !== null) clear(id);
  };
  id = set(() => {
    if (stopped) return;
    if (!d.isActive()) return stop();
    if (d.isHidden()) return;
    d.onTick?.();
    d.load();
  }, d.intervalMs ?? WAIT_POLL_MS);
  return stop;
}
