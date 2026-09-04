// The two honesty disclosures a saved group evaluation carries, folded into what
// the modal actually renders.
//
// `group-eval-run.ts` records both, and until this fold existed neither reached a
// reader:
//
//   • `consentExcluded` — members dropped from the compared field because they were
//     anonymized (an Art. 17 erasure) or their consent to be processed had lapsed.
//     A field that shrank for that reason must not read as a field that simply had
//     fewer applicants. COUNTS ONLY, by construction: the payload deliberately does
//     not carry the excluded people's ids, so this fold cannot leak them either.
//
//   • `degradedStages` — the AI stages that fell back to their deterministic twin.
//     Every one of the up-to-eight Python processes behind an evaluation degrades
//     soft, so an eval whose ranking, narrative and rationales had ALL fallen back
//     looked exactly like a full AI comparison.
//
// Pure and dependency-free (the `coverageNote` shape in groupEvalSession.ts): the
// rule lives here and is pinned by groupEvalDisclosure.test.ts rather than inline in
// a component body, and the component owes only the sentence.

/** The stages an evaluation can report as degraded — a CLOSED vocabulary, mirroring
 *  `DegradedStage` in app/_lib/group-eval-run.ts. Declared as a literal array so the
 *  union is derived from it and the runtime guard below cannot drift from the type
 *  (the repo's literal-array + derived-union + guard shape). */
export const DEGRADED_STAGES = ["ranking", "comparison", "reasoning"] as const;
export type DegradedStageName = (typeof DEGRADED_STAGES)[number];

/** Deliberately an index-signature read rather than a `GroupEvalPayload` import.
 *  Both fields are additive on a PERSISTED payload, so an older row omits them and a
 *  narrower all-optional type would be a "weak type" that TS refuses to accept a
 *  full payload for. Reading through `unknown` and narrowing below is also what the
 *  legacy tolerance below needs anyway. */
type DisclosureSource = { readonly [key: string]: unknown };

export type DisclosureNotes = {
  /** How many cohort members were withheld for consent/erasure, or null when none
   *  were — "0 excluded" is a sentence nobody needs. */
  consentExcluded: number | null;
  /** Which stages fell back, in the fixed DEGRADED_STAGES order (never the order the
   *  server happened to push them, which is a race), de-duplicated; and whether any
   *  of them TIMED OUT rather than failed — the two ask an operator for different
   *  things, so the sentence distinguishes them. Null when nothing degraded. */
  degraded: { stages: DegradedStageName[]; timedOut: boolean } | null;
};

const isDegradedStage = (value: unknown): value is DegradedStageName =>
  typeof value === "string" && (DEGRADED_STAGES as readonly string[]).includes(value);

/**
 * What this evaluation owes the reader beyond its result. Tolerant of every legacy
 * and malformed shape on purpose: these fields ride on a PERSISTED payload that may
 * have been written by an older build, and a disclosure that throws is worse than
 * the silence it was added to end.
 */
export function disclosureNotes(evaluation: DisclosureSource): DisclosureNotes {
  const excluded = evaluation.consentExcluded;
  const rawCount = excluded && typeof excluded === "object" ? (excluded as { count?: unknown }).count : undefined;
  const count = typeof rawCount === "number" && Number.isFinite(rawCount) ? Math.trunc(rawCount) : 0;

  const raw = evaluation.degradedStages;
  const entries: { stage?: unknown; reason?: unknown }[] = Array.isArray(raw)
    ? raw.filter((e): e is { stage?: unknown; reason?: unknown } => !!e && typeof e === "object")
    : [];
  const seen = new Set<DegradedStageName>();
  for (const entry of entries) {
    if (isDegradedStage(entry.stage)) seen.add(entry.stage);
  }
  const stages = DEGRADED_STAGES.filter((s) => seen.has(s));
  // A timeout is only claimed for a stage this fold actually recognised — an unknown
  // stage name cannot smuggle in the stricter word with nothing to attach it to.
  const timedOut = entries.some((e) => isDegradedStage(e.stage) && e.reason === "timeout");

  return {
    consentExcluded: count > 0 ? count : null,
    degraded: stages.length > 0 ? { stages, timedOut } : null,
  };
}
