"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyStageEvent,
  initialStageState,
  type StageState,
} from "@/app/_components/AnalysisProgress";
import type { Analysis, GithubAnalysis } from "@/app/_lib/schemas";
import {
  MAX_CV_VARIANTS,
  type ColumnStatus,
  type GithubStatus,
} from "./AnalyzeTypes";
import { useAnalyzeJdLibrary } from "./useAnalyzeJdLibrary";
import { executeAnalysis, executeGithubAnalysis, finalizeStages, resumeAnalysis } from "./runAnalysis";

export type AnalyzeFormState = ReturnType<typeof useAnalyzeForm>;

// Survives a page refresh: the active analyze task id is stashed here so the
// view can re-attach to the still-running (or finished) server-side task.
const ANALYZE_TASK_KEY = "kp.analyzeTaskId";

export function useAnalyzeForm() {
  const jobInputRef = useRef<HTMLInputElement>(null);
  const companyInputRef = useRef<HTMLInputElement>(null);

  const [cvFiles, setCvFiles] = useState<File[]>([]);
  const [jobDescriptionFile, setJobDescriptionFile] = useState<File | null>(null);
  const [jobDescriptionText, setJobDescriptionText] = useState("");
  const [companyFile, setCompanyFile] = useState<File | null>(null);
  const [companyText, setCompanyText] = useState("");
  const [githubProfile, setGithubProfile] = useState("");

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [githubAnalysis, setGithubAnalysis] = useState<GithubAnalysis | null>(null);
  const [githubStatus, setGithubStatus] = useState<GithubStatus>("idle");
  const [githubError, setGithubError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [stageState, setStageState] = useState<StageState>(initialStageState);

  const { jdLibrary, selectedJdSlug, setSelectedJdSlug } =
    useAnalyzeJdLibrary(setJobDescriptionText);

  const hasJobDescription = Boolean(jobDescriptionFile || jobDescriptionText.trim());
  const hasCompany = Boolean(companyFile || companyText.trim());
  const hasGithub = Boolean(githubProfile.trim());

  const cvStatus = useMemo<ColumnStatus>(() => {
    if (cvFiles.length === 0) return { tone: "required", label: "Required" };
    if (cvFiles.length === 1) return { tone: "attached", label: cvFiles[0].name };
    return { tone: "attached", label: `${cvFiles.length} variants` };
  }, [cvFiles]);

  const jobStatus: ColumnStatus = hasJobDescription
    ? {
        tone: "attached",
        label: jobDescriptionFile?.name ?? `${jobDescriptionText.trim().length} chars`,
      }
    : { tone: "optional", label: "Optional" };

  const companyStatus: ColumnStatus = hasCompany
    ? { tone: "attached", label: companyFile?.name ?? `${companyText.trim().length} chars` }
    : { tone: "optional", label: "Optional" };

  const githubStatusLabel: ColumnStatus = hasGithub
    ? { tone: "attached", label: githubProfile.trim() }
    : { tone: "optional", label: "Optional" };

  function addCvFile(file: File) {
    setCvFiles((prev) => {
      if (prev.length >= MAX_CV_VARIANTS) return prev;
      if (prev.some((existing) => existing.name === file.name && existing.size === file.size)) {
        return prev;
      }
      return [...prev, file];
    });
  }

  function replaceCvFile(index: number, file: File) {
    setCvFiles((prev) => prev.map((existing, i) => (i === index ? file : existing)));
  }

  function removeCvFile(index: number) {
    setCvFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function clearJobDescription() {
    setJobDescriptionFile(null);
    setJobDescriptionText("");
    setSelectedJdSlug(null);
    if (jobInputRef.current) jobInputRef.current.value = "";
  }

  function clearCompany() {
    setCompanyFile(null);
    setCompanyText("");
    if (companyInputRef.current) companyInputRef.current.value = "";
  }

  function reset() {
    setCvFiles([]);
    clearJobDescription();
    clearCompany();
    setGithubProfile("");
    setAnalysis(null);
    setGithubAnalysis(null);
    setGithubStatus("idle");
    setGithubError(null);
    setError(null);
    setStageState(initialStageState());
  }

  const clearStoredTask = () => {
    try {
      sessionStorage.removeItem(ANALYZE_TASK_KEY);
    } catch {
      /* ignore */
    }
  };

  const buildCallbacks = () => ({
    onProgress: (stage: Parameters<typeof applyStageEvent>[1], status: Parameters<typeof applyStageEvent>[2]) =>
      setStageState((prev) => applyStageEvent(prev, stage, status)),
    onFinalize: () => {
      setIsCompleting(true);
      setStageState(finalizeStages);
    },
    onResult: (parsed: Analysis) => {
      setAnalysis(parsed);
      setIsLoading(false);
      setIsCompleting(false);
      clearStoredTask();
    },
    onError: (message: string) => {
      setError(message);
      setIsLoading(false);
      setIsCompleting(false);
      clearStoredTask();
    },
    onTaskStarted: (id: string) => {
      try {
        sessionStorage.setItem(ANALYZE_TASK_KEY, id);
      } catch {
        /* ignore */
      }
    },
  });

  // Re-attach to an analyze task that was still running when the page reloaded.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(ANALYZE_TASK_KEY);
    } catch {
      /* ignore */
    }
    if (!stored) return;
    setIsLoading(true);
    setIsCompleting(false);
    void resumeAnalysis(stored, buildCallbacks());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    if (cvFiles.length === 0) {
      setError("Select a CV or LinkedIn PDF export first.");
      return;
    }
    setIsLoading(true);
    setIsCompleting(false);
    setError(null);
    setAnalysis(null);
    setGithubAnalysis(null);
    setGithubError(null);
    setStageState(initialStageState());

    if (hasGithub) {
      void executeGithubAnalysis(githubProfile, { jobDescriptionText, jobDescriptionFile }, {
        onLoading: () => setGithubStatus("loading"),
        onResult: (result) => {
          setGithubAnalysis(result);
          setGithubStatus("done");
        },
        onError: (message) => {
          setGithubError(message);
          setGithubStatus("error");
        },
      });
    }

    await executeAnalysis(
      {
        cvFiles,
        jobDescriptionFile,
        jobDescriptionText,
        companyFile,
        companyText,
        selectedJdSlug,
      },
      buildCallbacks()
    );
  }

  return {
    refs: { jobInputRef, companyInputRef },
    inputs: {
      cvFiles,
      jobDescriptionFile,
      jobDescriptionText,
      companyFile,
      companyText,
      githubProfile,
    },
    setters: {
      setJobDescriptionFile,
      setJobDescriptionText,
      setCompanyFile,
      setCompanyText,
      setGithubProfile,
    },
    handlers: {
      addCvFile,
      replaceCvFile,
      removeCvFile,
      clearJobDescription,
      clearCompany,
      reset,
      submit,
    },
    flags: { hasJobDescription, hasCompany, isLoading, isCompleting },
    statuses: { cvStatus, jobStatus, companyStatus, githubStatusLabel },
    library: { jdLibrary, selectedJdSlug, setSelectedJdSlug },
    result: { analysis, githubAnalysis, githubStatus, githubError, error, stageState },
  };
}
