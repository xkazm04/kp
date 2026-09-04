// Minimum-cohort floor for the comparative group evaluation, mirroring the SHAPE of
// adverse-impact.ts's ADVERSE_IMPACT_MIN_COHORT: a comparative verdict from too small a
// field is noise dressed as signal. bug-ui-scan-2026-07-09 #4: a SINGLE-candidate group
// crowned a "recommended lead over the field", reported EVERY skill as a "unique
// strength" (there are no rivals to be unique against), and trivially "passed" the
// weighting-robustness check (a length-1 order cannot reorder) — then auto-sealed all of
// that into the decision record. Below the floor there is no field to compare, so no lead
// is crowned/sealed and robustness is reported as "insufficient sample", not a pass.
//
// Pure + dependency-free (like adverse-impact.ts) so the gate is unit-testable without
// the DB that group-eval-run imports.

/**
 * The minimum number of compared candidates for a group evaluation to make any
 * COMPARATIVE claim — a recommended lead "over the field", a "unique" differentiator, or
 * a robust cross-scheme ranking. Two is the smallest field in which one candidate can be
 * ranked/differentiated AGAINST another; with one there is nothing to compare.
 *
 * NB this is a HEAD-TO-HEAD comparison floor, deliberately small — distinct from
 * adverse-impact.ts's ADVERSE_IMPACT_MIN_COHORT (n >= 30), which guards a statistical
 * SELECTION-RATE. A comparison's floor is simply "more than one thing to compare".
 */
export const GROUP_EVAL_MIN_COHORT = 2;

/**
 * The maximum number of candidates ONE comparative evaluation covers. The strongest
 * are selected by fit before the cap (top-N default), OR the recruiter picks an
 * explicit selection of up to this many (group-eval-cohort-choice). Single-sourced
 * here — a pure, client-safe module — so the server ranker (group-eval-run) and the
 * client selection UI (RoleDecisionRow) enforce the SAME bound without duplicating it.
 */
export const GROUP_EVAL_CAP = 6;

/**
 * True when the field is large enough to support a comparative verdict (a lead over the
 * field / differentiators / robustness). Below it the eval is "insufficient sample": the
 * lone candidate is still shown, but nothing comparative is asserted or sealed.
 */
export function hasComparableCohort(candidateCount: number): boolean {
  return candidateCount >= GROUP_EVAL_MIN_COHORT;
}

/**
 * Does the cross-scheme weighting matrix actually cover the field this evaluation
 * COMPARED?
 *
 * The matrix is built from the recruiter POOL, which is a strict subset of the compared
 * field whenever a candidate can't be resolved into a pool entry — an entry with no
 * `candidateId` (a manually added pipeline row), a `candidateId` whose profile AND
 * analysis are both gone, or an entry recruiter_cli skipped as malformed. Those
 * candidates are still compared, still ranked (on their stored matchScore) and can
 * still be crowned lead, but they were never re-scored under anyone's weights.
 *
 * `isFairnessAligned` only proves the matrix is internally consistent — a perfectly
 * aligned 2x2 matrix is "aligned" while the comparison ranked three people. Claiming
 * `assessed` from it then seals "the cross-scheme re-scoring genuinely tested the
 * order" about an order the check never saw (and, when the unranked candidate carries
 * the highest stored score, about a LEAD that is not in the matrix at all). So
 * robustness is only assessable when every compared candidate is in the matrix.
 *
 * Structurally typed (no `Fairness` import) so this module stays dependency-free.
 */
export function fairnessCoversCohort(
  comparedCandidateIds: readonly (string | null | undefined)[],
  fairness: { candidateIds?: unknown } | null | undefined
): boolean {
  const covered = fairness?.candidateIds;
  if (!Array.isArray(covered) || covered.length === 0) return false;
  const set = new Set(covered.filter((id): id is string => typeof id === "string" && id.length > 0));
  if (comparedCandidateIds.length === 0) return false;
  return comparedCandidateIds.every((id) => !!id && set.has(id));
}

// ---- Consent / anonymization exclusion --------------------------------------
//
// A group evaluation is the most PII-dense thing the app does with a cohort: every
// member's label, archetype, salary expectation, matched/missing skills and
// CV-derived verdict are serialized into a prompt, sent to a provider, narrated,
// and then PERSISTED into a shared row the whole team reads (and, under
// `recommendation` governance, sealed into a decision record).
//
// Cohort selection consulted none of that. The app already knows two things that
// forbid it — a candidate anonymized under a GDPR erasure, and a candidate whose
// consent to be processed has lapsed — and already enforces both for OUTREACH via
// `suppressedCandidateIds` (rediscovery-alert-store.ts: workspace-global, because
// erasure is a property of the person not the team; most-restrictive across every
// entry the identity owns; fail-CLOSED so a broken consent read suppresses
// everybody rather than nobody). This applies the SAME verdict to the compared
// field, so an erased person is not re-materialized into a model prompt and a
// sealed comparison.
//
// Pure, like the rest of this module: the caller resolves the suppression map (a DB
// read) and hands it in, so the exclusion rule itself stays unit-testable without a
// database and the two consumers of the predicate can never disagree about it.

/** One member removed from a comparison, and why. `reason` is the suppression
 *  vocabulary of `suppressedCandidateIds` verbatim — an erasure and a lapsed
 *  consent are DIFFERENT facts and are disclosed as such, never flattened into a
 *  single "excluded". */
export type ConsentExclusion = {
  entryId: string;
  candidateId: string;
  reason: "anonymized" | "consent_expired";
};

/** Structural shape of a cohort member — the fields this filter reads. Kept
 *  structural (no `GroupEvalCandidate` import) so this module stays
 *  dependency-free and client-safe. */
type CohortMember = { entryId: string; candidateId: string | null };

/**
 * Split a role cohort into the members that may be compared and the members that
 * may not, given the suppression map for their durable identities.
 *
 * A member with NO `candidateId` is kept: suppression is keyed to a person, and a
 * manually added pipeline row names none — dropping it would shrink the field on a
 * technicality rather than on a consent fact. Every entry sharing a suppressed
 * `candidateId` is excluded (one person can hold two entries in a role after a
 * re-add; excluding only the first would carry the erased label straight back in).
 * Order is preserved and the input array is never mutated.
 */
export function partitionCohortByConsent<T extends CohortMember>(
  cohort: readonly T[],
  suppressed: ReadonlyMap<string, ConsentExclusion["reason"]>
): { compared: T[]; excluded: ConsentExclusion[] } {
  const compared: T[] = [];
  const excluded: ConsentExclusion[] = [];
  for (const member of cohort) {
    const candidateId = (member.candidateId ?? "").trim();
    const reason = candidateId ? suppressed.get(candidateId) : undefined;
    if (reason) excluded.push({ entryId: member.entryId, candidateId, reason });
    else compared.push(member);
  }
  return { compared, excluded };
}
