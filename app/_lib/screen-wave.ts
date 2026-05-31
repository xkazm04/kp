import { actOnPipelineEntry, listPipeline, recordAutomationEvent } from "./db";
import { getDecisionConfig, type ScreeningRule } from "./decision-config-store";
import { dispatchRejection } from "./comms-dispatch";

// Phase 3 — the screening "first wave" of automated decisions. For a role's
// matched cohort, auto-reject the bottom `rejectBottomPercent` that are ALSO
// below `maxMatchToReject` match — NEVER early-career (the fairness gate from
// automation.py is preserved). Every auto-decision is audited with a rationale
// and the candidate gets a queued rejection comm.

const EARLY = new Set(["student", "career_switcher"]);

export type ScreenDecision = {
  entryId: string;
  label: string;
  archetype: string | null;
  matchScore: number;
  action: "reject" | "keep";
  rationale: string;
};

export async function runScreenWave(
  jobId: string,
  override?: Partial<ScreeningRule>
): Promise<{ decisions: ScreenDecision[]; rejected: number; kept: number; cohort: number; config: ScreeningRule }> {
  const cfg: ScreeningRule = { ...getDecisionConfig<ScreeningRule>("screening"), ...(override ?? {}) };
  const cohort = listPipeline().filter((e) => e.jobId === jobId && e.status === "active" && e.stage === "AI-matched");
  const sorted = [...cohort].sort((a, b) => (a.matchScore ?? 0) - (b.matchScore ?? 0)); // worst first
  const n = sorted.length;
  const bottomCount = Math.floor((n * cfg.rejectBottomPercent) / 100);

  const decisions: ScreenDecision[] = [];
  let rejected = 0;
  for (let rank = 0; rank < sorted.length; rank++) {
    const e = sorted[rank];
    const score = e.matchScore ?? 0;
    const early = EARLY.has((e.archetype ?? "").trim());
    const inBottom = rank < bottomCount;
    const belowThreshold = score < cfg.maxMatchToReject;

    if (cfg.autoRejectEnabled && inBottom && belowThreshold && !early) {
      const rationale = `Auto-rejected · bottom ${cfg.rejectBottomPercent}% of ${n} (rank ${rank + 1}) and match ${score} < ${cfg.maxMatchToReject} threshold.`;
      const updated = actOnPipelineEntry(e.id, "reject");
      recordAutomationEvent(e.id, "auto_rejected", rationale); // audit trail (shows in Analytics)
      if (updated) await dispatchRejection(updated, { automated: true }); // queued, never ghosts
      decisions.push({ entryId: e.id, label: e.candidateLabel, archetype: e.archetype, matchScore: score, action: "reject", rationale });
      rejected += 1;
    } else {
      const reason = !cfg.autoRejectEnabled
        ? "auto-reject off"
        : early
          ? "early-career — never auto-rejected"
          : !inBottom
            ? "above the bottom cutoff"
            : "match at/above threshold";
      decisions.push({ entryId: e.id, label: e.candidateLabel, archetype: e.archetype, matchScore: score, action: "keep", rationale: reason });
    }
  }
  return { decisions, rejected, kept: decisions.length - rejected, cohort: n, config: cfg };
}
