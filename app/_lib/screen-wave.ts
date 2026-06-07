import { actOnPipelineEntry, listPipeline, recordAutomationEvent } from "./db";
import { getDecisionConfig, type ScreeningRule } from "./decision-config-store";
import { DecisionConfigError, screenBottomCount, tieSafeBottomCount, validateScreeningOverride } from "./decision-config-schema";
import { dispatchRejection } from "./comms-dispatch";
import { isFairnessProtected, isKnownArchetype } from "./archetypes";

// Phase 3 — the screening "first wave" of automated decisions. For a role's
// matched cohort, auto-reject the bottom `rejectBottomPercent` that are ALSO
// below `maxMatchToReject` match — NEVER an early-career (or otherwise
// unclassifiable) candidate: the fairness gate from automation.py is preserved
// and now FAILS CLOSED via isFairnessProtected. Every auto-decision is audited
// with a rationale and the candidate gets a queued rejection comm.

export type ScreenDecision = {
  entryId: string;
  label: string;
  archetype: string | null;
  matchScore: number;
  action: "reject" | "keep";
  rationale: string;
};

// Why a candidate was KEPT (not auto-rejected). These strings are persisted to the
// audit trail and shown to users, so they must stay byte-identical — a guarded pure
// helper keeps the branches readable and unit-testable. Order mirrors the auto-reject
// gate: auto-reject off / fairness-protected (known=early-career vs unknown archetype)
// / tie spared at the cutoff / above the bottom cutoff / at-or-above the match
// threshold. `inBottom` is measured against the TIE-SAFE effective cutoff (see
// tieSafeBottomCount); `tieSpared` flags a candidate the raw bottom-% would have
// rejected but the tie-break kept so an equal score isn't split.
export function keepReason(
  cfg: ScreeningRule,
  protectedFromAutoReject: boolean,
  knownArchetype: boolean,
  inBottom: boolean,
  tieSpared: boolean
): string {
  if (!cfg.autoRejectEnabled) return "auto-reject off";
  if (protectedFromAutoReject) {
    return knownArchetype ? "early-career — never auto-rejected" : "unknown archetype — shielded (fail-closed)";
  }
  // Spared because rejecting them would split a tied match score across the cutoff
  // (idea-50062f77): kept so an indistinguishable peer above the cutoff isn't
  // treated differently. Checked before the plain "above the cutoff" reason — a
  // tie-spared candidate IS above the *effective* cutoff, but only because the tie
  // moved the boundary, and the audit trail should say so explicitly.
  if (tieSpared) return "tie at cutoff — kept so equal scores aren't split";
  if (!inBottom) return "above the bottom cutoff";
  return "match at/above threshold";
}

export async function runScreenWave(
  jobId: string,
  override?: Partial<ScreeningRule>
): Promise<{ decisions: ScreenDecision[]; rejected: number; kept: number; cohort: number; config: ScreeningRule }> {
  // Backstop: never merge an unvalidated override into the live config that
  // drives irreversible auto-rejections. The route validates first (→ 400), but
  // enforcing the schema HERE — at the actual destructive operation — guarantees
  // a malformed/out-of-range override can't reach the bottom-% math through any
  // other caller. Mirrors setDecisionConfig's write-boundary backstop; throws
  // DecisionConfigError, which the route maps to a 400.
  const checked = validateScreeningOverride(override);
  if (!checked.ok) throw new DecisionConfigError(checked.error);
  const cfg: ScreeningRule = { ...getDecisionConfig<ScreeningRule>("screening"), ...checked.override };
  const cohort = listPipeline().filter((e) => e.jobId === jobId && e.status === "active" && e.stage === "Screened");
  const sorted = [...cohort].sort((a, b) => (a.matchScore ?? 0) - (b.matchScore ?? 0)); // worst first
  const n = sorted.length;
  // Small-cohort policy lives in decision-config-schema.ts: floor, but never
  // below one candidate in a non-empty pool — so a small role is no longer
  // silently exempt from an auto-reject the recruiter switched on (idea-582ff3b2).
  const bottomCount = screenBottomCount(n, cfg.rejectBottomPercent);
  // Tie-break: that raw count can split a run of IDENTICAL match scores across the
  // cutoff, and the stable sort above would decide that split by pipeline arrival
  // order — equal candidates getting opposite automated outcomes (idea-50062f77).
  // tieSafeBottomCount shrinks the cutoff so no tied score is split; the straddling
  // tie is KEPT. Uses the same `?? 0` coercion as the sort, so this is independent
  // of the separate null-score policy.
  const effectiveBottomCount = tieSafeBottomCount(
    sorted.map((e) => e.matchScore ?? 0),
    bottomCount
  );

  const decisions: ScreenDecision[] = [];
  let rejected = 0;
  for (let rank = 0; rank < sorted.length; rank++) {
    const e = sorted[rank];
    const score = e.matchScore ?? 0;
    // Fairness gate fails CLOSED: early-career AND any unknown/renamed archetype
    // are shielded from auto-rejection. An unrecognized archetype is data drift —
    // record it so the desync is visible instead of silently auto-rejecting a
    // candidate the fairness rule was meant to protect.
    const protectedFromAutoReject = isFairnessProtected(e.archetype);
    const knownArchetype = isKnownArchetype(e.archetype);
    if (!knownArchetype) {
      recordAutomationEvent(e.id, "fairness_gate_unknown_archetype", `Unknown archetype "${e.archetype ?? "(null)"}" — shielded from auto-rejection (fail-closed).`);
    }
    const inBottom = rank < effectiveBottomCount;
    // Inside the raw bottom-% but above the tie-safe cutoff → kept only because the
    // tie-break refused to split an equal score (idea-50062f77).
    const tieSpared = rank >= effectiveBottomCount && rank < bottomCount;
    const belowThreshold = score < cfg.maxMatchToReject;

    if (cfg.autoRejectEnabled && inBottom && belowThreshold && !protectedFromAutoReject) {
      // Report the EFFECTIVE (tie-safe) cutoff actually applied, noting when it was
      // shrunk from the raw bottom-% so the auto-reject boundary stays reproducible.
      const tieNote = effectiveBottomCount < bottomCount ? ` (tie-adjusted from ${bottomCount} so no equal score is split)` : "";
      const rationale = `Auto-rejected · bottom ${cfg.rejectBottomPercent}% of ${n} → ${effectiveBottomCount}${tieNote} (rank ${rank + 1}) and match ${score} < ${cfg.maxMatchToReject} threshold.`;
      const updated = actOnPipelineEntry(e.id, "reject");
      recordAutomationEvent(e.id, "auto_rejected", rationale); // audit trail (shows in Analytics)
      if (updated) await dispatchRejection(updated, { automated: true }); // queued, never ghosts
      decisions.push({ entryId: e.id, label: e.candidateLabel, archetype: e.archetype, matchScore: score, action: "reject", rationale });
      rejected += 1;
    } else {
      const reason = keepReason(cfg, protectedFromAutoReject, knownArchetype, inBottom, tieSpared);
      decisions.push({ entryId: e.id, label: e.candidateLabel, archetype: e.archetype, matchScore: score, action: "keep", rationale: reason });
    }
  }
  return { decisions, rejected, kept: decisions.length - rejected, cohort: n, config: cfg };
}
