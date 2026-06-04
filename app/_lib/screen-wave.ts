import { actOnPipelineEntry, listPipeline, recordAutomationEvent } from "./db";
import { getDecisionConfig, type ScreeningRule } from "./decision-config-store";
import { screenBottomCount } from "./decision-config-schema";
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
// / above the bottom cutoff / at-or-above the match threshold.
export function keepReason(
  cfg: ScreeningRule,
  protectedFromAutoReject: boolean,
  knownArchetype: boolean,
  inBottom: boolean
): string {
  if (!cfg.autoRejectEnabled) return "auto-reject off";
  if (protectedFromAutoReject) {
    return knownArchetype ? "early-career — never auto-rejected" : "unknown archetype — shielded (fail-closed)";
  }
  if (!inBottom) return "above the bottom cutoff";
  return "match at/above threshold";
}

export async function runScreenWave(
  jobId: string,
  override?: Partial<ScreeningRule>
): Promise<{ decisions: ScreenDecision[]; rejected: number; kept: number; cohort: number; config: ScreeningRule }> {
  const cfg: ScreeningRule = { ...getDecisionConfig<ScreeningRule>("screening"), ...(override ?? {}) };
  const cohort = listPipeline().filter((e) => e.jobId === jobId && e.status === "active" && e.stage === "Screened");
  const sorted = [...cohort].sort((a, b) => (a.matchScore ?? 0) - (b.matchScore ?? 0)); // worst first
  const n = sorted.length;
  // Small-cohort policy lives in decision-config-schema.ts: floor, but never
  // below one candidate in a non-empty pool — so a small role is no longer
  // silently exempt from an auto-reject the recruiter switched on (idea-582ff3b2).
  const bottomCount = screenBottomCount(n, cfg.rejectBottomPercent);

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
    const inBottom = rank < bottomCount;
    const belowThreshold = score < cfg.maxMatchToReject;

    if (cfg.autoRejectEnabled && inBottom && belowThreshold && !protectedFromAutoReject) {
      const rationale = `Auto-rejected · bottom ${cfg.rejectBottomPercent}% of ${n} → ${bottomCount} (rank ${rank + 1}) and match ${score} < ${cfg.maxMatchToReject} threshold.`;
      const updated = actOnPipelineEntry(e.id, "reject");
      recordAutomationEvent(e.id, "auto_rejected", rationale); // audit trail (shows in Analytics)
      if (updated) await dispatchRejection(updated, { automated: true }); // queued, never ghosts
      decisions.push({ entryId: e.id, label: e.candidateLabel, archetype: e.archetype, matchScore: score, action: "reject", rationale });
      rejected += 1;
    } else {
      const reason = keepReason(cfg, protectedFromAutoReject, knownArchetype, inBottom);
      decisions.push({ entryId: e.id, label: e.candidateLabel, archetype: e.archetype, matchScore: score, action: "keep", rationale: reason });
    }
  }
  return { decisions, rejected, kept: decisions.length - rejected, cohort: n, config: cfg };
}
