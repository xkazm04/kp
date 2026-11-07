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
  // Round 4 PREVIEW acts (consent/acts.ts PREVIEW_ACTS) — bound to one candidate.
  // A held outreach letter: approve ONE revision (the door's CAS), or send the approved one.
  letterApprove: { required: ["entryId", "letterId", "revision"], allowed: ["entryId", "letterId", "revision", "label"] },
  letterSend: { required: ["entryId", "letterId"], allowed: ["entryId", "letterId", "revision", "label"] },
  // Book one offered time ("YYYY-MM-DD HH:MM" in the interview zone, the book door's
  // dateSlot); `when` is the slot's server-authored label, `zone` the interview zone.
  interviewBook: { required: ["entryId", "dateSlot"], allowed: ["entryId", "dateSlot", "label", "when", "zone"] },
  // Email the candidate a self-scheduling link (POST /api/schedule/invite {entryId}).
  interviewLink: { required: ["entryId"], allowed: ["entryId", "label"] },
};
