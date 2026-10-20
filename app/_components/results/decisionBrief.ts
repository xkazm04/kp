// The decision brief (challenge-r07 results-core/B): what the recruiter's
// advance/hold/pass is taken AGAINST. The engine's open trust warnings and the
// job-fit gaps used to sit one panel below the decision buttons (QualityStrip),
// so "Advance" on a run whose ledger said "verify before advancing" was one silent
// click, indistinguishable afterwards from an advance on a clean run.
//
// ONE pure module, read by both sides of the door: DispositionEditor renders the
// brief inline and gates the click; PATCH /api/analyses/[slug] re-derives the open
// warnings from the STORED payload and refuses an un-acknowledged transition to
// advance (DISPOSITION_ACK_REQUIRED). Warnings come from trustLedger, so a coded
// payload is read by severity and a legacy one by the regex fallback.
import { trustLedger, trustedScoreTotal, type TrustFinding } from "@/app/_lib/sanity-checks";
import { SCORE_STRONG_MIN } from "@/app/_lib/format";

export type DecisionSource = {
  sanityChecks?: readonly string[] | null;
  trustFindings?: readonly TrustFinding[] | null;
  score?: Parameters<typeof trustedScoreTotal>[0]["score"];
  jobFit?: { missingSkills?: readonly string[] | null } | null;
};

export type DecisionBrief = {
  /** Warn + blocker ledger sentences, in ledger order: what an advance must acknowledge. */
  openWarns: string[];
  /** Job-fit must-haves the CV did not show. Informational, never gating. */
  missing: string[];
  /** The trusted overall score (null = unscored), recorded into the decision basis. */
  score: number | null;
  /** The read is strong: passing it needs a stated reason. */
  strong: boolean;
};

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];

/** Tolerates any stored payload shape: a corrupt or legacy row yields an empty brief. */
export function decisionBrief(analysis: unknown): DecisionBrief {
  if (!analysis || typeof analysis !== "object") return { openWarns: [], missing: [], score: null, strong: false };
  const a = analysis as DecisionSource;
  const findings = Array.isArray(a.trustFindings) ? a.trustFindings : null;
  const { warns } = trustLedger({ sanityChecks: strings(a.sanityChecks), trustFindings: findings });
  let score: number | null = null;
  try {
    score = a.score && typeof a.score === "object" ? trustedScoreTotal({ ...a, trustFindings: findings, sanityChecks: strings(a.sanityChecks) }) : null;
  } catch {
    score = null; // a malformed score object is an unscored read, never a thrown PATCH
  }
  return {
    openWarns: [...new Set(warns)],
    missing: strings(a.jobFit?.missingSkills),
    score,
    strong: score !== null && score >= SCORE_STRONG_MIN,
  };
}

export type DecisionGate =
  | { canSave: true }
  | { canSave: false; needs: "ack"; pending: string[] }
  | { canSave: false; needs: "reason" };

/** What a disposition needs before it may be saved. Advance: every open warning
 *  acknowledged. Pass on a strong read: a non-blank reason. Hold and clearing:
 *  nothing. `stored` is the disposition already on the row: re-saving the same one
 *  (a note-only edit, the unmount flush) is never gated, so a legacy decision is
 *  never locked. */
export function decisionGate(
  brief: DecisionBrief,
  disposition: string,
  opts: { acknowledged?: readonly string[]; note?: string; stored?: string | null } = {}
): DecisionGate {
  if (disposition !== "advance" && disposition !== "pass") return { canSave: true };
  if (opts.stored === disposition) return { canSave: true };
  if (disposition === "advance") {
    const acked = new Set(opts.acknowledged ?? []);
    const pending = brief.openWarns.filter((w) => !acked.has(w));
    return pending.length ? { canSave: false, needs: "ack", pending } : { canSave: true };
  }
  return brief.strong && !(opts.note ?? "").trim() ? { canSave: false, needs: "reason" } : { canSave: true };
}

export type DecisionBasis = {
  score: number | null;
  openWarns: string[];
  acknowledged: string[];
  decidedAt: string;
};

/** The record of what a decision was made against, stored on the analyses row.
 *  `acknowledged` keeps only lines that were actually open (a client cannot
 *  acknowledge a warning the engine never raised). */
export function decisionBasis(brief: DecisionBrief, acknowledged: readonly string[], now: Date = new Date()): DecisionBasis {
  const acked = new Set(acknowledged);
  return {
    score: brief.score,
    openWarns: brief.openWarns,
    acknowledged: brief.openWarns.filter((w) => acked.has(w)),
    decidedAt: now.toISOString(),
  };
}

/** The ONE PATCH body the editor sends, from every path (pick, note autosave, blur,
 *  keepalive unmount flush): it always carries `acknowledged`, so no path can
 *  re-issue an advance without the acknowledgements the click was gated on. */
export function dispositionPatchBody(disposition: string, note: string, acknowledged: readonly string[]) {
  return { disposition, note, acknowledged: [...acknowledged] };
}

export const DISPOSITION_ACK_REQUIRED = "DISPOSITION_ACK_REQUIRED";

/** The disposition to show once a save settled. A refused advance rolls the
 *  optimistic pick back to the stored value, so the debounced note autosave and the
 *  unmount flush carry the STORED disposition afterwards, never the refused one. */
export function settleDisposition(s: { attempted: string; stored: string; ok: boolean; code?: string | null }): string {
  if (s.ok) return s.attempted;
  return s.code === DISPOSITION_ACK_REQUIRED ? s.stored : s.attempted;
}
