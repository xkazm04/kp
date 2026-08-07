import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { analysisSchema, type Analysis } from "@/app/_lib/schemas";
import { getJob } from "@/app/_lib/db/jobs";
import { jdJobId } from "@/app/_lib/jd-limits";
import { computeCacheKey, lookupCachedAnalysis, storeCachedAnalysis } from "@/app/_lib/cache";
import { buildComparison } from "@/app/_lib/comparison";
import { reconcileScoreTotal } from "@/app/_lib/format";
import { countSanityWarns } from "@/app/_lib/sanity-checks";
import { saveAnalysis } from "@/app/_lib/db/analyses";
import { recordMeterUsage } from "@/app/_lib/billing";
import { logAnalyze, type AnalyzeLog } from "@/app/_lib/logger";
import { cleanupWorkdir, parsePythonJson, parseStderrError, spawnPython } from "@/app/_lib/python-runner";
import { ANALYZE_PHASE } from "@/app/_lib/analyze-phases";

// Shared core for CV analysis, lifted out of /api/analyze so it can run inside
// the background-task runner (detached from the request → survives navigation
// + refresh). Files are pre-persisted to `baseDir`, which is cleaned up here.
export type AnalyzeParams = {
  baseDir: string;
  grounding: boolean;
  // cvHash: content-addressed candidate identity (SHA-256 of the CV bytes),
  // computed once at intake and stamped on the saved analysis. Optional so
  // non-route callers (tests) can omit it.
  variants: { label: string; cvPath: string; cvHash?: string }[];
  jobDescriptionPath?: string | null;
  jobDescriptionText?: string | null;
  companyPath?: string | null;
  companyText?: string | null;
  jdSlug?: string | null;
  requestId: string;
  // Output locale for the LLM-generated narrative ("en" | "cs"). Captured at
  // request time (the background task runs outside request scope, so it can't
  // read the cookie itself) and forwarded to the Python CLI via --lang. Part of
  // the cache key so localized results don't collide. Defaults to "en".
  lang?: string;
  // Blind screening (idea-b8d711c4): redact identity from the CV before scoring.
  // Forwarded to the CLI as --blind; part of the cache key so a blind and a
  // non-blind run of the same CV don't collide.
  blind?: boolean;
  // Tenant (P2): the workspace this analysis belongs to. Captured at request time
  // (the task runs outside request scope, so it can't read the cookie) and stamped
  // on the saved analysis. Absent ⇒ saveAnalysis defaults to the single workspace.
  workspace?: string;
};

export class AnalyzeError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type ProgressFn = (done: number, total: number, msg?: string) => void;

// One variant's outcome. A failure is CAPTURED (never thrown) so a single bad CV
// variant can't reject the whole batch (Direction 2 — "one bad CV never kills the
// batch"): with settled semantics, N−1 good variants still produce a result.
export type VariantOk = { label: string; ok: true; analysis: Analysis; cached: boolean };
// `error` is engine/server text (Python stderr etc.) kept for logs + verbatim
// display. `code` is set ONLY when the reason is our own generic fallback (no
// engine text) — it tells the client to localize instead of showing an English
// literal. Engine failures carry `error` and NO code.
export type VariantFail = { label: string; ok: false; error: string; code?: string; status: number };
export type VariantResult = VariantOk | VariantFail;

// The single stable code for "this variant failed and we had no engine text to
// explain it" — the client maps it to a localized generic line (analyze.partialFailureGeneric).
export const ANALYZE_GENERIC_FAIL_CODE = "analyzeVariantFailed";

// The named failures that rode alongside a delivered (partial) result — surfaced
// on the return payload so the UI can say WHICH variant failed and why, not just
// the logs. Declared on the analyze schema (nullish) so it survives the client parse.
export type VariantFailureNote = { label: string; error: string; code?: string };

