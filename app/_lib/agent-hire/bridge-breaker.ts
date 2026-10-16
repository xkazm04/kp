// Circuit breaker for the Personas bridge DISPATCH path. Without it, a hung Personas
// costs every dispatch a full BRIDGE_TIMEOUT_MS before the 502. After
// BREAKER_THRESHOLD consecutive transport-level failures (timeout, network error, 5xx)
// calls fail fast for BREAKER_COOLDOWN_MS, then ONE trial call is let through
// (half-open): its success closes the breaker, its failure re-opens it.
//
// Process-local and in-memory on purpose: it is a latency guard, not state of record
// (a restart simply probes the bridge again). 4xx answers - a dead key (401), a refused
// request - mean Personas IS answering and never count against it.

export const BREAKER_THRESHOLD = 3;
export const BREAKER_COOLDOWN_MS = 30_000;

export const BRIDGE_CIRCUIT_OPEN_MESSAGE = "Personas has not been responding - retrying shortly.";

type BreakerState = { failures: number; openedAt: number | null; probing: boolean };

const state: BreakerState = { failures: 0, openedAt: null, probing: false };

/** True when the call should be refused without touching the network. */
export function bridgeCircuitOpen(now: number = Date.now()): boolean {
  if (state.openedAt === null) return false;
  if (now - state.openedAt < BREAKER_COOLDOWN_MS) return true;
  // Cooldown over: admit exactly one probe; concurrent callers keep failing fast.
  if (state.probing) return true;
  state.probing = true;
  return false;
}

export function recordBridgeSuccess(): void {
  state.failures = 0;
  state.openedAt = null;
  state.probing = false;
}

export function recordBridgeFailure(now: number = Date.now()): void {
  state.failures += 1;
  state.probing = false;
  if (state.failures >= BREAKER_THRESHOLD) state.openedAt = now;
}

/** Test hook. */
export function resetBridgeBreaker(): void {
  recordBridgeSuccess();
}
