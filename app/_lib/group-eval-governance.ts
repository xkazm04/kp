// Governance mode for the comparative group evaluation (P1-3). The default
// "recommendation" mode lets the AI synthesize + auto-seal a single recommended
// lead. But faculty search committees (Susan #15) and civil-service hiring (Tasha
// #16) are COLLECTIVE / STATUTORY processes — a single auto-sealed AI pick
// overrides shared governance or substitutes a discretionary score for a ranked
// eligibility list. These modes make the AI ADVISORY (it never seals a winner) and,
// for eligibility-list, present an ordinal list instead of a crowned lead.
//
// Pure + dependency-free so it unit-tests without the DB that group-eval-run imports.

export type GovernanceMode = "recommendation" | "committee" | "eligibility_list";

const MODES: readonly GovernanceMode[] = ["recommendation", "committee", "eligibility_list"];

export function normalizeGovernanceMode(value: unknown): GovernanceMode {
  const s = typeof value === "string" ? value.trim() : "";
  return (MODES as readonly string[]).includes(s) ? (s as GovernanceMode) : "recommendation";
}

/** Only the default mode lets the AI auto-seal a single pick AS the decision.
 *  Committee + eligibility-list are human/committee-decided; the AI stays advisory
 *  and must never seal a winner (no solely-automated significant decision). */
export function sealsLead(mode: GovernanceMode): boolean {
  return mode === "recommendation";
}

/** Ordinal, fit-ranked eligibility list (rank 1..N). KO-failed candidates are not
 *  eligible and are excluded. The input is expected already ko-aware-sorted by the
 *  caller, so ranks follow its order. For civil-service-style certification. */
export function buildEligibilityList<T extends { entryId: string; label: string; score: number | null; koPassed?: boolean }>(
  candidates: T[]
): { rank: number; entryId: string; label: string; score: number | null }[] {
  return candidates
    .filter((c) => c.koPassed !== false)
    .map((c, i) => ({ rank: i + 1, entryId: c.entryId, label: c.label, score: c.score }));
}

/** Honest, mode-specific guidance shown to the recruiter — including the named
 *  ceiling: the app holds no demographic/veteran data, so statutory preferences
 *  can't be computed and must be applied by a human before certification. */
export function governanceNote(mode: GovernanceMode): string | null {
  if (mode === "committee") {
    return (
      "Committee mode: the AI comparison is ADVISORY input for the search committee — it does not pick or " +
      "seal a hire. Capture each evaluator's assessment and the committee's decision in your governance process."
    );
  }
  if (mode === "eligibility_list") {
    return (
      "Eligibility-list mode: candidates are an ordinal, fit-ranked list — not a discretionary AI pick, and " +
      "nothing is auto-sealed. Apply any statutory preferences (e.g. veterans') before certifying; the app holds " +
      "no such status and cannot compute it."
    );
  }
  return null;
}