// The settled delivery decision over a batch of variant outcomes (Direction 2).
// Pure + exported so the winner-picking + failure-naming is unit-tested without
// spawning Python: N−1 successes still DELIVER (the failed variant is named in
// partialFailures); only a TOTAL wipeout THROWS with the first failure's error.
export type SettleDecision =
  // `error` is the client-facing string (engine text, or EMPTY when the failure was
  // our own coded generic — an empty task.error makes the client show its localized
  // "did not complete" line instead of an English literal). `logError` keeps a
  // non-empty detail for the server log regardless.
  | { kind: "throw"; error: string; logError: string; status: number }
  | { kind: "deliver"; successes: VariantOk[]; partialFailures: VariantFailureNote[]; allCached: boolean };

export function settleVariants(results: VariantResult[]): SettleDecision {
  const successes = results.filter((r): r is VariantOk => r.ok);
  const failures = results.filter((r): r is VariantFail => !r.ok);
  // Total wipeout is the only throw. A single-CV run lands here on its one
  // variant's failure (behavior unchanged); a multi-CV run throws only when EVERY
  // variant failed, surfacing the first failure's error + status. A coded failure
  // (our own generic fallback, no engine text) throws with an EMPTY client string so
  // the client localizes; engine text passes through verbatim.
  if (successes.length === 0) {
    const first = failures[0];
    const engineText = first && !first.code ? first.error : "";
    return {
      kind: "throw",
      error: engineText,
      logError: first?.error || first?.code || "analyze failed",
      status: first?.status ?? 500,
    };
  }
  return {
    kind: "deliver",
    successes,
    partialFailures: failures.map((f) => ({ label: f.label, error: f.error, ...(f.code ? { code: f.code } : {}) })),
    // Cache-hit accounting over the DELIVERED successes only: bill one unit unless
    // every success was cached (no new work). A failed variant adds no second debit.
    allCached: successes.every((r) => r.cached),
  };
}

function cliArgs(cvPath: string, p: AnalyzeParams, jobStructurePath?: string | null): string[] {
  const args = ["-m", "pipeline.jobfit.cli", cvPath];
  if (p.grounding) args.push("--grounding");
  if (p.blind) args.push("--blind");
  args.push("--lang", p.lang || "en");
  if (p.jobDescriptionPath) args.push("--job-description-path", p.jobDescriptionPath);
  else if (p.jobDescriptionText?.trim()) args.push("--job-description-text", p.jobDescriptionText.trim());
  if (jobStructurePath) args.push("--job-json", jobStructurePath);
  if (p.companyPath) args.push("--company-path", p.companyPath);
  else if (p.companyText?.trim()) args.push("--company-text", p.companyText.trim());
  return args;
}

// Role-intake Phase 0: when the analysis targets a library JD, the ingested
// structured Job at `jd-<slug>` already carries the authored requirement grading
// (must/nice + prerequisite/learnable) — resolve it server-side and hand it to
// the pipeline beside the JD prose, so scoring stops re-deriving a flattened
// requirement list by regex. Best-effort: no ingested job (market-only JD,
// failed ingest) or no requirements ⇒ prose-only, exactly as before.
function resolveJobStructure(jdSlug: string | null | undefined): string | null {
  if (!jdSlug?.trim()) return null;
  try {
    const job = getJob(jdJobId(jdSlug.trim()));
    if (!job || !Array.isArray(job.requirements) || job.requirements.length === 0) return null;
    return JSON.stringify(job);
  } catch {
    return null;
  }
}

// Shared shape for every analyze.log line: the request/context fields that are
// identical across the failure, single-analysis, and comparison branches. Each
// call site spreads this and adds only its status-specific keys (status, error,
// candidate_label, variant_count, cache_hit, saved_slug) so the common fields
// can never drift between success and failure runs.
function baseAnalyzeLog(
  p: AnalyzeParams,
  startedAt: number
): Pick<
  AnalyzeLog,
  "request_id" | "route" | "jd_present" | "jd_slug" | "company_present" | "github_present" | "duration_ms"
