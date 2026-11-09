import { STAGE_GATE, type RoleRunStageKind } from "./role-run-stages.ts";

// The proof that a human gate was committed (ADR-0011 §3).
//
// The three gates are enforced by the ENGINE: commitRoleRunStageGate verifies and spends
// the approval token and only then appends the resolution. But the ledger's write door
// (appendStageArtifact) used to check only PII and run ownership, so any direct caller
// could append `screen:complete` after `screen:awaiting_approval` with no token spent and
// no approver. The transition table allows exactly that edge, so it could not stop it.
//
// A receipt closes that: it can only be minted by `mintGateReceipt`, which only
// commitRoleRunGate calls after the token is verified AND spent, and the write door
// refuses a gated resolution row without one. Identity is held in a module-private
// WeakSet, so a caller cannot forge one by shaping an object literal.

export type RoleRunGateReceipt = Readonly<{ runId: string; kind: RoleRunStageKind }>;

const minted = new WeakSet<object>();

/** Mint a receipt. Called ONLY from commitRoleRunGate, after the approval was spent. */
export function mintGateReceipt(runId: string, kind: RoleRunStageKind): RoleRunGateReceipt {
  const receipt: RoleRunGateReceipt = Object.freeze({ runId, kind });
  minted.add(receipt);
  return receipt;
}

export function isGateReceipt(value: unknown): value is RoleRunGateReceipt {
  return typeof value === "object" && value !== null && minted.has(value);
}

/** A row that RESOLVES a gate: a gated stage kind written `complete` or `terminal`.
 *  (`awaiting_approval` is the question, not the answer, and needs no human.) */
export function isGateResolution(kind: RoleRunStageKind, status: string): boolean {
  return STAGE_GATE[kind] !== null && (status === "complete" || status === "terminal");
}

export class RoleRunGateMissingError extends Error {
  readonly kind: RoleRunStageKind;
  constructor(kind: RoleRunStageKind, why: string) {
    super(`a ${kind} gate resolution needs committed approval evidence: ${why}`);
    this.name = "RoleRunGateMissingError";
    this.kind = kind;
  }
}
