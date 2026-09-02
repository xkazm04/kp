import { analysisSchema, type Analysis } from "@/app/_lib/schemas";
import type { StageStatus } from "@/app/_components/AnalysisProgress";
import { asAnalyzePhase } from "@/app/_lib/analyze-phases";
import type { AnalyzeErrorCode, AnalyzeErrorInfo, ProgressEmitter } from "./AnalyzeTypes";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A client-side analyze failure that carries a stable `code` (a key in the
// `analyze` message namespace) so the surface can localize it — these modules
// aren't components and have no translator of their own (the repo's API-helper
// pattern: throw/return a code, the component maps it, mirroring useErrorMessage).
// `serverText` is engine/server-owned English (Python stderr, a route's operator
// message) that can't be coded — the component prefers it verbatim (the honest
// "shown in English" disclosure on this operator-facing surface) and otherwise
// falls back to the localized code.
export class AnalyzeClientError extends Error {
  code: AnalyzeErrorCode;
  serverText?: string;
  /** The failing route's own machine code, when it publishes one — resolved by the
   *  surface ahead of `serverText`, since a code localizes and English doesn't. */
  apiCode?: string;
  /** The refusal's HTTP status, kept so the surface can tell a 413 from a 402
   *  from a 429 without re-reading a message. */
  status?: number;
  /** Seconds from a `Retry-After` response header, when the boundary sent one.
   *  kp's own in-process limiter has no window to report, but a self-host behind
   *  nginx/Cloudflare gets one for free — so when it IS present the form says
   *  "try again in N seconds" instead of an open-ended "too many requests". */
  retryAfterSeconds?: number;
  constructor(
    code: AnalyzeErrorCode,
    serverText?: unknown,
    apiCode?: unknown,
    extra?: { status?: number; retryAfterSeconds?: number }
  ) {
    const text = typeof serverText === "string" && serverText.trim() ? serverText.trim() : undefined;
    super(text ?? code);
    this.name = "AnalyzeClientError";
    this.code = code;
    this.serverText = text;
    this.apiCode = typeof apiCode === "string" && apiCode.trim() ? apiCode.trim() : undefined;
    this.status = extra?.status;
    this.retryAfterSeconds = extra?.retryAfterSeconds;
  }
}

/** The four localized channels `resolveAnalyzeErrorText` can draw on, supplied by
 *  the component that has the translators. Each catalog lookup answers `null` for
 *  a code it does not know, so the resolver can keep walking instead of painting a
 *  key. Pure — so the precedence is testable without rendering anything. */
export type AnalyzeMessageResolvers = {
  /** app-wide `errors.<CODE>` (useErrorMessage) */
  appCode: (code: string) => string | null;
  /** the GitHub deep-dive's own `results.github.errors.<CODE>` */
  githubCode: (code: string) => string | null;
  /** this surface's stable `analyze.<code>` failures */
  analyzeCode: (code: string) => string | null;
  /** "too many requests — try again in N seconds" */
  retryAfter: (seconds: number) => string;
  /** the last-resort generic failure line */
  generic: string;
};

/**
 * THE precedence, in one place: a machine CODE beats the server's English, which
 * beats the generic line. A code localizes and English does not, so preferring
 * `serverText` over a code would be the inverted-fallback-chain trap by another
 * name (api-contracts.md §1.1, and the header of use-error-message.ts).
 *
 * Two details worth keeping:
 *  • a throttle that came with a Retry-After outranks everything, because
 *    "try again in 45 seconds" is strictly more actionable than "too many
 *    requests";
 *  • an api code NO catalog knows falls THROUGH to the server text. The previous
 *    resolver returned the generic line the moment an apiCode existed, so a code
 *    added on the server before the catalogs caught up threw away the only
 *    information the failure carried.
 */
export function resolveAnalyzeErrorText(info: AnalyzeErrorInfo, r: AnalyzeMessageResolvers): string {
  if (info.apiCode === "TOO_MANY_REQUESTS" && typeof info.retryAfterSeconds === "number" && info.retryAfterSeconds > 0) {
    return r.retryAfter(info.retryAfterSeconds);
  }
  if (info.apiCode) {
    const known = r.appCode(info.apiCode) ?? r.githubCode(info.apiCode);
    if (known) return known;
  }
  const server = info.serverText?.trim();
  if (server) return server;
  return (info.code ? r.analyzeCode(info.code) : null) ?? r.generic;
}

/** Seconds from a `Retry-After` header — the delta-seconds form or an HTTP date.
 *  Anything unparseable answers undefined, so the caller simply shows the plain
 *  throttle line. */
export function retryAfterSeconds(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw.trim());
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return undefined;
  const delta = Math.ceil((at - Date.now()) / 1000);
  return delta > 0 ? delta : undefined;
}

