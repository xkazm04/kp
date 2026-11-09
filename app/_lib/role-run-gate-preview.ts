import { readParkedGate } from "./role-run-engine.ts";
import { SCREEN_WAVE_APPROVAL_MAX_AGE_MS, roleRunGateToken, type RoleRunGate } from "./role-run-gates.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";

// The gate PREVIEW: what a recruiter is shown, and the token that signs exactly that.
//
// The subject set and the policy version are DERIVED HERE, on the server, from the
// parked artifact, for BOTH the preview and the commit. The client never supplies
// either: a client-supplied set would let the token sign whatever the caller said it
// reviewed. A parked artifact that changed between preview and commit therefore
// re-derives a different set and is refused "mismatch" by the protocol itself.

export type RoleRunGateSubject = {
  gate: RoleRunGate;
  branchRef: string;
  /** The policy the parked artifact was produced under; part of what the token signs. */
  policyVersion: string;
  /** Entry ids only — never names (ADR-0011 §5). */
  subjectRefs: string[];
  /** The parked payload: ids, scores, reason codes and hashes (PII-free by the write door). */
  parked: unknown;
};

export type RoleRunGatePreview = RoleRunGateSubject & {
  token: string;
  issuedAt: number;
  expiresAt: number;
};

/** The policy label for gates whose parked payload carries none of its own. */
const DEFAULT_GATE_POLICY: Record<RoleRunGate, string> = {
  rejection: "screen-1",
  interview_invite: "interview-1",
  offer: "offer-1",
};

const SUBJECT_LIST: Record<RoleRunGate, string> = {
  rejection: "decisions",
  interview_invite: "invites",
  offer: "drafts",
};

/** Throws RoleRunGateNotParkedError when the branch is not parked at `gate`. */
export function resolveRoleRunGateSubject(
  runId: string,
  gate: RoleRunGate,
  branchRef: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): RoleRunGateSubject {
  const parked = readParkedGate(runId, gate, branchRef, workspaceId);
  const payload = (typeof parked.payload === "object" && parked.payload !== null ? parked.payload : {}) as Record<string, unknown>;
  const list = payload[SUBJECT_LIST[gate]];
  const subjectRefs = (Array.isArray(list) ? list : [])
    .map((row) => (row as { entryId?: unknown } | null)?.entryId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const policy = typeof payload.policyVersion === "string" && payload.policyVersion ? payload.policyVersion : DEFAULT_GATE_POLICY[gate];
  return { gate, branchRef, policyVersion: policy, subjectRefs, parked: parked.payload };
}

export function previewRoleRunGate(
  runId: string,
  gate: RoleRunGate,
  branchRef: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  now: number = Date.now()
): RoleRunGatePreview {
  const subject = resolveRoleRunGateSubject(runId, gate, branchRef, workspaceId);
  return {
    ...subject,
    token: roleRunGateToken(runId, gate, subject.policyVersion, subject.subjectRefs, now),
    issuedAt: now,
    expiresAt: now + SCREEN_WAVE_APPROVAL_MAX_AGE_MS,
  };
}
