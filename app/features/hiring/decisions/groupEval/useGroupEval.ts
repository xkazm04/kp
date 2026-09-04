import { useState } from "react";
import { useLocale } from "next-intl";
import { buildSkillRows, ranWhen } from "@/app/features/hiring/decisions/groupEval/groupEvalHelpers";
import { decideWith, isEnriched, mergeSealed } from "@/app/features/hiring/decisions/groupEval/groupEvalSession";
import type { GroupEvalPayload } from "@/app/features/shared/groupEvalTypes";

// Session state + derived data for the group-eval modal, kept out of the entry
// component so it stays pure composition. Owns the per-session decided map and
// derives everything the regions consume from the (cached) evaluation payload.
export function useGroupEval({
  evaluation,
  createdAt,
  poolDrift,
  onDecide,
  sealed,
}: {
  evaluation: GroupEvalPayload | null;
  createdAt?: string | null;
  poolDrift?: number;
  // Returns whether the decision actually landed on a live pipeline entry — a
  // candidate who already left the pool can't be resolved, and the button must NOT
  // then show a fake success pill.
  onDecide?: (identity: string, action: "accept" | "reject") => boolean;
  /** Identities whose decision was sealed OUTSIDE this hook's click handler —
   *  today, a reject confirmed in the rationale dialog (UAT LUC-GEF-L1-08). Such a
   *  decision genuinely landed, but it landed after `onDecide` had already returned
   *  false ("nothing decided yet"), so the session map alone would keep showing live
   *  buttons for a candidate who has been rejected. Merged below rather than written
   *  into the map so the honesty contract is unchanged: this still only ever reflects
   *  decisions that really happened. */
  sealed?: Record<string, "accept" | "reject">;
}) {
  // The stamp follows the APP locale (the language the rest of this modal is in),
  // not whatever locale the browser happens to run under.
  const ranAt = ranWhen(createdAt, useLocale());
  // Candidates decided here this session, so their buttons flip to a result pill
  // (the cached `evaluation` snapshot doesn't refetch; the live queue updates
  // underneath via act()).
  const [decided, setDecided] = useState<Record<string, "accept" | "reject">>({});
  // Externally-sealed decisions win: they are already written to the pipeline and
  // to the audit record, so a live button over one would invite a second act().
  // That merge, the "did it actually land" contract below and the enriched threshold
  // are pure rules living in groupEvalSession.ts, where tests can reach them.
  const effectiveDecided = mergeSealed(decided, sealed);
  const decide =
    onDecide &&
    ((label: string, action: "accept" | "reject") => {
      // Only flip to the recorded-outcome pill if the action actually applied. If the
      // candidate has left the live pool, onDecide no-ops and returns false — leave
      // the buttons live (and un-decided) instead of claiming a success that never
      // happened, which also kept blocking a retry.
      const recorded = decideWith(effectiveDecided, onDecide)(label, action);
      if (recorded) setDecided((d) => ({ ...d, [label]: recorded }));
    });
  const drift = poolDrift ?? 0;
  const candidates = evaluation?.candidates ?? [];
  // Enriched layout (the comparison table) only when the recruiter breakdown is
  // present; otherwise fall back to the compact text view so legacy/simulation
  // payloads and job-less roles still render correctly.
  const enriched = isEnriched(candidates);
  const { rows: skillRows, mustRows } = buildSkillRows(candidates, evaluation?.requirements ?? []);
  const aiBacked = Boolean(evaluation?.comparison) && evaluation?.comparisonSource === "llm";

  return { ranAt, decided: effectiveDecided, decide, drift, candidates, enriched, skillRows, mustRows, aiBacked };
}
