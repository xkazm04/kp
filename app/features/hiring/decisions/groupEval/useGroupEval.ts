import { useState } from "react";
import { buildSkillRows, ranWhen } from "./groupEvalHelpers";
import type { GroupEvalPayload } from "@/app/features/shared/groupEvalTypes";

// Session state + derived data for the group-eval modal, kept out of the entry
// component so it stays pure composition. Owns the per-session decided map and
// derives everything the regions consume from the (cached) evaluation payload.
export function useGroupEval({
  evaluation,
  createdAt,
  poolDrift,
  onDecide,
}: {
  evaluation: GroupEvalPayload | null;
  createdAt?: string | null;
  poolDrift?: number;
  // Returns whether the decision actually landed on a live pipeline entry — a
  // candidate who already left the pool can't be resolved, and the button must NOT
  // then show a fake success pill.
  onDecide?: (identity: string, action: "accept" | "reject") => boolean;
}) {
  const ranAt = ranWhen(createdAt);
  // Candidates decided here this session, so their buttons flip to a result pill
  // (the cached `evaluation` snapshot doesn't refetch; the live queue updates
  // underneath via act()).
  const [decided, setDecided] = useState<Record<string, "accept" | "reject">>({});
  const decide =
    onDecide &&
    ((label: string, action: "accept" | "reject") => {
      if (decided[label]) return; // already acted this session
      // Only flip to the recorded-outcome pill if the action actually applied. If the
      // candidate has left the live pool, onDecide no-ops and returns false — leave
      // the buttons live (and un-decided) instead of claiming a success that never
      // happened, which also kept blocking a retry.
      if (onDecide(label, action)) {
        setDecided((d) => ({ ...d, [label]: action }));
      }
    });
  const drift = poolDrift ?? 0;
  const candidates = evaluation?.candidates ?? [];
  // Enriched layout (the comparison table) only when the recruiter breakdown is
  // present; otherwise fall back to the compact text view so legacy/simulation
  // payloads and job-less roles still render correctly.
  const enriched = candidates.some((c) => (c.scoreBreakdown?.length ?? 0) > 0);
  const { rows: skillRows, mustRows } = buildSkillRows(candidates, evaluation?.requirements ?? []);
  const aiBacked = Boolean(evaluation?.comparison) && evaluation?.comparisonSource === "llm";

  return { ranAt, decided, decide, drift, candidates, enriched, skillRows, mustRows, aiBacked };
}
