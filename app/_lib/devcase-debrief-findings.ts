import { createHash } from "node:crypto";
import { canonicalize } from "./decision-hash";
import { listDecisionRecords, sealDecisionRecord } from "./decision-record-store";
import { bundleTraceUnwitnessed, type DevSubmission } from "./db/devcase";

// C4 — RECORDED DEBRIEF FINDINGS RELEASE HOLDS.
//
// A suspect authenticity band or an unwitnessed trace HOLDS promote and permanent
// observed-provenance minting (C2). Until now the only way out was to wait. The way out
// is the debrief the minted follow-ups exist for: the interviewer records ONE finding per
// follow-up, and a human then seals an `authorship_verified` decision bound to a DIGEST of
// the submission. That decision is `clearedBy`, and it is the only exit — the band and the
// score are never edited, they stay as history.
//
// No new store: both records ride the decision system of record (a tamper-evident chain)
// keyed on the submission id. Because the clearance carries the digest it was made
// against, re-evaluating the submission (a different bundle, a different digest) silently
// retires it; nothing has to remember to delete anything. Fully deterministic — no LLM.

export const FINDING_KINDS = ["supported", "revised", "not_evidenced", "not_asked"] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];
/** Findings that say something against the candidate: they must carry the words heard. */
export const ADVERSE_FINDINGS: readonly FindingKind[] = ["revised", "not_evidenced"];

export const DEBRIEF_FINDINGS_KIND = "debrief_findings";
export const AUTHORSHIP_VERIFIED_KIND = "authorship_verified";

/** Share of the follow-ups that must read `supported` before a human may clear. Four of
 *  five clears; an unasked follow-up counts against, it is never a midpoint. */
export const CLEARANCE_SUPPORTED_SHARE = 0.8;

const MAX_QUOTE = 1_000;
const MAX_FOLLOWUPS = 30;

export type DebriefFinding = { followupIndex: number; kind: FindingKind; quote?: string };

export class DebriefFindingError extends Error {
  constructor(
    readonly code: "DEBRIEF_FINDING_QUOTE_REQUIRED" | "DEBRIEF_FINDING_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "DebriefFindingError";
  }
}

function followupsOf(evaluation: unknown): unknown[] {
  const q = (evaluation as { followups?: { questions?: unknown } } | null | undefined)?.followups?.questions;
  if (!Array.isArray(q)) return [];
  // Same filter as submissionFollowups: only a follow-up with a question is on the agenda.
  return q
    .filter((f) => typeof (f as { question?: unknown } | null)?.question === "string" && (f as { question: string }).question.trim() !== "")
    .slice(0, MAX_FOLLOWUPS);
}

/** How many follow-ups the debrief covers for this submission. */
export function followupCount(sub: DevSubmission): number {
  return followupsOf(sub.evaluation).length;
}

/** What a clearance is bound to: the stored evaluation and its score. Any re-evaluation
 *  that writes a different bundle (it stamps `evaluatedAt`) changes it. */
export function submissionDigest(sub: DevSubmission): string {
  return createHash("sha256")
    .update(canonicalize({ id: sub.id, evaluation: sub.evaluation, transferScore: sub.transferScore }))
    .digest("hex");
}

/** Validate raw input at the trust boundary. Uncovered follow-ups are NOT filled here —
 *  absence is read back as `not_asked` by readDebriefFindings. */
export function normalizeFindings(raw: unknown, count: number): DebriefFinding[] {
  if (!Array.isArray(raw)) throw new DebriefFindingError("DEBRIEF_FINDING_INVALID", "findings must be a list");
  const byIndex = new Map<number, DebriefFinding>();
  for (const item of raw) {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const idx = typeof r.followupIndex === "number" ? r.followupIndex : Number(r.followupIndex);
    const kind = r.kind;
    if (!Number.isInteger(idx) || idx < 1 || idx > count || typeof kind !== "string" || !(FINDING_KINDS as readonly string[]).includes(kind)) {
      throw new DebriefFindingError("DEBRIEF_FINDING_INVALID", "unknown follow-up or finding kind");
    }
    const quote = typeof r.quote === "string" ? r.quote.trim().slice(0, MAX_QUOTE) : "";
    if ((ADVERSE_FINDINGS as readonly string[]).includes(kind) && !quote) {
      throw new DebriefFindingError("DEBRIEF_FINDING_QUOTE_REQUIRED", "an adverse finding needs the candidate's words");
    }
    byIndex.set(idx, quote ? { followupIndex: idx, kind: kind as FindingKind, quote } : { followupIndex: idx, kind: kind as FindingKind });
  }
  return [...byIndex.values()].sort((a, b) => a.followupIndex - b.followupIndex);
}

