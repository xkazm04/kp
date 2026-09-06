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

// --- The tenant's real state, read on boot (/perfect wave 44) ------------------
//
// The console's whole idea of itself used to be browser state: the lease lived on
// the server, `IDLE_STATE` is what a fresh provider mounts with, and nothing ever
// asked. So a reload showed an idle deck in the ops face, the guide button's only
// action from there is START (`guideAction`), and that start was refused for up to
// five minutes with "stop it first" — addressed to a tab that no longer existed.
//
// `GET /api/sim/reset` answers what the server knows; this is the client's copy of
// it. A tiny external store rather than provider state, because the two readers are
// on opposite sides of the tree (the dock's `useControlMode` decides which face to
// wear; the provider's reset is what makes the answer stale) and neither owns the
// other. `useSyncExternalStore` in the kit reads it; nothing writes it but
// `refreshSimDoor`.

/** What the status door reports about THIS tenant. `residue` is the total count of
 *  rows a previous walk left behind — the number, not the breakdown, is what the
 *  console decides on. */
export type SimDoorState = { runActive: boolean; ownedByMe: boolean; residue: number };

/** Nothing known yet: the pre-fetch snapshot AND the server snapshot. A door that
 *  has not answered must not make the deck claim a run is live. */
export const SIM_DOOR_IDLE: SimDoorState = { runActive: false, ownedByMe: false, residue: 0 };

/** Parse the door's body. Pure and defensive: an older server, an HTML error page
 *  or a proxy's JSON all land here, and every one of them means "nothing known",
 *  never a fabricated live run. */
export function parseSimDoor(body: unknown): SimDoorState {
  if (typeof body !== "object" || body === null) return SIM_DOOR_IDLE;
  const b = body as { runActive?: unknown; ownedByMe?: unknown; residue?: unknown };
  const residue = b.residue as { total?: unknown } | undefined;
  return {
    runActive: b.runActive === true,
    ownedByMe: b.ownedByMe === true,
    residue: typeof residue === "object" && residue !== null && typeof residue.total === "number" ? residue.total : 0,
  };
}

/** Which face the control deck wears. Extracted from `useControlMode` so the ONE
 *  rule that changed is testable without React.
 *
 *  The addition is the last clause: a tenant that HOLDS a lease, or still carries a
 *  previous walk's residue, gets the console — because the console is where Reset
 *  lives, and both of those states are exactly the ones a Reset answers. Before it,
 *  the only route from an idle ops deck into the console was pressing the guide
 *  button, whose action from `ops` is `start` — so the one control that could reach
 *  the cleanup first began the run that made the mess bigger. */
export function consoleMode(
  sim: { running: boolean; done: boolean; error: string | null },
  simAutoParam: boolean,
  door: SimDoorState
): "sim" | "ops" {
  if (sim.running || sim.done || sim.error !== null || simAutoParam) return "sim";
  return door.runActive || door.residue > 0 ? "sim" : "ops";
}

let doorState: SimDoorState = SIM_DOOR_IDLE;
const doorListeners = new Set<() => void>();

/** `useSyncExternalStore`'s snapshot. Stable identity between refreshes — a new
 *  object per call would re-render every reader forever. */
export function simDoorSnapshot(): SimDoorState {
  return doorState;
}

export function subscribeSimDoor(onChange: () => void): () => void {
  doorListeners.add(onChange);
  return () => doorListeners.delete(onChange);
}

/** Re-read the door. Called once when the console mounts and again after a reset
 *  (which is precisely what makes the residue count wrong).
 *
 *  Best-effort: an unreachable door leaves the last snapshot standing rather than
 *  wiping it to idle. A transient 500 is not evidence the tenant is clean, and
 *  claiming it is would hide the Reset the operator is looking for. */
