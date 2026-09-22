import { githubAnalysisSchema, type GithubAnalysis } from "@/app/_lib/schemas";
import { parseGithubUsername } from "@/app/_lib/github-handle";
import { githubCacheKey } from "@/app/_lib/github/cache";
import { GithubAnalysisError, type GithubErrorCode } from "@/app/_lib/github/client";
import type { ExternalTaskCtx } from "@/app/_lib/task-external-runners";

// The GitHub deep-dive as a STAGE of the analyze task (challenge-r02 analyze-engine/A).
//
// A CV run with a handle used to launch this from the browser, BESIDE the server task:
// it had no task id, so switching tab aborted it after GitHub and Gemini were already
// paid; the saved report got it only through a client PATCH that needed the hook still
// mounted; and the blind rule ("no deep-dive in blind mode") was a client predicate no
// server code enforced. Running it inside the task gives it the task's identity:
// re-attach, cancel and the stored result all hang off the one run, and the row write
// is the server's.
//
// GitHub-only runs and the panel's Retry still use /api/github-analysis — the door is
// not retired, and this stage mirrors its rules (handle grammar, the JD budget, the TTL
// cache, the degraded-read rule, coded failures) so the two paths answer alike.
//
// `runGithubStage` is pure over injected deps. `runGithubStageTask` is the wiring the
// analyze route registers into the late-bound runner registry: analyze-run.ts looks it
// up there instead of importing it, because analyze-run sits on tasks.ts's graph and the
// GitHub harvest (REST client, heuristics, Gemini review) must not ride onto the ~60
// routes that import that hub (perf-budget.json).

/** The prompt budget /api/github-analysis refuses past (GITHUB_JD_MAX_CHARS there). A JD
 *  this long is a mistake, and a deep-dive over a third of one is the worse failure. */
export const GITHUB_STAGE_JD_MAX_CHARS = 20_000;

/** The extractor's deadline — the same order as /api/extract-text's own. */
const JD_EXTRACT_TIMEOUT_MS = 55_000;

export type GithubStageResult =
  | { status: "done"; analysis: GithubAnalysis; warning?: "githubJdDropped" }
  | { status: "error"; code: string; retryAfterSec?: number }
  | { status: "skipped"; reason: "blind" };

export type GithubStageInput = {
  profile: string;
  blind: boolean;
  /** The typed/library JD text, when there is one. */
  jdText?: string | null;
  /** The persisted JD file, when there is one — preferred over the text, exactly as the
   *  CV pipeline prefers it (analyze-run cliArgs). */
  jdPath?: string | null;
  requestId?: string;
  /** The saved analysis row's slug. It may still be pending — the CV half persists
   *  after its variants settle — so it is awaited only once the deep-dive is in hand.
   *  null = the CV half saved no row; the deep-dive is then delivered but not stored. */
  savedSlug?: PromiseLike<string | null> | string | null;
  signal?: AbortSignal;
};

export type GithubStageDeps = {
  buildGithubAnalysis: (username: string, jobDescription: string, requestId: string) => Promise<GithubAnalysis>;
  isTransientlyDegraded: (analysis: GithubAnalysis) => boolean;
  readGithubCache: (key: string) => unknown | undefined;
  writeGithubCache: (key: string, payload: unknown) => void;
  /** The JD file's text (pipeline.jobfit.extract_cli). May throw; the stage degrades. */
  extractJdText: (path: string) => Promise<string>;
  /** Attach the deep-dive onto the saved row (setAnalysisGithub). */
  persist: (slug: string, githubJson: string) => void;
  /** The github.log line, when wired. */
  log?: (entry: { username: string; status: "ok" | "error"; durationMs: number; analysis?: GithubAnalysis; error?: string }) => void;
};

const fail = (code: GithubErrorCode | string, retryAfterSec?: number): GithubStageResult =>
  retryAfterSec ? { status: "error", code, retryAfterSec } : { status: "error", code };

/** Run the deep-dive for one CV run. NEVER throws: every failure is a coded outcome on
 *  the task result, so a deep-dive can neither fail nor re-bill the CV run it rides. */
