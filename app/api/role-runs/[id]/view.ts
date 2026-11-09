import { nextStageFor } from "@/app/_lib/role-run-stages";
import { GATE_STAGE, ROLE_RUN_GATES, type RoleRunGate } from "@/app/_lib/role-run-gates";
import { resolveRoleRunGateSubject } from "@/app/_lib/role-run-gate-preview";
import type { RoleRun, RoleRunStageArtifact } from "@/app/_lib/db/role-runs";
import type { RoleRunStageKind, RoleRunStageStatus } from "@/app/_lib/role-run-stages";

// The read model behind GET /api/role-runs/[id] (ADR-0011, review 2026-10-23 delivery 2).
//
// CODES AND REFS ONLY. A stage is its kind, status and branch ref; a parked gate is its
// gate id, policy version and entry ids. No payload, no candidate name, no prose crosses
// this projection (review section 6 "What not to change"): the payloads stay in the ledger
// and the gate preview is the one door that shows a recruiter the parked artifact.

export type RoleRunView = {
  run: Pick<RoleRun, "id" | "jobId" | "cycle" | "status" | "createdAt" | "updatedAt">;
  stages: { kind: RoleRunStageKind; branchRef: string | null; seq: number; status: RoleRunStageStatus; producedAt: string }[];
  /** One batch per gate that has branches parked on a human, in gate order. */
  gates: RoleRunGateBatch[];
};

export type RoleRunGateBatch = {
  gate: RoleRunGate;
  /** The stage that parks at this gate. */
  stage: RoleRunStageKind;
  policyVersion: string;
  /** The parked candidate branches (entry ids), oldest first: what one batch walks. */
  branchRefs: string[];
};

const GATE_OF_STAGE = new Map<RoleRunStageKind, RoleRunGate>(ROLE_RUN_GATES.map((g) => [GATE_STAGE[g], g]));

export function buildRoleRunView(run: RoleRun, artifacts: readonly RoleRunStageArtifact[], workspaceId: string): RoleRunView {
  const branches = [...new Set(artifacts.map((a) => a.branchRef).filter((b): b is string => b !== null))];
  const batches = new Map<RoleRunGate, RoleRunGateBatch>();
  for (const branchRef of branches) {
    const next = nextStageFor(artifacts, branchRef);
    if (next.action !== "await_gate") continue;
    const gate = GATE_OF_STAGE.get(next.kind);
    if (!gate) continue;
    let subject;
    try {
      subject = resolveRoleRunGateSubject(run.id, gate, branchRef, workspaceId);
    } catch {
      // best-effort: a branch that stopped being parked between the two reads is not a batch member
      continue;
    }
    const batch = batches.get(gate) ?? { gate, stage: next.kind, policyVersion: subject.policyVersion, branchRefs: [] };
    batch.branchRefs.push(branchRef);
    batches.set(gate, batch);
  }
  return {
    run: { id: run.id, jobId: run.jobId, cycle: run.cycle, status: run.status, createdAt: run.createdAt, updatedAt: run.updatedAt },
    stages: artifacts.map((a) => ({ kind: a.kind, branchRef: a.branchRef, seq: a.seq, status: a.status, producedAt: a.producedAt })),
    gates: ROLE_RUN_GATES.flatMap((g) => batches.get(g) ?? []),
  };
}
