// The guided tour's RUN-CONTROL ordering, extracted from SimulationProvider so it
// can be tested without React, a router or a DOM.
//
// Two things live here, and both were previously inlined in the provider's
// useCallbacks where nothing could reach them:
//
//  1. `runControlFlags` — what start/pause/resume/stop do to the mutable ctrl ref
//     the walk polls at every await checkpoint. The ordering matters: `resume`
//     must clear `paused` BEFORE waking the sleeper, or the woken walk re-reads a
//     still-true flag and parks itself again.
//
//  2. `performReset` — the destructive one. Its ORDER is the whole correctness
//     argument: request stop → wait for the in-flight run to settle → purge. A
//     purge that ran before the settle would delete rows a mutation already in
//     flight (e.g. /api/sim/inbound, which CREATES sim rows) then re-creates,
//     leaving un-purgeable residue behind.
//
// And the honesty fix: the provider used to `fetch("/api/sim/reset").catch(() =>
// undefined)` and then report `status.reset` unconditionally — a failed purge (a
// 500 from the DELETE transaction, an offline server) said "Reset" while every
// (SIM) row was still on the board. `performReset` reports the purge's real
// outcome and the provider renders "cleanup failed" when it is false.

export type SimRunAction = "start" | "pause" | "resume" | "stop";

/** The ctrl-ref shape the walk polls (the provider owns the ref; this owns the
 *  transitions). `wake` resolves the promise a gate/pause is parked on. */
export type SimRunFlags = { stop: boolean; paused: boolean };

/** The flags after `action`, given the current ones. Pure — the provider applies
 *  the result to its ref and calls `wake()` when `wakes` says so. */
export function runControlFlags(action: SimRunAction, prev: SimRunFlags): { flags: SimRunFlags; wakes: boolean } {
  switch (action) {
    // A fresh run clears BOTH flags: starting while a previous run left `stop`
    // set would make the new walk throw SimStop at its first checkpoint.
    case "start":
      return { flags: { stop: false, paused: false }, wakes: false };
    case "pause":
      return { flags: { ...prev, paused: true }, wakes: false };
    // Clear `paused` first, then wake: the woken walk re-reads the flag.
    case "resume":
      return { flags: { ...prev, paused: false }, wakes: true };
    // Stop also wakes — a run parked on a step gate would otherwise never
    // observe the flag and the reset that follows would wait forever.
    case "stop":
      return { flags: { ...prev, stop: true }, wakes: true };
  }
}

/** What a reset actually did. `cleared` is false when the purge did not answer
 *  2xx — the caller must NOT claim the demo data is gone. */
export type SimResetOutcome = { cleared: boolean; steps: SimResetStep[] };
export type SimResetStep = "stop" | "settle" | "purge";

export type SimResetDeps = {
  /** Flip the stop flag + wake any parked gate (synchronous). */
  requestStop: () => void;
  /** Await the in-flight run's promise (already caught by the caller). */
  settleRun: () => Promise<void>;
  /** POST /api/sim/reset — resolves TRUE only on a 2xx. */
  purge: () => Promise<boolean>;
};

/** stop → settle → purge, in that order, reporting whether the purge succeeded.
 *  A throwing purge counts as a failure, never as a silent success. */
export async function performReset(deps: SimResetDeps): Promise<SimResetOutcome> {
  const steps: SimResetStep[] = [];
  deps.requestStop();
  steps.push("stop");
  await deps.settleRun();
  steps.push("settle");
  let cleared = false;
  try {
    cleared = await deps.purge();
  } catch {
    // Network failure / non-JSON response: the rows are still there, so the
    // outcome is a FAILED cleanup — the one thing the old `.catch(() =>
    // undefined)` hid behind a green "Reset".
    cleared = false;
  }
  steps.push("purge");
  return { cleared, steps };
}