> {
  return {
    request_id: p.requestId,
    route: "analyze",
    jd_present: Boolean(p.jobDescriptionPath || p.jobDescriptionText?.trim()),
    jd_slug: p.jdSlug ?? null,
    company_present: Boolean(p.companyPath || p.companyText?.trim()),
    github_present: false,
    duration_ms: Date.now() - startedAt,
  };
}

export async function runAnalyze(p: AnalyzeParams, onProgress?: ProgressFn, signal?: AbortSignal): Promise<unknown> {
  const startedAt = Date.now();
  try {
    const jdFileBytes = p.jobDescriptionPath ? await readFile(p.jobDescriptionPath) : null;
    const coFileBytes = p.companyPath ? await readFile(p.companyPath) : null;
    // Structured job context resolved ONCE per run and written beside the other
    // inputs in baseDir (cleaned up in the finally below); all variants share it.
    const jobStructureJson = resolveJobStructure(p.jdSlug);
    let jobStructurePath: string | null = null;
    if (jobStructureJson) {
      jobStructurePath = path.join(p.baseDir, "job-structure.json");
      await writeFile(jobStructurePath, jobStructureJson, "utf-8");
    }
    const total = p.variants.length;
    let done = 0;
    // Direction 3 — honest progress: emit the phases the TS side can actually
    // OBSERVE through the task row (reading → analyzing → saving), replacing the
    // client's fixed cosmetic timeline. The per-variant `done`/`total` counter
    // rides along (real completion signal for a multi-CV comparison).
    onProgress?.(0, total, ANALYZE_PHASE.reading);

    const results: VariantResult[] = await Promise.all(
      p.variants.map(async ({ label, cvPath }): Promise<VariantResult> => {
        try {
          const cvBytes = await readFile(cvPath);
          const cacheKey = computeCacheKey({
            cvBytes,
            jobDescriptionText: p.jobDescriptionText ?? "",
            jobDescriptionFileBytes: jdFileBytes,
            companyText: p.companyText ?? "",
            companyFileBytes: coFileBytes,
            grounding: p.grounding,
            lang: p.lang || "en",
            blind: p.blind,
            jobStructureJson: jobStructureJson ?? undefined,
          });

          const cached = lookupCachedAnalysis(cacheKey);
          if (cached) {
            const parsed = analysisSchema.safeParse(cached);
            if (parsed.success) {
              onProgress?.(++done, total, ANALYZE_PHASE.analyzing);
              return { label, ok: true, analysis: parsed.data, cached: true };
            }
          }

          // The engine is now running for this variant — the long, opaque LLM span.
          // The client shows honest indeterminate progress + elapsed here.
          onProgress?.(done, total, ANALYZE_PHASE.analyzing);
          // Forward the task's abort signal so canceling the task (DELETE
          // /api/tasks/[id] → cancelTask → controller.abort()) actually SIGKILLs the
          // Python child instead of leaving it to finish a billable LLM call whose
          // result is thrown away. spawnPython wires abort → SIGKILL.
          const { result } = spawnPython(cliArgs(cvPath, p, jobStructurePath), { signal });
          const { stdout, stderr, exitCode } = await result;
          if (exitCode !== 0) {
            const err = parseStderrError(stderr, exitCode);
            onProgress?.(++done, total, ANALYZE_PHASE.analyzing);
            return { label, ok: false, error: err.message, status: err.status };
          }
          let payload: unknown;
          try {
            // parsePythonJson, not raw JSON.parse: the analyze CLI invokes an LLM and
            // the interpreter can print shutdown chatter (asyncio "Event loop is
            // closed", ResourceWarning, "leaked semaphore") AFTER the JSON line — a raw
            // parse then 502s an already-paid, successful analysis and never caches it.
            // Sibling LLM runners (reasoning-run) already use this for the same reason.
            payload = parsePythonJson<unknown>(stdout, stderr);
          } catch (parseError) {
            onProgress?.(++done, total, ANALYZE_PHASE.analyzing);
            // parseError.message is engine text (shown verbatim); the fallback is our
            // own literal → carry a code so the client localizes instead.
            const engineMsg = parseError instanceof Error ? parseError.message : null;
            return {
              label,
              ok: false,
              error: engineMsg ?? `Pipeline returned non-JSON output for "${label}".`,
              ...(engineMsg ? {} : { code: ANALYZE_GENERIC_FAIL_CODE }),
              status: 502,
            };
          }
          const parsed = analysisSchema.safeParse(payload);
          if (!parsed.success) {
            onProgress?.(++done, total, ANALYZE_PHASE.analyzing);
            // Our own literal (no engine text) → coded so the client localizes it.
            return { label, ok: false, error: `Pipeline returned an unexpected payload for "${label}".`, code: ANALYZE_GENERIC_FAIL_CODE, status: 502 };
          }
          storeCachedAnalysis(cacheKey, parsed.data);
          onProgress?.(++done, total, ANALYZE_PHASE.analyzing);
          return { label, ok: true, analysis: parsed.data, cached: false };
        } catch (caught) {
          // A thrown variant (readFile IO error, spawn failure, an aborted child's
          // "Python process aborted" reject) is CAPTURED here rather than rejecting
          // the whole Promise.all — otherwise one bad variant discards its good
          // siblings. A real cancellation is still honored below (signal.aborted).
          onProgress?.(Math.min(done + 1, total), total, ANALYZE_PHASE.analyzing);
          // caught.message is engine text (shown verbatim); the fallback is our own
          // literal → carry a code so the client localizes instead of leaking English.
          const engineMsg = caught instanceof Error ? caught.message : null;
          return {
            label,
            ok: false,
            error: engineMsg ?? `Analysis failed for "${label}".`,
            ...(engineMsg ? {} : { code: ANALYZE_GENERIC_FAIL_CODE }),
            status: 500,
          };
        }
      })
    );

    // Cancellation wins over partial delivery: if the run was aborted (Reset /
    // Cancel / task DELETE → SIGKILL), don't hand back a half-batch — throw so
    // runOne marks the task 'canceled', preserving the pre-change SIGKILL
    // semantics. (The captured-failure catch above would otherwise turn an aborted
    // child into a "failed variant" and let a stray success deliver.)
    // An empty client-facing message: 'canceled' is the real signal (runOne marks the
    // task canceled), and an empty task.error makes the client render its localized
    // message rather than an English literal. The log below keeps a fixed marker.
    if (signal?.aborted) throw new AnalyzeError("", 499);

    const settled = settleVariants(results);
    if (settled.kind === "throw") {
      void logAnalyze({
        ...baseAnalyzeLog(p, startedAt),
        candidate_label: p.variants[0]?.label,
        variant_count: total,
        cache_hit: false,
        status: "error",
        error: settled.logError,
      });
      throw new AnalyzeError(settled.error, settled.status);
    }

    const { successes, partialFailures, allCached } = settled;
    const analyses = successes.map((r) => ({ label: r.label, analysis: r.analysis }));

    // Every variant is done — the remaining work is persisting the report. Emit the
    // final honest phase so the strip advances to "saving" on a real signal.
    onProgress?.(total, total, ANALYZE_PHASE.saving);

    // Bill ONE AI-candidate unit only for a DELIVERED, non-cached analysis (variants of
    // the same person count once). A total wipeout or cancel threw above and never
    // reaches here; a fully-cached re-run (a duplicate / re-analyze of the same CV) did
    // no new work — so the meter counts analyses actually PERFORMED, not submits.
    // Org attribution (org-plan Phase 3): the debit lands on the requesting
    // workspace's org — the same tenant the gate (meterGate({ workspace })) read.
    if (!allCached) recordMeterUsage("ai_candidates", 1, new Date(), p.workspace);

    // A comparison needs at least MIN_COMPARISON_VARIANTS surviving successes; a
    // 3-variant run that lost one to a failure delivers a 2-way compare, and a
    // 2-variant run that lost one delivers the lone survivor (no compare). Either
    // way `partialFailures` names what didn't make it, surfaced by the client UI.
    if (analyses.length === 1) {
      const single = analyses[0];
      // Single analysis ⇒ exactly one variant, so its cvHash is the identity.
      const persisted = persistAnalysis(single.label, p.jdSlug ?? null, single.analysis, p.workspace, p.variants[0]?.cvHash);
      void logAnalyze({
        ...baseAnalyzeLog(p, startedAt),
        candidate_label: single.label,
        variant_count: total,
        cache_hit: allCached,
        status: "ok",
        saved_slug: persisted?.slug ?? null,
      });
      return {
        ...single.analysis,
        persistence: persisted,
        // Whether this delivery did NO new engine work (every success cached) — the
        // live result surfaces a "served from cache, no new cost" note from it.
        servedFromCache: allCached,
        ...(partialFailures.length ? { partialFailures } : {}),
      };
    }

    const comparison = buildComparison(analyses);
    const winner = analyses.find((a) => a.label === comparison.bestLabel) ?? analyses[0];
    const merged = { ...winner.analysis, comparison };
    // Best-of-N ⇒ the saved row represents the WINNING variant, so key it to the
    // winner's CV content hash (matched back by label).
    const winnerHash = p.variants.find((v) => v.label === winner.label)?.cvHash;
    const persisted = persistAnalysis(`${winner.label} (best of ${analyses.length})`, p.jdSlug ?? null, merged, p.workspace, winnerHash);
    void logAnalyze({
      ...baseAnalyzeLog(p, startedAt),
      candidate_label: `${winner.label} (best of ${analyses.length})`,
      variant_count: analyses.length,
      cache_hit: allCached,
      status: "ok",
      saved_slug: persisted?.slug ?? null,
    });
    return {
      ...merged,
      persistence: persisted,
      servedFromCache: allCached,
      ...(partialFailures.length ? { partialFailures } : {}),
    };
  } finally {
    await cleanupWorkdir(p.baseDir);
  }
}

