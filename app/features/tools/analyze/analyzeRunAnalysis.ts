"use client";

import {
  applyStageEvent,
  STAGE_ORDER,
  type StageState,
} from "@/app/_components/AnalysisProgress";
import {
  githubAnalysisSchema,
  type Analysis,
  type GithubAnalysis,
} from "@/app/_lib/schemas";
import { AnalyzeClientError, extractFileText, submitAnalysis, watchAnalysis, type VariantProgress } from "./AnalyzeApi";
import type { AnalyzeErrorCode, AnalyzeErrorInfo } from "./AnalyzeTypes";

type ProgressStage = Parameters<typeof applyStageEvent>[1];
type ProgressStatus = Parameters<typeof applyStageEvent>[2];

// Turn a caught failure into the localizable descriptor the surface maps. Only an
// AnalyzeClientError carries a mappable code + optional server-English text; any
// other throw (a Zod parse blob, a bare network error, an unexpected reject) has
// no user-safe English, so it degrades to the caller's stable fallback code —
// never leaking an internal message into the toast.
function toErrorInfo(caught: unknown, fallback: AnalyzeErrorCode): AnalyzeErrorInfo {
  if (caught instanceof AnalyzeClientError)
    return {
      code: caught.code,
      apiCode: caught.apiCode,
      serverText: caught.serverText,
      status: caught.status,
      retryAfterSeconds: caught.retryAfterSeconds,
    };
  return { code: fallback };
}

export type AnalysisInputs = {
  cvFiles: File[];
  jobDescriptionFile: File | null;
  jobDescriptionText: string;
  companyFile: File | null;
  companyText: string;
  selectedJdSlug: string | null;
  // CV3 — per-run report-narrative language (en|cs), defaulting to the active
  // locale; the route prefers it over the cookie so a recruiter can produce an
  // English report for an international panel without flipping the whole app.
  reportLang?: string;
  // b8d711c4 — blind screening: redact identity from the CV before scoring.
  blind?: boolean;
};

export type AnalysisCallbacks = {
  onProgress: (stage: ProgressStage, status: ProgressStatus) => void;
  onFinalize: () => void;
  onResult: (analysis: Analysis) => void;
  onError: (error: AnalyzeErrorInfo) => void;
  /** Fired with the background task id once it starts (used to survive refresh). */
  onTaskStarted?: (taskId: string) => void;
  /**
   * bug-ui-scan-2026-07-09 (cv-analysis-workspace #5): the server's REAL
   * per-variant completion (done/total). Surfaced so a multi-variant comparison
   * shows genuine progress instead of the invented single stage track.
   */
  onVariantProgress?: (p: VariantProgress) => void;
};

// An intentional abort (reset / cancel / tab unmount) is not a failure — the
// caller already tore the UI down, so it must not surface an error toast.
function isAbort(signal: AbortSignal | undefined, caught: unknown): boolean {
  return Boolean(signal?.aborted) || (caught as { name?: string } | null)?.name === "AbortError";
}

// The shared resolve/error tail both the fresh run and the resume path run once a
// task id is in hand: watch the task to completion, finalize, then hand the result
// to the caller after the brief 320ms settle. An intentional abort is swallowed
// here; any other failure surfaces the error. The AbortSignal is threaded straight
// through to watchAnalysis and the isAbort check — do not weaken it.
async function settleAnalysis(taskId: string, callbacks: AnalysisCallbacks, signal?: AbortSignal): Promise<void> {
  try {
    const parsed = await watchAnalysis(taskId, callbacks.onProgress, signal, callbacks.onVariantProgress);
    callbacks.onFinalize();
    window.setTimeout(() => callbacks.onResult(parsed), 320);
  } catch (caught) {
    if (isAbort(signal, caught)) return;
    callbacks.onError(toErrorInfo(caught, "errFailed"));
  }
}