/** Seal the interviewer's findings against the submission as it is NOW. */
export function recordDebriefFindings(sub: DevSubmission, raw: unknown, actor: string): { digest: string; findings: DebriefFinding[] } {
  const count = followupCount(sub);
  const findings = normalizeFindings(raw, count);
  const digest = submissionDigest(sub);
  sealDecisionRecord(
    {
      kind: DEBRIEF_FINDINGS_KIND,
      actor,
      policyVersion: "human",
      candidateRef: sub.id,
      rationale: `Debrief findings recorded for ${findings.length} of ${count} follow-ups.`,
      reasonCode: "debrief_findings",
      inputs: { digest, findings },
    },
    sub.workspaceId,
  );
  return { digest, findings };
}

type Sealed = { actor: string; findings: DebriefFinding[] };

/** The newest record of `kind` sealed against THIS evaluation's digest. */
function sealedFor(sub: DevSubmission, kind: string): Sealed | null {
  const digest = submissionDigest(sub);
  for (const rec of listDecisionRecords({ candidateRef: sub.id, workspaceId: sub.workspaceId, limit: 100 })) {
    if (rec.kind !== kind) continue;
    let inputs: { digest?: unknown; findings?: unknown } = {};
    try {
      inputs = (JSON.parse(rec.payloadJson) as { inputs?: typeof inputs }).inputs ?? {};
    } catch {
      continue; // best-effort: an unreadable record binds nothing
    }
    if (inputs.digest !== digest) continue; // sealed against another evaluation: history
    return { actor: rec.actor, findings: Array.isArray(inputs.findings) ? (inputs.findings as DebriefFinding[]) : [] };
  }
  return null;
}

export type DebriefReadout = {
  /** One entry per follow-up, in order; an uncovered one reads `not_asked`. */
  findings: DebriefFinding[];
  /** Did the interviewer record anything against THIS evaluation. */
  recorded: boolean;
  supported: number;
  total: number;
};

export function readDebriefFindings(sub: DevSubmission): DebriefReadout {
  const total = followupCount(sub);
  const sealed = sealedFor(sub, DEBRIEF_FINDINGS_KIND);
  const byIndex = new Map((sealed?.findings ?? []).map((f) => [f.followupIndex, f]));
  const findings = Array.from({ length: total }, (_, i): DebriefFinding => byIndex.get(i + 1) ?? { followupIndex: i + 1, kind: "not_asked" });
  return { findings, recorded: sealed !== null, supported: findings.filter((f) => f.kind === "supported").length, total };
}

export type ClearanceVerdict = { cleared: true; clearedBy: string } | { cleared: false; reason: "not_held" | "no_findings" | "below_bar" };

/** A human attests the authorship, bound to the digest. Refused without findings or under
 *  the bar — the hold is never released on the recruiter's say-so alone. */
export function clearAuthorship(sub: DevSubmission, actor: string): ClearanceVerdict {
  if (!heldForAuthorship(sub)) return { cleared: false, reason: "not_held" };
  const read = readDebriefFindings(sub);
  if (!read.recorded || read.total === 0) return { cleared: false, reason: "no_findings" };
  if (read.supported / read.total < CLEARANCE_SUPPORTED_SHARE) return { cleared: false, reason: "below_bar" };
  const digest = submissionDigest(sub);
  sealDecisionRecord(
    {
      kind: AUTHORSHIP_VERIFIED_KIND,
      actor,
      policyVersion: "human",
      candidateRef: sub.id,
      rationale: `Authorship verified in the debrief — ${read.supported} of ${read.total} follow-ups supported.`,
      reasonCode: "authorship_verified",
      inputs: { digest, supported: read.supported, total: read.total, findings: read.findings },
    },
    sub.workspaceId,
  );
  return { cleared: true, clearedBy: actor };
}

/** Who cleared this evaluation, or null — also null once the submission was re-evaluated. */
export function clearedByFor(sub: DevSubmission): string | null {
  return sealedFor(sub, AUTHORSHIP_VERIFIED_KIND)?.actor ?? null;
}

/** Suspect band or unwitnessed trace, with no clearance on this evaluation. */
export function heldForAuthorship(sub: DevSubmission): boolean {
  const band = (sub.evaluation as { authenticity?: { band?: unknown } } | null | undefined)?.authenticity?.band;
  if (band !== "suspect" && !bundleTraceUnwitnessed(sub.evaluation)) return false;
  return clearedByFor(sub) === null;
}