function persistAnalysis(candidateLabel: string, jdSlug: string | null, analysis: Analysis, workspaceId?: string, cvHash?: string) {
  try {
    // Echo the persisted candidate label + JD slug back onto the receipt (the DB
    // returns only { slug, createdAt }). The live Analyze result reads these to
    // offer the SAME "Add to pipeline" the saved report does — filed under the
    // EXACT label the report's on-board chip matches by, and the JD slug the
    // board keys its lanes on — without a round-trip to History (Direction 1).
    const receipt = saveAnalysis({
      candidateLabel,
      jdSlug,
      // Content-addressed identity — persisted so re-runs of the same CV collapse
      // in History and link across jobs instead of accumulating filename-keyed rows.
      cvHash: cvHash ?? null,
      // Store the RECONCILED total (component sum), the same value the report dial / Compare
      // "Overall" render via reconcileScoreTotal — so the History list + detail header (which
      // read this denormalized column) can't disagree with the dial when the pipeline's raw
      // total drifts from the sum of its parts. The raw total stays in `payload` for anyone
      // who needs it.
      score: analysis.score ? reconcileScoreTotal(analysis.score) : null,
      roleFamily: analysis.candidate?.roleFamily ?? null,
      seniority: analysis.candidate?.currentSeniority ?? null,
      payload: analysis,
      reviewFlags: countSanityWarns(analysis.sanityChecks ?? []),
    }, workspaceId);
    return { ...receipt, candidateLabel, jdSlug };
  } catch (error) {
    console.error("Failed to persist analysis", error);
    return null;
  }
}
