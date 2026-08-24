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

// The one non-trivial builder that folds MULTIPLE identity dimensions (role +
// governance mode + candidate-set fingerprint) lives in its own pure module so its
// logic is unit-testable in isolation (bug-ui-scan-2026-07-09 #3).
import { groupEvalDedupeKey } from "./group-eval-dedupe.ts";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/locales";

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

/**
 * The reader's locale as a dedupe DISCRIMINATOR, for the kinds whose OUTPUT is
 * localized.
 *
 * A background task carries the requesting locale in its params (a detached task
 * can't read the cookie), and for `reasoning` / `interview_prep` that locale picks
 * the language of the whole artifact — the LLM prompt directive, the deterministic
 * scaffolding, and the persisted `lang`/`narrativeLang` stamp. Leaving it out of
 * the key made "same entity" mean "same language", so a second reader (or the same
 * operator after flipping the app language) was handed the in-flight run's pack in
 * SOMEONE ELSE'S language — the identical omitted-input class the module header
 * describes, and the reason `campaign` already folds it.
 *
 * Normalized exactly as the handlers narrow it (isLocale → DEFAULT_LOCALE, see
 * runInterviewPrep / runReasoning), so an absent or unsupported `lang` keys onto the
 * run it will actually produce instead of forking a second identical one.
 */
function localePart(value: unknown): string {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

// One builder per task kind. Each returns a stable key, or null when its
// identifying params are missing/empty. A key's shape only has to survive the
// tasks that are IN FLIGHT when it changes (it is compared against active rows
// only), and the worst case of a shape change is one un-merged duplicate run —
// never a wrong merge. Keys MUST stay in sync with the HANDLERS kinds in tasks.ts;
// an unlisted kind falls back to a unique key (safe: it just won't dedupe).
//
// The rule for what belongs in a key: EVERY param the handler reads that changes
// the RESULT. A localized artifact therefore folds the requesting locale
// (localePart) — see `reasoning`, `interview_prep`, `campaign`.
export const DEDUPE_BUILDERS: Record<string, (p: Record<string, unknown>) => string | null> = {
  automation: (p) => {
    const k = stableKey("automation", p.entryId, p.task);
    return k && `${k}:${p.notes ? "n" : ""}`;
  },
  // Candidate identity + job + the READER'S LOCALE: runReasoning keys its own
  // narrative cache by the requested locale precisely so a de/fr request never
  // shares the en verdict, and the task key has to fold the same axis or the
  // dedupe hands over the wrong-language slot before the cache is ever consulted.
  reasoning: (p) => {
    const k = stableKey("reasoning", p.profileId ?? p.analysisSlug ?? identityJson(p.candidate), p.jobId);
    return k && `${k}:${localePart(p.lang)}`;
  },
  batch_screen: () => "batch_screen", // singleton: one batch-screen at a time, by design
  // Keyed by the SORTED cohort fingerprint: a double-click (or retried fetch) on the
  // same selection dedupes onto the in-flight run, while a different cohort starts its
  // own. Empty/absent selection → null (no identity), so it never merges spuriously.
  batch_outreach: (p) => {
    const ids = Array.isArray(p.entryIds)
      ? (p.entryIds as unknown[]).filter((x): x is string => typeof x === "string").sort()
      : [];
    return ids.length ? stableKey("batch_outreach", ids.join(",")) : null;
  },
  analyze: (p) => stableKey("analyze", p.baseDir), // baseDir is unique per upload
  need_analysis: (p) => stableKey("need_analysis", identityJson(p.need)),
  design_artifacts: (p) => {
    const k = stableKey("design_artifacts", identityJson(p.need));
    return k && `${k}:${JSON.stringify(p.analysis ?? {})}`;
  },
  evaluate_submission: (p) => stableKey("evaluate_submission", p.submissionId),
  lifecycle: (p) => stableKey("lifecycle", p.lifecycleId), // one run per case; a re-trigger resumes when idle
  // bug-ui-scan-2026-07-09 #3: keyed by role + governance mode + candidate-set
  // fingerprint (NOT the role alone) so a concurrent re-trigger with a different mode
  // or pool starts its OWN run instead of being handed the in-flight run's stale,
  // auto-sealed result. A true retry (same role, mode AND set) still dedupes. See
  // group-eval-dedupe.ts for the pure key logic.
  group_eval: groupEvalDedupeKey,
  jd_build: (p) => {
    // Backgrounded flow: a placeholder JD owns the build, so the slug IS the
    // identity — each Generate mints a distinct JD (hence a distinct build), while
    // a retry reuses the slug and correctly dedupes onto an in-flight run. Legacy
    // callers with no slug keep the input-shaped key (byte-identical) below.
    if (p.jdSlug) return stableKey("jd_build", p.jdSlug);
    const k = stableKey("jd_build", p.title);
    return k && `${k}:${p.needText ? String(p.needText).length : 0}:${p.repoUrl ?? ""}`;
  },
  // One plan per (entry, language): a re-trigger reuses the in-flight run, while a
  // reader in another locale starts their own — the prep pack's questions AND its
  // run-of-show scaffolding are generated in `lang` and the pack is stamped with it.
  interview_prep: (p) => {
    const k = stableKey("interview_prep", p.entryId);
    return k && `${k}:${localePart(p.lang)}`;
  },
  agent_fit: (p) => stableKey("agent_fit", p.jobId), // one transform per job; a re-trigger reuses the in-flight run
  // One run per SCAN ROW, not per repository: each POST /api/repo-scan mints its own
  // row (a re-scan is a new reading of a repo that has since changed, and must not be
  // handed the previous run's dossier), while a retried/duplicated submission of the
  // SAME scanId coalesces onto the run already in flight.
  repo_scan: (p) => stableKey("repo_scan", p.scanId),
  // One pack per (job, language): a double-click on Generate reuses the in-flight
  // run, while switching the language toggle starts its own.
  campaign: (p) => stableKey("campaign", p.jobId, p.lang),
  // profile_draft has NO builder on purpose: each draft is a fresh creative pass
  // over free-text notes — no stable identity, so every run gets a unique key.
  //
  // ONE digest per tenant per DAY. The day is the identity: accepting the same
  // "write today's digest" proposal twice, or two operators on one team accepting
  // it within a minute of each other, must coalesce onto the run already in
  // flight rather than paying for a second model call that says the same thing.
  // The workspace is in the key explicitly — a builder only ever sees `params`,
  // so without it the day alone would be the identity and two tenants would share
  // one digest, the exact collapse this module's header describes.
  companion_digest: (p) => stableKey("companion_digest", p.workspaceId, p.dayIso),
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
