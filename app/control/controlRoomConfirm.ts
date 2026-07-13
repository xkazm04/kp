// bug-ui-scan-2026-07-09 (guided-pipeline-simulation #3): the autonomy control room
// fired consequential, irreversible actions on a SINGLE click — approving an Art. 22
// human gate, shifting the promote floor that governs every future auto-decision, and
// reconciling — all with the same lightweight treatment as read-only nav, on a 3s-
// polling list whose rows shift under the cursor. This pure reducer backs a two-step
// "arm → confirm" gate for exactly those controls (pause/resume stay immediate — a
// kill switch must be). Extracted to a .ts sibling so `npm run test:unit` (node --test,
// which cannot load .tsx) can pin the "one click never executes" contract.

/**
 * Given the currently-armed control key and the key just clicked, decide whether to
 * EXECUTE the action and what the next armed key should be:
 *   • First click on a control (or switching to a different one) → arms it, does NOT
 *     execute. This is the whole fix: a lone/mis-click can no longer act.
 *   • Second click on the SAME armed control → executes and disarms.
 * `armed` is compared by identity, so distinct controls (a gate id, "floor",
 * "reconcile") never confuse each other.
 */
export function armOrExecute(armed: string | null, clicked: string): { execute: boolean; nextArmed: string | null } {
  if (armed === clicked) return { execute: true, nextArmed: null };
  return { execute: false, nextArmed: clicked };
}
