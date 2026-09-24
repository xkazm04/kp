// The three human-approval gates of a role run (ADR-0011 §3), expressed as the
// screen-wave approval protocol applied at three call sites instead of one.
//
// THIS MODULE DELIBERATELY INVENTS NOTHING. Every primitive here delegates to
// screen-wave-approval.ts: the same signature over (scope, policy, exact subject set,
// issue time), the same 15-minute window, the same single-spend ledger, the same five
// refusal reasons. That protocol already carries the Art. 22 / EU AI Act argument that
// a human approval is a review OF A MOMENT and OF A SET, and a second gate shape would
// need its own compliance argument — which would almost certainly be weaker, and would
// certainly have to be re-made every time a reviewer asked.
//
// What this module adds is the SCOPE. screenWaveApprovalToken keys on a jobId, because
// there was one wave per job. A run has three gates, each over a different subject set,
// and a token approving a rejection set must never verify as a token approving an offer
// to the same people. So the scope is `<runId>#<gate>` and the policy string carries the
// gate's own policy version — both inside the hash, so neither can be swapped without
// invalidating the signature.

import {
  SCREEN_WAVE_APPROVAL_MAX_AGE_MS,
  ScreenWaveApprovalError,
  consumeScreenWaveApprovalToken,
  isScreenWaveApprovalSpent,
  screenWaveApprovalToken,
  verifyScreenWaveApprovalToken,
  type ScreenWaveRefusalReason,
} from "./screen-wave-approval.ts";
import { type ApprovalKind } from "./approval-kinds.ts";
import { STAGE_GATE, type RoleRunStageKind } from "./role-run-stages.ts";

/** The three gates, named by the decision rather than by the stage — because the
 *  decision is what the candidate feels, and a stage could be renamed. */
export const ROLE_RUN_GATES = ["rejection", "interview_invite", "offer"] as const;
export type RoleRunGate = (typeof ROLE_RUN_GATES)[number];

export function isRoleRunGate(value: unknown): value is RoleRunGate {
  return typeof value === "string" && (ROLE_RUN_GATES as readonly string[]).includes(value);
}

/** Which stage raises each gate. The inverse of STAGE_GATE, kept as its own literal
 *  so both directions are readable; `roleRunGatesMatchStages` in the test pins that
 *  they agree, which is the only way two literals stay honest. */
export const GATE_STAGE: Record<RoleRunGate, RoleRunStageKind> = {
  rejection: "screen",
  interview_invite: "interview",
  offer: "offer_draft",
};

/** The approval kind a gate stamps on the parked pipeline entry — the flag that routes
 *  it to the right recruiter surface. Read THROUGH STAGE_GATE rather than restated, so
 *  the taxonomy has exactly one declaration (approval-kinds.ts) and one mapping. */
export function gateApprovalKind(gate: RoleRunGate): ApprovalKind {
  const kind = STAGE_GATE[GATE_STAGE[gate]];
  // Unreachable while STAGE_GATE marks all three gated stages; the throw is here so a
  // stage accidentally un-gated fails loudly at the gate rather than silently minting
  // an unapproved invite.
  if (kind === null) throw new Error(`role-run gate "${gate}" maps to an ungated stage "${GATE_STAGE[gate]}"`);
  return kind;
}

/** Re-exported so a caller needs one import to know how long an approval lives. */
export { SCREEN_WAVE_APPROVAL_MAX_AGE_MS };

/** The signature scope. `#` cannot occur in a run id (randomId emits base36 and `-`),
 *  so the two halves can never be confused by a crafted id. */
function gateScope(runId: string, gate: RoleRunGate): string {
  return `${runId}#${gate}`;
}

/** The approval token a gate preview hands the recruiter: a stable, order-independent
 *  signature of THIS run's THIS gate over EXACTLY these subjects, under this policy, as
 *  of `issuedAt`. `subjectRefs` are entry ids — never names (ADR-0011 §5). */
export function roleRunGateToken(
  runId: string,
  gate: RoleRunGate,
  policyVersion: string,
  subjectRefs: string[],
  issuedAt: number = Date.now()
): string {
  return screenWaveApprovalToken(gateScope(runId, gate), `${gate}:${policyVersion}`, subjectRefs, issuedAt);
}

/** Verify WITHOUT spending — the token must be well-formed, must still sign the live
 *  subject set under the live policy, and must be inside the window. Used by a preview
 *  refresh and by tests; a commit must use `commitRoleRunGate`, which also spends. */
export function verifyRoleRunGateToken(
  token: string,
  runId: string,
  gate: RoleRunGate,
  policyVersion: string,
  subjectRefs: string[],
  now: number = Date.now()
): { ok: true } | { ok: false; reason: ScreenWaveRefusalReason } {
  const check = verifyScreenWaveApprovalToken(token, gateScope(runId, gate), `${gate}:${policyVersion}`, subjectRefs, now);
  if (check.ok) return { ok: true };
  // "malformed" is the protocol's word for a token that is not one of ours or is
  // back-dated; at the gate boundary that is the same refusal as a changed cohort —
  // re-preview and re-approve — so it maps onto the five-reason vocabulary as
  // "mismatch", the historical catch-all.
  return { ok: false, reason: check.reason === "malformed" ? "mismatch" : check.reason };
}

export function isRoleRunGateSpent(token: string, now: number = Date.now()): boolean {
  return isScreenWaveApprovalSpent(token, now);
}

export type GateCommitInput = {
  runId: string;
  gate: RoleRunGate;
  policyVersion: string;
  /** The EXACT set the human saw, as entry ids. */
  subjectRefs: string[];
  token: string | null | undefined;
  /** Who approved. A commit that cannot name its approver is refused: an approval with
   *  no attributable human is not an Art. 22 human review, it is an unsigned act. */
  approver: string | null | undefined;
  now?: number;
};

/** The commit gate. Runs every refusal in the order that matters, and only SPENDS the
 *  token once every other check has passed — a commit refused for a missing approver
 *  must not burn the recruiter's review.
 *
 *  Returns nothing on success; throws ScreenWaveApprovalError with the machine-readable
 *  reason otherwise, so the route can answer 409 with WHICH of the five refusals it was
 *  (a spent token is not a changed cohort, and a client that cannot tell them apart
 *  tells the recruiter to re-review a set that did not move). */
export function commitRoleRunGate(input: GateCommitInput): void {
  const now = input.now ?? Date.now();
  if (!input.token) {
    throw new ScreenWaveApprovalError(`the ${input.gate} gate requires a human approval token`, "required");
  }
  if (!input.approver || !input.approver.trim()) {
    throw new ScreenWaveApprovalError(`the ${input.gate} gate requires a named approver`, "unattributed");
  }
  const check = verifyRoleRunGateToken(input.token, input.runId, input.gate, input.policyVersion, input.subjectRefs, now);
  if (!check.ok) {
    throw new ScreenWaveApprovalError(
      check.reason === "expired"
        ? `the ${input.gate} approval is older than ${Math.round(SCREEN_WAVE_APPROVAL_MAX_AGE_MS / 60000)} minutes — re-preview and approve again`
        : `the ${input.gate} approval no longer signs this set — re-preview and approve again`,
      check.reason
    );
  }
  // Last, and only once: a replayed request inside the window would otherwise re-run
  // the adverse act on the human review of one.
  if (!consumeScreenWaveApprovalToken(input.token, now)) {
    throw new ScreenWaveApprovalError(`this ${input.gate} approval has already been committed`, "spent");
  }
}

export { ScreenWaveApprovalError };
export type { ScreenWaveRefusalReason };
