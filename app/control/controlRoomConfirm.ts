// bug-ui-scan-2026-07-09 (guided-pipeline-simulation #3): the autonomy control room
// fired consequential, irreversible actions on a SINGLE click — approving an Art. 22
// human gate, shifting the promote floor that governs every future auto-decision, and
// reconciling — all with the same lightweight treatment as read-only nav, on a 3s-
// polling list whose rows shift under the cursor. This pure reducer backs a two-step
// "arm → confirm" gate for exactly those controls (pause/resume stay immediate — a
// kill switch must be). Extracted to a .ts sibling so `npm run test:unit` (node --test,
// which cannot load .tsx) can pin the "one click never executes" contract.

/** How long a Confirm stays armed. A parked second click after this does not fire. */
export const ARMED_TTL_MS = 15_000;

/** Abort an armed Confirm without executing. Bound to Escape in the control room. */
export function cancelArmed(): { execute: false; nextArmed: null } {
  return { execute: false, nextArmed: null };
}

/**
 * Given the currently-armed control key and the key just clicked, decide whether to
 * EXECUTE the action and what the next armed key should be:
 *   • First click on a control (or switching to a different one) → arms it, does NOT
 *     execute. This is the whole fix: a lone/mis-click can no longer act.
 *   • Second click on the SAME armed control → executes and disarms.
 *   • Second click after `ttlMs` has elapsed since `armedAtMs` → disarms WITHOUT
 *     executing. Same lesson as floorKey: a confirm must apply the decision the
 *     operator can still see.
 * `armed` is compared by identity, so distinct controls (a gate id, "floor",
 * "reconcile") never confuse each other.
 */
export function armOrExecute(
  armed: string | null,
  clicked: string,
  nowMs = 0,
  armedAtMs: number | null = null,
  ttlMs = ARMED_TTL_MS,
): { execute: boolean; nextArmed: string | null } {
  if (armed === clicked) {
    if (armedAtMs != null && nowMs - armedAtMs > ttlMs) return { execute: false, nextArmed: null };
    return { execute: true, nextArmed: null };
  }
  return { execute: false, nextArmed: clicked };
}

/**
 * The armed key for "apply the calibrated promote floor". The VALUE is part of the
 * control's identity, not incidental to it.
 *
 * The key used to be the bare literal "floor". Because the room re-polls
 * /api/devcase/outcomes every 3s and `calibrate()` recomputes `suggestedFloor` from
 * the live outcome corpus, the suggestion can move BETWEEN the arm click and the
 * confirm click (one newly-decided outcome is enough to flip which band first crosses
 * the majority-hire threshold — including one the operator records in this very
 * panel, which reloads on success). With a constant key the second click still
 * matched, so the confirm of "→ 70" fired `setFloor: 55`: a different promote
 * threshold than the one the operator deliberated over, applied without a second
 * confirm, and sealed into the audit trail as a human decision for 55.
 *
 * Keying by value makes a changed suggestion a DIFFERENT control, so `armOrExecute`
 * re-arms it (never executes) and the operator confirms the number they can see.
 */
export function floorKey(floor: number): string {
  return `floor:${floor}`;
}

/**
 * The armed key for "approve this Art. 22 gate". The VALUE is the on-screen
 * descriptor (title is truncated; `detail` is the lifecycle's own line), not
 * just the lifecycle id. A poll that replaces the row under the same id with a
 * different case is a DIFFERENT control, so armOrExecute re-arms instead of
 * signing off a descriptor the operator did not confirm.
 */
export function gateKey(id: string, detail: string | null | undefined): string {
  return `gate:${id}:${hashDetail(detail ?? "")}`;
}

function hashDetail(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
