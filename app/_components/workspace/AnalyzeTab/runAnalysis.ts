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
import { runMultiVariantAnalysis, runStreamingAnalysis } from "./AnalyzeApi";

type ProgressStage = Parameters<typeof applyStageEvent>[1];
type ProgressStatus = Parameters<typeof applyStageEvent>[2];

export type AnalysisInputs = {
  cvFiles: File[];
  jobDescriptionFile: File | null;
  jobDescriptionText: string;
  companyFile: File | null;
  companyText: string;
  selectedJdSlug: string | null;
};

export type AnalysisCallbacks = {
  onProgress: (stage: ProgressStage, status: ProgressStatus) => void;
  onFinalize: () => void;
  onResult: (analysis: Analysis) => void;
  onError: (message: string) => void;
};

export async function executeAnalysis(
  inputs: AnalysisInputs,
  callbacks: AnalysisCallbacks
): Promise<void> {
  const {
    cvFiles,
    jobDescriptionFile,
    jobDescriptionText,
    companyFile,
    companyText,
    selectedJdSlug,
  } = inputs;
  try {
    const parsed =
      cvFiles.length === 1
        ? await runStreamingAnalysis(
            cvFiles[0],
            jobDescriptionFile,
            jobDescriptionText,
            companyFile,
            companyText,
            selectedJdSlug,
            callbacks.onProgress
          )
        : await runMultiVariantAnalysis(
            cvFiles,
            jobDescriptionFile,
            jobDescriptionText,
            companyFile,
            companyText,
            selectedJdSlug,
            callbacks.onProgress
          );
    callbacks.onFinalize();
    window.setTimeout(() => callbacks.onResult(parsed), 320);
  } catch (caught) {
    callbacks.onError(caught instanceof Error ? caught.message : "Analysis failed.");
  }
}

export function finalizeStages(prev: StageState): StageState {
  const finalized: StageState = { ...prev };
  for (const id of STAGE_ORDER) finalized[id] = "done";
  return finalized;
}

export type GithubCallbacks = {
  onLoading: () => void;
  onResult: (analysis: GithubAnalysis) => void;
  onError: (message: string) => void;
};

export async function executeGithubAnalysis(
  profile: string,
  jobDescriptionText: string,
  callbacks: GithubCallbacks
): Promise<void> {
  callbacks.onLoading();
  try {
    const response = await fetch("/api/github-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile, jobDescriptionText }),
    });
    const payload = await response.json();
    // Treat any { error } payload as a soft failure — the GitHub deep-dive
    // is optional and the route returns 200 + { error } to keep the browser
    // console clean when GitHub rate-limits us.
    if (payload && typeof payload === "object" && typeof payload.error === "string") {
      throw new Error(payload.error);
    }
    if (!response.ok) throw new Error("GitHub analysis failed.");
    callbacks.onResult(githubAnalysisSchema.parse(payload));
  } catch (caught) {
    callbacks.onError(caught instanceof Error ? caught.message : "GitHub analysis failed.");
  }
}
