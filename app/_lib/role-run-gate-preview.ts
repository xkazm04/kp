import { readParkedGate } from "./role-run-engine.ts";
import { SCREEN_WAVE_APPROVAL_MAX_AGE_MS, roleRunGateToken, type RoleRunGate } from "./role-run-gates.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";
import { getPipelineEntriesByIds } from "./db/pipeline.ts";

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

/**
 * One candidate row of the read-only display block: who, what the machine proposes at this gate,
 * and its stated reason. DISPLAY ONLY. It is built AFTER the subject set is derived and is never
 * an input to the token, the policy version or the commit: ADR-0011 §3 still holds, the server
 * derives the signed set and the body names only the gate and the branch.
 *
 * `reasonCode` is a CODE read off the parked artifact (the screening pass's reason code), never
 * prose and never a colleague's filed scorecard or verdict (the offer draft's `basis` is left
 * out on purpose). Null = the artifact holds no reason; the panel says so in words.
 */
export type RoleRunGateDisplayRow = {
  entryId: string;
  /** The workspace-scoped pipeline entry's label; null when the entry is not in this workspace. */
  candidateName: string | null;
  proposal: { kind: "advance" | "hold" | "reject_proposed" | "invite" | "offer"; detail: string | null };
  reasonCode: string | null;
};

export type RoleRunGatePreview = RoleRunGateSubject & {
  /** Read-only; outside everything the token signs. */
  display: RoleRunGateDisplayRow[];
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

const asRows = (v: unknown): Record<string, unknown>[] =>
  (Array.isArray(v) ? v : []).filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** Pure: the display rows for one parked payload, names looked up through `nameOf`. */
export function buildGateDisplay(gate: RoleRunGate, payload: unknown, nameOf: (entryId: string) => string | null): RoleRunGateDisplayRow[] {
  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
  const out: RoleRunGateDisplayRow[] = [];
  for (const row of asRows(p[SUBJECT_LIST[gate]])) {
    const entryId = str(row.entryId);
    if (!entryId) continue;
    const candidateName = nameOf(entryId);
    if (gate === "rejection") {
      const route = row.route === "advance" || row.route === "reject_proposed" ? row.route : "hold";
      out.push({ entryId, candidateName, proposal: { kind: route, detail: null }, reasonCode: str(row.reasonCode) });
    } else if (gate === "interview_invite") {
      const detail = [str(row.status), str(row.slotAt)].filter(Boolean).join(" · ") || null;
      out.push({ entryId, candidateName, proposal: { kind: "invite", detail }, reasonCode: null });
    } else {
      const terms = (typeof row.terms === "object" && row.terms !== null ? row.terms : {}) as Record<string, unknown>;
      const days = typeof terms.ttlDays === "number" ? terms.ttlDays : row.ttlDays;
      const ttl = typeof days === "number" ? `${days}d` : null;
      const detail = [str(terms.band), str(terms.currency), ttl].filter(Boolean).join(" · ") || null;
      out.push({ entryId, candidateName, proposal: { kind: "offer", detail }, reasonCode: null });
    }
  }
  return out;
}

export function previewRoleRunGate(
  runId: string,
  gate: RoleRunGate,
  branchRef: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  now: number = Date.now()
): RoleRunGatePreview {
  const subject = resolveRoleRunGateSubject(runId, gate, branchRef, workspaceId);
  const entries = getPipelineEntriesByIds(subject.subjectRefs, workspaceId);
  const display = buildGateDisplay(gate, subject.parked, (id) => entries.get(id)?.candidateLabel ?? null);
  return {
    ...subject,
    display,
    token: roleRunGateToken(runId, gate, subject.policyVersion, subject.subjectRefs, now),
    issuedAt: now,
    expiresAt: now + SCREEN_WAVE_APPROVAL_MAX_AGE_MS,
  };
}
