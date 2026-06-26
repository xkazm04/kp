// Pure dedupe-key builders for the background-task runner (tasks.ts), split into
// their own dependency-free module so the identity logic is unit-testable and so
// a missing/empty identifying param can never collapse a key to a constant.
//
// THE BUG (idea-5e38b9ad): startTask reuses any in-flight task whose dedupe key
// matches. Each key used to be built by raw interpolation — `analyze:${p.baseDir}`,
// `group_eval:${p.roleKey}`, `reasoning:${profileId ?? analysisSlug ?? candidate}:${jobId}`.
// When the identifying field was missing/undefined the key collapsed to a
// constant like `analyze:undefined` or `reasoning::undefined`, so caller B's
// incomplete request matched caller A's in-flight run and was handed A's Task —
// and ultimately A's result. That is silent cross-request data contamination in
// a hiring tool.
//
// THE FIX: a builder returns `null` when any REQUIRED identity part is absent or
// blank. startTask treats a null key as "no stable identity" and assigns a
// guaranteed-unique key instead of merging. Non-identifying discriminators
// (a "has notes" flag, an optional caseId, a JD length) are appended only after
// the required parts have produced a real key.

/**
 * Join a dedupe key from a prefix and its REQUIRED identifying parts. Returns
 * `null` if any part is null/undefined or blank after trimming — the signal that
 * the params can't form a stable identity, so the caller must fall back to a
 * unique key rather than a collision-prone constant.
 */
export function stableKey(prefix: string, ...required: unknown[]): string | null {
  const parts: string[] = [];
  for (const value of required) {
    if (value == null) return null;
    const s = typeof value === "string" ? value.trim() : String(value);
    if (s === "") return null;
    parts.push(s);
  }
  return [prefix, ...parts].join(":");
}

// JSON-encode an identity object, or undefined when it is absent — so `stableKey`
// rejects it (rather than encoding `undefined`/`{}` into a colliding constant).
function identityJson(value: unknown): string | undefined {
  return value == null ? undefined : JSON.stringify(value);
}

// One builder per task kind. Each returns a stable key, or null when its
// identifying params are missing/empty. Keys for valid inputs are byte-identical
// to the historical format so an in-flight run started just before this change
// still dedupes. Keys MUST stay in sync with the HANDLERS kinds in tasks.ts; an
// unlisted kind falls back to a unique key (safe: it just won't dedupe).
export const DEDUPE_BUILDERS: Record<string, (p: Record<string, unknown>) => string | null> = {
  automation: (p) => {
    const k = stableKey("automation", p.entryId, p.task);
    return k && `${k}:${p.notes ? "n" : ""}`;
  },
  reasoning: (p) => stableKey("reasoning", p.profileId ?? p.analysisSlug ?? identityJson(p.candidate), p.jobId),
  batch_screen: () => "batch_screen", // singleton: one batch-screen at a time, by design
  analyze: (p) => stableKey("analyze", p.baseDir), // baseDir is unique per upload
  need_analysis: (p) => stableKey("need_analysis", identityJson(p.need)),
  design_artifacts: (p) => {
    const k = stableKey("design_artifacts", identityJson(p.need));
    return k && `${k}:${JSON.stringify(p.analysis ?? {})}`;
  },
  evaluate_submission: (p) => stableKey("evaluate_submission", p.submissionId),
  lifecycle: (p) => stableKey("lifecycle", p.lifecycleId), // one run per case; a re-trigger resumes when idle
  group_eval: (p) => stableKey("group_eval", p.roleKey), // one run per role; re-trigger reuses an in-flight run
  jd_build: (p) => {
    const k = stableKey("jd_build", p.title);
    return k && `${k}:${p.needText ? String(p.needText).length : 0}:${p.repoUrl ?? ""}`;
  },
  interview_prep: (p) => stableKey("interview_prep", p.entryId), // one plan per entry; re-trigger reuses an in-flight run
};

/**
 * Build the stable dedupe key for a task, or `null` when the identifying params
 * are missing/empty (or the kind has no builder). A null result tells startTask
 * to assign a guaranteed-unique key so the run can never be merged with an
 * unrelated in-flight task.
 */
export function buildDedupeKey(kind: string, params: Record<string, unknown>): string | null {
  const builder = DEDUPE_BUILDERS[kind];
  return builder ? builder(params) : null;
}