// POST the upload; the server persists it and starts a background `analyze`
// task, returning its id. The actual run is tracked + refresh-safe via /api/tasks.
export async function submitAnalysis(
  cvFiles: File[],
  jobDescriptionFile: File | null,
  jobDescriptionText: string,
  companyFile: File | null,
  companyText: string,
  jdSlug: string | null,
  reportLang?: string,
  blind?: boolean
): Promise<string> {
  const form = new FormData();
  form.append("grounding", "true");
  if (blind) form.append("blind", "true");
  if (cvFiles.length === 1) form.append("cv", cvFiles[0]);
  else for (const file of cvFiles) form.append("cvs", file);
  if (jobDescriptionFile) form.append("jobDescription", jobDescriptionFile);
  if (jobDescriptionText.trim()) form.append("jobDescriptionText", jobDescriptionText);
  if (companyFile) form.append("company", companyFile);
  if (companyText.trim()) form.append("companyText", companyText);
  if (jdSlug) form.append("jdSlug", jdSlug);
  if (reportLang) form.append("reportLang", reportLang); // CV3 — per-run report language

  const response = await fetch("/api/analyze", { method: "POST", body: form });
  // A refusal is not guaranteed to be JSON (a proxy's own 413/429 page is not),
  // so a parse failure must degrade to the coded path rather than throw a
  // SyntaxError the surface would render as an unexplained crash.
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    // Every refusal this route can produce now carries a code — the upload gate's
    // UPLOAD_*, the form's ANALYZE_*, the throttle's TOO_MANY_REQUESTS, billing's
    // quota code. The status and any Retry-After ride along so the surface can be
    // specific without reading English.
    throw new AnalyzeClientError("errFailed", payload?.error, payload?.code, {
      status: response.status,
      retryAfterSeconds: retryAfterSeconds(response.headers),
    });
  }
  const taskId = payload?.task?.id as string | undefined;
  if (!taskId) throw new AnalyzeClientError("errNotStarted");
  return taskId;
}

// Poll a running analyze task to completion, advancing the stage strip on the
// server's REAL phase transitions — NOT a cosmetic timer.
//
// Direction 3 — the old code animated a six-stage strip on a fixed 1800ms
// interval unrelated to server state (a lie: it froze mid-strip for the whole
// 30–60s engine call). analyze-run now emits observable phases (reading →
// analyzing → saving) through the task row's progress `msg`; each poll maps that
// phase to a stage event, so the strip only ever advances on a genuine signal and
// a stalled engine visibly stalls (the phase stays "analyzing", elapsed keeps
// ticking). Retries can't rewind the strip — applyStageEvent only completes
// earlier stages, never re-opens them.
//
// bug-ui-scan-2026-07-09 (cv-analysis-workspace #5): each poll ALSO carries the
// server's genuine per-variant progress (task.progressDone/progressTotal, written
// by runAnalyze via setTaskProgress), forwarded through `onVariantProgress` so a
// multi-CV comparison shows real completion.
export type VariantProgress = { done: number; total: number; msg: string | null };

