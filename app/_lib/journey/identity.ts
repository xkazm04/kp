// WHICH ROWS BELONG TO WHICH CANDIDATE — the join rules the projection needs, and
// nothing else. Deliberately PURE: no db, no i18n, no Next. project.ts does the
// reading; this module only decides what a read is allowed to CLAIM.
//
// WHY IT EXISTS AS ITS OWN FILE. `candidate-timeline.ts` already enforces the
// strongest identity contract this codebase has for `analyses`, but it enforces it
// INLINE (candidate-timeline.ts:219-241) and exports no helper — the rule lives
// inside a loop over one entry's items. The journey board runs the same rule over
// a whole workspace at once, so the rule is lifted here VERBATIM rather than
// re-derived, and `analysis-identity-parity.test.ts`-style source pinning in
// project.test.ts keeps the two from drifting.
//
// The rule, restated from candidate-timeline.ts:33-41:
//
//   analyses carry NO entry/candidate foreign key — only a free-text
//   `candidate_label` and a `jd_slug`. So the strongest available identity is the
//   strict (label + jd_slug↔jobId) join the canonical match score uses. A
//   same-named stranger analyzed for a DIFFERENT role does not inherit this
//   candidate's history. When the entry's job is NOT JD-backed (a corpus job — no
//   jd_slug to match on) there is no job axis to confirm identity, so a label
//   match is REDUCED CONFIDENCE and is flagged rather than presented as certain.

/** What an `analyses` row is allowed to claim about a pipeline entry. */
export type AnalysisAttachment =
  /** Not this person, or not this role — the row must not appear on the column. */
  | "none"
  /** Label AND job axis agree: the strongest link this data model can express. */
  | "confirmed"
  /** Label alone agreed because the entry's job carries no JD slug to confirm
   *  against. It MAY be a different person; `JourneyEvent.confidence` carries the
   *  caveat onto the wire so the board can never render it as certain. */
  | "label-only";

/** The comparison form of a candidate label: trimmed, lower-cased, or null when
 *  there is nothing to compare. A blank label is NOT an identity — two nameless
 *  rows are not the same person — so it never matches anything. */
export function journeyNormalizeLabel(label: string | null | undefined): string | null {
  const normalized = label?.trim().toLowerCase();
  return normalized ? normalized : null;
}

/**
 * Decide what one `analyses` row may claim about one pipeline entry.
 *
 * `entryJdSlug` is `jdSlugOfJobId(entry.jobId)` — null for a corpus job, which is
 * precisely the state that removes the job axis and downgrades the claim.
 */
export function journeyAnalysisAttachment(input: {
  entryLabel: string | null | undefined;
  entryJdSlug: string | null;
  analysisLabel: string | null | undefined;
  analysisJdSlug: string | null | undefined;
}): AnalysisAttachment {
  const entryLabel = journeyNormalizeLabel(input.entryLabel);
  const analysisLabel = journeyNormalizeLabel(input.analysisLabel);
  if (!entryLabel || entryLabel !== analysisLabel) return "none";
  const jobMatched = input.entryJdSlug !== null && input.analysisJdSlug === input.entryJdSlug;
  // A JD-backed entry REQUIRES the job axis to agree; otherwise this analysis is
  // for a different role (a same-named stranger, or this person on another job).
  if (input.entryJdSlug !== null && !jobMatched) return "none";
  return jobMatched ? "confirmed" : "label-only";
}

/**
 * Is a journey row's `actor` a machine?
 *
 * The decision-chain actor vocabulary is `"auto:<engine>"` / `"human:<who>"` /
 * null (db/core.ts:601's `actor` column, decision-record-store.ts:24-29). `null`
 * is NOT a machine — it is "kp genuinely does not know", which the board renders
 * as its own mark. Reading a null as automation is exactly the fabrication
 * guardrail G3 forbids.
 */
export function journeyActorIsMachine(actor: string | null | undefined): boolean {
  return typeof actor === "string" && actor.startsWith("auto:");
}

/**
 * The rail-step identity of one row: which STEP of the process it is an instance of.
 *
 * `kind` alone for ordinary rows, `kind::topicCode` for a conversational round that
 * the classifier placed — because "Candidate asked about salary" and "Candidate
 * described their stack experience" are two different steps of the same process,
 * and collapsing them onto one rail row would make the cohort column meaningless.
 * A round with no topic falls back to its kind, which is a legitimate step.
 */
export function journeyStepKey(row: { kind: string; topicCode?: string }): string {
  return row.topicCode ? `${row.kind}::${row.topicCode}` : row.kind;
}
