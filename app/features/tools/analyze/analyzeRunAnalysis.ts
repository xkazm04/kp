"use client";

import {
  applyStageEvent,
  STAGE_ORDER,
  type StageState,
} from "@/app/_components/AnalysisProgress";
import { type Analysis } from "@/app/_lib/schemas";
import { submitAnalysis, watchAnalysis, type VariantProgress } from "./AnalyzeApi";
import type { AnalyzeErrorInfo } from "./AnalyzeTypes";
import { isAbort, scheduleResultDelivery, toErrorInfo } from "./analyzeRunDelivery";

// Re-exported so the surface keeps ONE import site for "run an analysis", even
// though the abort/delivery tail and the GitHub deep-dive now live in their own
// (test-loadable) modules.
export { RESULT_SETTLE_MS, scheduleResultDelivery, type DeliveryTimers } from "./analyzeRunDelivery";
export { executeGithubAnalysis, type GithubCallbacks, type GithubJdSource } from "./analyzeGithubRun";

type ProgressStage = Parameters<typeof applyStageEvent>[1];
type ProgressStatus = Parameters<typeof applyStageEvent>[2];

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

// The shared resolve/error tail both the fresh run and the resume path run once a
// task id is in hand: watch the task to completion, finalize, then hand the result
// to the caller after the brief 320ms settle. An intentional abort is swallowed
// here; any other failure surfaces the error. The AbortSignal is threaded straight
// through to watchAnalysis, the delivery timer and the isAbort check — do not
// weaken it.
async function settleAnalysis(taskId: string, callbacks: AnalysisCallbacks, signal?: AbortSignal): Promise<void> {
  try {
    const parsed = await watchAnalysis(taskId, callbacks.onProgress, signal, callbacks.onVariantProgress);
    if (signal?.aborted) return;
    callbacks.onFinalize();
    scheduleResultDelivery(parsed, callbacks.onResult, signal);
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