export async function watchAnalysis(
  taskId: string,
  onProgress: ProgressEmitter,
  signal?: AbortSignal,
  onVariantProgress?: (p: VariantProgress) => void
): Promise<Analysis> {
  // Seed the first observable phase immediately so the strip isn't blank for the
  // ~1.5s until the first poll returns; the real phases from the server take over.
  onProgress("reading", "active");

  // A permanently-failing poll (the task row was reaped after a `next dev`
  // hot-restart, or the in-memory runner was lost) must not spin forever with no
  // escape. Count consecutive non-OK polls and bail past a threshold; a healthy
  // slow run keeps returning 200 (status "running") and resets the counter, so a
  // legitimately long analysis is never abandoned. A 404 is terminal on its own.
  const MAX_CONSECUTIVE_ERRORS = 10; // ~15s of solid failure at the 1.5s cadence
  let consecutiveErrors = 0;
  // Count one soft (non-terminal) poll failure and bail past the threshold. The
  // three soft-failure branches below (thrown fetch, non-OK response, missing task
  // body) all funnel through here so the threshold and the user-facing message stay
  // single-sourced.
  const softFail = () => {
    if ((consecutiveErrors += 1) >= MAX_CONSECUTIVE_ERRORS) {
      throw new AnalyzeClientError("errLostTrack");
    }
  };
  const aborted = () => signal?.aborted ?? false;

  while (true) {
    if (aborted()) throw new DOMException("Analysis watch aborted", "AbortError");
    await delay(1500);
    if (aborted()) throw new DOMException("Analysis watch aborted", "AbortError");
    let r: Response;
    try {
      r = await fetch(`/api/tasks/${taskId}`, { signal });
    } catch (err) {
      if (aborted()) throw err; // intentional cancel — surfaced as AbortError
      softFail();
      continue;
    }
    // 404 = the task is gone (reaped / lost to a restart); it will never reach a
    // terminal success, so stop now rather than poll a vanished task forever.
    if (r.status === 404) throw new AnalyzeClientError("errUnavailable");
    if (!r.ok) {
      softFail();
      continue;
    }
    const body = await r.json().catch(() => null);
    const task = body?.task;
    if (!task) {
      softFail();
      continue;
    }
    consecutiveErrors = 0;
    // Direction 3 — advance the strip on the server's REAL phase. asAnalyzePhase
    // narrows the progress msg to a known stage id; applyStageEvent (via the
    // emitter) marks earlier phases done, so the strip only ever moves forward.
    const phase = asAnalyzePhase(typeof task.progressMsg === "string" ? task.progressMsg : null);
    if (phase) onProgress(phase, "active" as StageStatus);
    // Forward the server's real per-variant counter (0 while it warms up). The
    // component only surfaces it for a genuine multi-variant comparison.
    if (onVariantProgress && typeof task.progressTotal === "number") {
      onVariantProgress({
        done: typeof task.progressDone === "number" ? task.progressDone : 0,
        total: task.progressTotal,
        msg: typeof task.progressMsg === "string" ? task.progressMsg : null,
      });
    }
    if (task.status === "succeeded") {
      const parsed = analysisSchema.safeParse(task.result);
      if (parsed.success) return parsed.data;
      throw new AnalyzeClientError("errBadPayload");
    }
    if (task.status === "failed" || task.status === "canceled" || task.status === "interrupted") {
      // task.error is engine/server text (Python stderr, or empty when the server
      // only had a generic coded fallback). Prefer it verbatim when present;
      // otherwise the localized "did not complete" message shows.
      throw new AnalyzeClientError("errIncomplete", task.error);
    }
  }
}

// Extract plain text from an uploaded document via the server-side Python
// extractor (the same one the CV pipeline uses). Lets the GitHub deep-dive read
// a file-only JD instead of silently treating it as empty.
export async function extractFileText(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/extract-text", { method: "POST", body: form });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload.text !== "string") {
    throw new AnalyzeClientError("errExtractionFailed", payload?.error);
  }
  return payload.text;
}

// Not dead: consumed by AnalyzeFileDropZone.tsx and AnalyzeProfileInput.tsx to
// label an attached file's size. (Direction 2 audited it — kept, not removed.)
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