export async function executeAnalysis(
  inputs: AnalysisInputs,
  callbacks: AnalysisCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const { cvFiles, jobDescriptionFile, jobDescriptionText, companyFile, companyText, selectedJdSlug, reportLang, blind } = inputs;
  let taskId: string;
  try {
    taskId = await submitAnalysis(cvFiles, jobDescriptionFile, jobDescriptionText, companyFile, companyText, selectedJdSlug, reportLang, blind);
    callbacks.onTaskStarted?.(taskId);
  } catch (caught) {
    if (isAbort(signal, caught)) return;
    callbacks.onError(toErrorInfo(caught, "errFailed"));
    return;
  }
  await settleAnalysis(taskId, callbacks, signal);
}

// Re-attach to an analyze task already running on the server (e.g. after a page
// refresh) and resolve it like a fresh run.
export async function resumeAnalysis(taskId: string, callbacks: AnalysisCallbacks, signal?: AbortSignal): Promise<void> {
  await settleAnalysis(taskId, callbacks, signal);
}

export function finalizeStages(prev: StageState): StageState {
  const finalized: StageState = { ...prev };
  for (const id of STAGE_ORDER) finalized[id] = "done";
  return finalized;
}

export type GithubCallbacks = {
  onLoading: () => void;
  onResult: (analysis: GithubAnalysis) => void;
  onError: (error: AnalyzeErrorInfo) => void;
  /**
   * A non-fatal degradation note: the deep-dive still produced a result, but it
   * ran with less than the user supplied (e.g. JD-blind because the attached JD
   * couldn't be read). Surfaced as a warning, not an error, so the result still
   * shows alongside it.
   */
  onWarning?: (warning: AnalyzeErrorInfo) => void;
};

// The JD as the form holds it: textarea/library text plus the optional uploaded
// file. The GitHub deep-dive must read the same JD source as the main analysis,
// so a file-only JD is extracted to text before the route is called.
export type GithubJdSource = {
  jobDescriptionText: string;
  jobDescriptionFile: File | null;
};

export async function executeGithubAnalysis(
  profile: string,
  jd: GithubJdSource,
  callbacks: GithubCallbacks
): Promise<void> {
  callbacks.onLoading();
  try {
    // Read the JD from the same source the main analysis does. That pipeline
    // prefers the uploaded file over the textarea (see analyze-run cliArgs), so
    // extract the file's text first; otherwise buildJobFitSignals would run
    // against an empty JD — a JD-blind result shown beside a main analysis that
    // DID use the JD. Extraction failure/empties fall back to the typed text, so
    // this never blocks the optional GitHub analysis or does worse than before.
    let jobDescriptionText = jd.jobDescriptionText.trim();
    if (jd.jobDescriptionFile) {
      const extracted = (await extractFileText(jd.jobDescriptionFile).catch(() => "")).trim();
      if (extracted) jobDescriptionText = extracted;
    }
    // The user supplied a JD but we ended up with no usable text — the only way
    // this happens is a JD file that wouldn't extract and no typed fallback, so
    // the deep-dive below is about to run JD-blind. Tell the user the JD was
    // dropped instead of showing a result that quietly ignored it.
    const jdSupplied = Boolean(jd.jobDescriptionFile) || jd.jobDescriptionText.trim().length > 0;
    if (jdSupplied && !jobDescriptionText) {
      callbacks.onWarning?.({ code: "githubJdDropped" });
    }
    const response = await fetch("/api/github-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile, jobDescriptionText }),
    });
    const payload = await response.json();
    // Treat any payload carrying `error` as a soft failure — the GitHub deep-dive
    // is optional and the route returns 200 + { error, code } to keep the browser
    // console clean when GitHub rate-limits us, so the field's presence (not the
    // HTTP status) is the discriminator.
    if (payload && typeof payload === "object" && "error" in payload) {
      // The route's machine code (results.github.errors.*) is what the surface
      // shows; the English `error` rides along only as the log-side detail.
      throw new AnalyzeClientError("errGithubFailed", undefined, payload.code);
    }
    if (!response.ok) throw new AnalyzeClientError("errGithubFailed");
    callbacks.onResult(githubAnalysisSchema.parse(payload));
  } catch (caught) {
    callbacks.onError(toErrorInfo(caught, "errGithubFailed"));
  }
}