export async function runGithubStage(input: GithubStageInput, deps: GithubStageDeps): Promise<GithubStageResult> {
  // THE BLIND RULE, server-side. Blind screening redacts identity from the CV before
  // scoring; the deep-dive renders the candidate's real GitHub identity. Refused before
  // anything is read, spent or written — whatever the client sent.
  if (input.blind) return { status: "skipped", reason: "blind" };
  const username = parseGithubUsername(input.profile);
  if (!username) return fail("HANDLE_REQUIRED");
  if (input.signal?.aborted) return fail("ANALYSIS_FAILED");

  // The JD from the same source the CV pipeline read: the file first, the typed text as
  // the fallback when the file will not extract. Parity with executeGithubAnalysis.
  const typed = (input.jdText ?? "").trim();
  let jobDescription = typed;
  if (input.jdPath) {
    const extracted = (await deps.extractJdText(input.jdPath).catch(() => "")).trim();
    if (extracted) jobDescription = extracted;
  }
  const jdSupplied = Boolean(input.jdPath) || typed.length > 0;
  const warning = jdSupplied && !jobDescription ? ("githubJdDropped" as const) : undefined;
  if (jobDescription.length > GITHUB_STAGE_JD_MAX_CHARS) return fail("JD_TOO_LONG");

  const startedAt = Date.now();
  const cacheKey = githubCacheKey(username, jobDescription);
  let analysis: GithubAnalysis | null = null;
  const cached = deps.readGithubCache(cacheKey);
  if (cached !== undefined) {
    const parsed = githubAnalysisSchema.safeParse(cached);
    if (parsed.success) analysis = parsed.data;
  }
  if (!analysis) {
    if (input.signal?.aborted) return fail("ANALYSIS_FAILED");
    try {
      analysis = githubAnalysisSchema.parse(await deps.buildGithubAnalysis(username, jobDescription, input.requestId ?? ""));
    } catch (error) {
      const known = error instanceof GithubAnalysisError;
      deps.log?.({
        username,
        status: "error",
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      // The CODE, never the thrown message: an undici/provider string must not ride the
      // task result onto a recruiter's screen (api-contracts.md §1.1).
      return known ? fail(error.code, error.retryAfterSec) : fail("ANALYSIS_FAILED");
    }
    // Only a COMPLETE read is cacheable — a degraded one must stay retryable.
    if (!deps.isTransientlyDegraded(analysis)) deps.writeGithubCache(cacheKey, analysis);
    deps.log?.({ username, status: "ok", durationMs: Date.now() - startedAt, analysis });
  }

  // Persist onto THIS run's row once the CV half has one. Best-effort: the result still
  // reaches the live panel, and the panel's Retry can re-attach through the PATCH door.
  try {
    const slug = await input.savedSlug;
    if (slug && !input.signal?.aborted) deps.persist(slug, JSON.stringify(analysis));
  } catch (error) {
    console.error("[analyze-github-stage] failed to attach the deep-dive to the saved analysis", error);
  }
  return warning ? { status: "done", analysis, warning } : { status: "done", analysis };
}

/** The registered runner: real deps, loaded lazily on first use. `ctx.params` is the
 *  GithubStageInput analyze-run hands over in-process (never a client payload). */
export async function runGithubStageTask(ctx: ExternalTaskCtx): Promise<GithubStageResult> {
  const [{ buildGithubAnalysis, isTransientlyDegraded }, cache, { setAnalysisGithub }, runner, { logGithub }] =
    await Promise.all([
      import("@/app/_lib/github/analysis"),
      import("@/app/_lib/github/cache"),
      import("@/app/_lib/db/analyses"),
      import("@/app/_lib/python-runner"),
      import("@/app/_lib/logger"),
    ]);
  const input = ctx.params as unknown as GithubStageInput;
  const workspace = ctx.workspaceId || undefined;
  return runGithubStage(
    { ...input, signal: ctx.signal },
    {
      buildGithubAnalysis,
      isTransientlyDegraded,
      readGithubCache: cache.readGithubCache,
      writeGithubCache: cache.writeGithubCache,
      extractJdText: async (jdPath) => {
        const { result } = runner.spawnPython(["-m", "pipeline.jobfit.extract_cli", jdPath], {
          timeoutMs: JD_EXTRACT_TIMEOUT_MS,
          signal: ctx.signal,
        });
        const { stdout, stderr, exitCode } = await result;
        if (exitCode !== 0) return "";
        return runner.parsePythonJson<{ text?: string }>(stdout, stderr).text ?? "";
      },
      persist: (slug, json) => {
        setAnalysisGithub(slug, json, workspace);
      },
      log: (e) =>
        void logGithub({
          request_id: input.requestId ?? "",
          github_user: e.username,
          duration_ms: e.durationMs,
          status: e.status,
          rest_repos: e.analysis?.metrics.ownedReposAnalyzed ?? 0,
          ...(e.analysis?.codeReview ? { code_review_status: e.analysis.codeReview.status } : {}),
          ...(e.error ? { error: e.error } : {}),
        }),
    },
  );
}
