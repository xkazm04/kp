// The declared parameter shape of each act — the ONE table the validation door
// (engine/validate.ts) and the act resolver (acts.ts) both read, so what may be proposed
// and what can be armed can never drift apart. Import-free on purpose.
import type { ActKind } from "../types";

export const ACT_PARAMS: Record<ActKind, { required: readonly string[]; allowed: readonly string[] }> = {
  // One candidate, from a panel row: the id AND the stage the user saw (the door's CAS).
  entryAdvance: { required: ["entryId", "expectedStage"], allowed: ["entryId", "expectedStage", "label", "role"] },
  entryReject: { required: ["entryId", "expectedStage"], allowed: ["entryId", "expectedStage", "label", "role"] },
  // A typed wave: `mode` reject → `threshold` (1..100, `role` optional); advance → `count`.
  wave: { required: ["mode"], allowed: ["mode", "threshold", "count", "role"] },
  // A companion catalog action (app/_lib/companion-actions.ts COMPANION_ACTIONS ids).
  companion: { required: ["action"], allowed: ["action", "candidate", "role"] },
};
