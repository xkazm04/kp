// The tasks dock's poll STATE MACHINE and its schedule — pure, so node --test can
// pin them (TasksProvider.tsx is a .tsx and the node runner cannot load it, which
// is why the provider had no test of any kind).
//
// Two defects live here, and both are about a queue that has stopped answering:
//
//   • The loop re-armed at a FLAT 2s (active) / 6s (idle) regardless of whether the
//     last poll reached the server. Against a dead endpoint — the server restarting,
//     a laptop off the network, a 500 loop — that is 30 requests a minute, forever,
//     from every open tab, each one a fetch + a JSON parse + a rejected promise.
//   • `loadFailed` existed but nothing counted the failures, so nothing could back
//     off and nothing could say "this has been failing for a while".
//
// The reducer additionally makes the poll's ONE optimisation testable: an unchanged
// poll must return the SAME state object, so React bails out and the always-mounted
// indicator, the whole tab and every row do not re-render on each tick.

import { tasksSignature, type TaskSignatureRow } from "./task-view";

/** Why a start / retry / cancel click produced no task. Structurally the shell's
 *  `TaskStartError`; declared here so this module stays free of UI imports. */
export type TaskActionError = { kind: string; message: string };

export type TasksPollState<T extends TaskSignatureRow> = {
  tasks: T[];
  /** The LAST poll did not reach the queue. `tasks` is stale — or, on a first load,
   *  still `[]`, which a view must not render as "nothing has run". */
  loadFailed: boolean;
  /** Consecutive failed polls; 0 while healthy. Drives the backoff AND the
   *  "unreachable" disclosure, which waits for the second failure so a single
   *  dropped request does not shout. */
  failures: number;
  startError: TaskActionError | null;
};

export type TasksPollEvent<T extends TaskSignatureRow> =
  | { type: "polled"; tasks: T[] }
  | { type: "pollFailed" }
  | { type: "actionOk" }
  | { type: "actionFailed"; kind: string; message: string }
  | { type: "clearError" };

export function initialTasksPollState<T extends TaskSignatureRow>(): TasksPollState<T> {
  return { tasks: [], loadFailed: false, failures: 0, startError: null };
}

export function tasksPollReducer<T extends TaskSignatureRow>(
  state: TasksPollState<T>,
  event: TasksPollEvent<T>
): TasksPollState<T> {
  switch (event.type) {
    case "polled": {
      const same = tasksSignature(state.tasks) === tasksSignature(event.tasks);
      // A healthy poll that changed nothing is a NO-OP down to the object identity:
      // returning a fresh state here would re-render every useTasks() consumer on
      // every tick for the whole life of a running task.
      if (same && !state.loadFailed && state.failures === 0) return state;
      // Same rows ⇒ keep the PREVIOUS array reference, so a consumer memoized on
      // `tasks` still sees no change even when the health flags moved.
      return { ...state, tasks: same ? state.tasks : event.tasks, loadFailed: false, failures: 0 };
    }
    case "pollFailed":
      // `tasks` is deliberately untouched: the last good read is better than an
      // empty list, and `loadFailed` is what stops it being read as "nothing ran".
      return { ...state, loadFailed: true, failures: state.failures + 1 };
    case "actionOk":
      return state.startError === null ? state : { ...state, startError: null };
    case "actionFailed":
      return { ...state, startError: { kind: event.kind, message: event.message } };
    case "clearError":
      return state.startError === null ? state : { ...state, startError: null };
    default:
      return state;
  }
}

// ── the schedule ───────────────────────────────────────────────────────────

/** Something is queued or running: poll fast enough that a progress bar moves. */
export const POLL_ACTIVE_MS = 2_000;
/** Nothing active: slow enough to be free, fast enough that a finished-elsewhere
 *  outcome shows up while the reader is still looking. */
export const POLL_IDLE_MS = 6_000;
/** First delay after a failed poll. */
export const POLL_BACKOFF_BASE_MS = 4_000;
/** The ceiling — a minute. Long enough to stop hammering a dead server, short
 *  enough that a restarted one is picked up without a page reload. */
export const POLL_BACKOFF_MAX_MS = 60_000;

/** How long to wait before the next poll. Healthy: 2s active / 6s idle. After N
 *  consecutive failures: 4s, 8s, 16s, 32s, then 60s for ever (2^(N-1) × 4s,
 *  capped). One success resets `failures` and the schedule with it. Pure. */
export function pollDelayMs(anyActive: boolean, failures: number): number {
  if (failures <= 0) return anyActive ? POLL_ACTIVE_MS : POLL_IDLE_MS;
  // Clamped exponent: `2 ** 2000` is Infinity, and Math.min(max, Infinity) would
  // still be `max` — but only by luck, and a NaN anywhere upstream would not be.
  const backoff = POLL_BACKOFF_BASE_MS * 2 ** Math.min(failures - 1, 10);
  return Math.min(POLL_BACKOFF_MAX_MS, backoff);
}

/** How many consecutive failures before the UI SAYS the queue is unreachable. One
 *  dropped request on a flaky connection is noise the next tick fixes; two in a row
 *  is a state the reader has to know about, because the list they are looking at is
 *  no longer live. */
export const POLL_UNREACHABLE_AFTER = 2;

/** Should the dock disclose "the queue is unreachable"? Pure. */
export function queueUnreachable(state: { failures: number }): boolean {
  return state.failures >= POLL_UNREACHABLE_AFTER;
}

// ── the full-record fetch's give-up counter ────────────────────────────────
// useTaskResult watches a task to completion and then fetches the FULL record
// once (the polled list omits result/params). A persistently failing GET
// /api/tasks/[id] used to retry for ever and SILENTLY: the task was done
// server-side while the UI spun "Working…" with no error and no way out. These
// two pure functions are that counter, so it can be pinned without a DOM.

/** How many failed full-record fetches (for a KNOWN-terminal task) the hook
 *  tolerates before giving up. Retries ride the poll tick, so this bounds the
 *  silent-spinner window rather than the number of requests. */
export const RESULT_FETCH_MAX_ATTEMPTS = 5;

/** The attempt count after one fetch. A success RESETS it: the counter is about
 *  a run of consecutive failures, not a lifetime tally. */
export function nextResultFetchAttempts(attempts: number, fetched: boolean): number {
  return fetched ? 0 : attempts + 1;
}

/** Has the hook exhausted its attempts? At that point the consumer MUST resolve
 *  its busy state and surface an error instead of spinning. */
export function resultFetchGaveUp(attempts: number): boolean {
  return attempts >= RESULT_FETCH_MAX_ATTEMPTS;
}