export async function refreshSimDoor(fetchImpl: typeof fetch = fetch): Promise<SimDoorState> {
  try {
    const r = await fetchImpl("/api/sim/reset", { method: "GET" });
    if (!r.ok) return doorState;
    const next = parseSimDoor(await r.json());
    if (next.runActive === doorState.runActive && next.ownedByMe === doorState.ownedByMe && next.residue === doorState.residue) {
      return doorState; // same facts, same object: no reader re-renders
    }
    doorState = next;
    for (const l of doorListeners) l();
    return doorState;
  } catch {
    // Offline or a non-JSON body: keep what we had. The console is a demo surface,
    // and an unreachable status door is not something a viewer would act on.
    return doorState;
  }
}

/** Test seam only: forget the door's answer. */
export function __resetSimDoor(): void {
  doorState = SIM_DOOR_IDLE;
  doorListeners.clear();
}

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

/** What the purge door actually answered.
 *
 *  A BOOLEAN was the bug (/perfect wave 44): the route computes a thirteen-table
 *  `cleared` count and, when a run holds the tenant, refuses with a CODE and the
 *  holder's `retryAfterSeconds` — and the client threw all three away. So a success
 *  said "Reset" with no idea what it had removed, and a 409 said "Cleanup failed.
 *  Try again", which is the one instruction that cannot work: retrying is refused
 *  for exactly as long as the lease has left, and nothing told the operator that. */
export type SimPurgeOutcome =
  | { ok: true; cleared: number }
  | { ok: false; code: string | null; retryAfterSeconds: number | null };

/** What a reset actually did. `purge` carries the door's own answer; `steps` is the
 *  ordering proof. */
export type SimResetOutcome = { purge: SimPurgeOutcome; steps: SimResetStep[] };
export type SimResetStep = "stop" | "settle" | "purge";

/** The total rows a purge removed, summed from the route's per-table map. Tolerant
 *  of a body that is not that map: an unknown shape counts as nothing cleared, which
 *  is the honest reading of "we cannot tell". */
export function totalCleared(cleared: unknown): number {
  if (typeof cleared !== "object" || cleared === null) return 0;
  let sum = 0;
  for (const v of Object.values(cleared as Record<string, unknown>)) if (typeof v === "number" && v > 0) sum += v;
  return sum;
}

/** The `errors` catalog key that says the same refusal WITH the wait attached, or
 *  null when there is no wait to state.
 *
 *  Same shape as `capabilityAwareReason` (use-error-message.ts): the code's own
 *  message stays placeholder-free, because other consumers resolve it with no
 *  values and a required ICU argument would break every one of them. A client that
 *  HOLDS the seconds renders the richer variant instead. */
const SIM_WAIT_VARIANT: Record<string, string> = {
  SIM_RUN_ACTIVE: "simRunActiveSeconds",
  SIM_RUN_NOT_OWNER: "simRunNotOwnerSeconds",
};

export function simWaitVariant(code: string | null | undefined, retryAfterSeconds: number | null | undefined): string | null {
  if (!code || typeof retryAfterSeconds !== "number" || retryAfterSeconds <= 0) return null;
  return SIM_WAIT_VARIANT[code] ?? null;
}

export type SimResetDeps = {
  /** Flip the stop flag + wake any parked gate (synchronous). */
  requestStop: () => void;
  /** Await the in-flight run's promise (already caught by the caller). */
  settleRun: () => Promise<void>;
  /** POST /api/sim/reset, parsed: the counts on a 2xx, the code and the wait on a
   *  refusal. */
  purge: () => Promise<SimPurgeOutcome>;
};

/** stop → settle → purge, in that order, reporting whether the purge succeeded.
 *  A throwing purge counts as a failure, never as a silent success. */
export async function performReset(deps: SimResetDeps): Promise<SimResetOutcome> {
  const steps: SimResetStep[] = [];
  deps.requestStop();
  steps.push("stop");
  await deps.settleRun();
  steps.push("settle");
  let purge: SimPurgeOutcome;
  try {
    purge = await deps.purge();
  } catch {
    // Network failure / non-JSON response: the rows are still there, so the
    // outcome is a FAILED cleanup — the one thing the old `.catch(() =>
    // undefined)` hid behind a green "Reset". No code, because there is no
    // answer to read one out of; the caller falls back to its own copy.
    purge = { ok: false, code: null, retryAfterSeconds: null };
  }
  steps.push("purge");
  return { purge, steps };
}
