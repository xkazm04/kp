"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyStageEvent,
  initialStageState,
  type StageState,
} from "@/app/_components/AnalysisProgress";
import type { Analysis, GithubAnalysis } from "@/app/_lib/schemas";
import { isDuplicateCvVariant } from "@/app/_lib/cv-variant";
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
  // Monotonic id stamped on each submit's GitHub run. A fire-and-forget GitHub
  // analysis from a SUPERSEDED submit (e.g. the recruiter edited the profile and
  // resubmitted) must not last-write-win over the current one — its callbacks are
  // ignored unless their captured id is still the latest (idea-8367f051).
  const githubRunIdRef = useRef(0);
  // Aborts the in-flight analyze poll when the user resets/cancels or the tab
  // unmounts — without this, watchAnalysis's loop + interval poll forever and
  // setState on an unmounted component (the segmented control unmounts the tab).
  const abortRef = useRef<AbortController | null>(null);
  // The current server-side task id, so reset/cancel can DELETE (cancel) it.
  const taskIdRef = useRef<string | null>(null);
  // Monotonic id for the MAIN analysis run (mirrors githubRunIdRef): a superseded
  // run's late callbacks are ignored, so a zombie poll that resolves after a
  // Reset/Cancel can't write the stale result back over the cleared form.
  const analysisRunIdRef = useRef(0);

  const [cvFiles, setCvFiles] = useState<File[]>([]);
  // Latest cvFiles + a promise chain — back the serialized, race-free CV intake (addCvFile).
  const cvFilesRef = useRef<File[]>(cvFiles);
  const addCvSeqRef = useRef<Promise<unknown>>(Promise.resolve());
  const [jobDescriptionFile, setJobDescriptionFile] = useState<File | null>(null);
  const [jobDescriptionText, setJobDescriptionText] = useState("");
  const [companyFile, setCompanyFile] = useState<File | null>(null);
  const [companyText, setCompanyText] = useState("");
  const [githubProfile, setGithubProfile] = useState("");

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [githubAnalysis, setGithubAnalysis] = useState<GithubAnalysis | null>(null);
  const [githubStatus, setGithubStatus] = useState<GithubStatus>("idle");
  const [githubError, setGithubError] = useState<string | null>(null);
  const [githubWarning, setGithubWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [stageState, setStageState] = useState<StageState>(initialStageState);

  const { jdLibrary, selectedJdSlug, setSelectedJdSlug, pickJd } =
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

  // Mirror cvFiles into a ref (synced every render) so the serialized intake below can
  // see pending appends across its async hash await, and a promise chain that serializes
  // addCvFile calls.
  cvFilesRef.current = cvFiles;

  function addCvFile(file: File): Promise<void> {
    // Serialize intake: two near-simultaneous drops of the SAME file would otherwise both
    // dedupe-check against the same stale snapshot and both append (the functional setState
    // guards only the count cap, not content identity). Chaining each add means the second
    // sees the first's append (via cvFilesRef, advanced synchronously on append).
    const run = addCvSeqRef.current.then(() => addCvFileInner(file));
    addCvSeqRef.current = run.catch(() => {});
    return run;
  }

  async function addCvFileInner(file: File): Promise<void> {
    const current = cvFilesRef.current;
    if (current.length >= MAX_CV_VARIANTS) return;
    // Same-variant identity is by CONTENT, via the one cvVariantHash helper that
    // the server intake (collectCvFiles) also uses, so the two sides can't
    // disagree on what a duplicate is. The old rule here — name && size match —
    // silently merged two different CVs that shared a filename and byte length;
    // content hashing only merges true byte-for-byte clones.
    let duplicate = false;
    try {
      duplicate = await isDuplicateCvVariant(file, current);
    } catch {
      // Hashing needs crypto.subtle (a secure context). If it's unavailable we
      // must not silently drop the file — add it and let the server, which can
      // always hash, be the authoritative dedupe.
      duplicate = false;
    }
    if (duplicate) return;
    const merged = [...cvFilesRef.current, file];
    if (merged.length > MAX_CV_VARIANTS) return;
    cvFilesRef.current = merged; // advance synchronously so the next queued add sees it
    setCvFiles(merged);
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
    // Supersede any GitHub run still in flight so a late result can't clobber the
    // cleared state (same guard as submit — see githubRunIdRef).
    githubRunIdRef.current += 1;
    // Stop the main analyze run too: abort the poll, cancel the server task, reset
    // the loading flags, and supersede its callbacks — otherwise the orphaned poll
    // resolves and writes the stale result back over the just-cleared form.
    stopActiveRun();
    setCvFiles([]);
    clearJobDescription();
    clearCompany();
    setGithubProfile("");
    setAnalysis(null);
    setGithubAnalysis(null);
    setGithubStatus("idle");
    setGithubError(null);
    setGithubWarning(null);
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

  // Stop the in-flight analyze run cleanly: supersede its callbacks, abort the
  // local poll, and tell the server to cancel the task (DELETE → cancelTask aborts
  // the run and kills its Python child). Shared by reset() and cancel().
  const stopActiveRun = () => {
    analysisRunIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    const id = taskIdRef.current;
    taskIdRef.current = null;
    if (id) void fetch(`/api/tasks/${id}`, { method: "DELETE" }).catch(() => {});
    clearStoredTask();
    setIsLoading(false);
    setIsCompleting(false);
  };

  const buildCallbacks = (runId: number) => {
    const current = () => runId === analysisRunIdRef.current;
    return {
      onProgress: (stage: Parameters<typeof applyStageEvent>[1], status: Parameters<typeof applyStageEvent>[2]) => {
        if (!current()) return;
        setStageState((prev) => applyStageEvent(prev, stage, status));
      },
      onFinalize: () => {
        if (!current()) return;
        setIsCompleting(true);
        setStageState(finalizeStages);
      },
      onResult: (parsed: Analysis) => {
        if (!current()) return;
        setAnalysis(parsed);
        setIsLoading(false);
        setIsCompleting(false);
        clearStoredTask();
      },
      onError: (message: string) => {
        if (!current()) return;
        setError(message);
        setIsLoading(false);
        setIsCompleting(false);
        clearStoredTask();
      },
      onTaskStarted: (id: string) => {
        if (!current()) {
          // Superseded before the task id returned — cancel the orphan now, since
          // nobody else holds its id to DELETE it.
          void fetch(`/api/tasks/${id}`, { method: "DELETE" }).catch(() => {});
          return;
        }
        taskIdRef.current = id;
        try {
          sessionStorage.setItem(ANALYZE_TASK_KEY, id);
        } catch {
          /* ignore */
        }
      },
    };
  };

  // Re-attach to an analyze task that was still running when the page reloaded.
  // Deferred kick-off (0 ms timer): resuming flips the loading flags, and a sync
  // setState in the effect body would cascade a render before the first commit
  // settles. Behavior is unchanged — the resume still starts right away.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(ANALYZE_TASK_KEY);
    } catch {
      /* ignore */
    }
    if (!stored) return;
    const resumeStored = stored;
    const t = window.setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      taskIdRef.current = resumeStored;
      const runId = ++analysisRunIdRef.current;
      setIsLoading(true);
      setIsCompleting(false);
      void resumeAnalysis(resumeStored, buildCallbacks(runId), controller.signal);
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Abort an in-flight analyze run when the tab unmounts (e.g. switching the
  // workspace segmented control), so the poll loop + stage interval don't leak.
  useEffect(() => () => abortRef.current?.abort(), []);

  async function submit() {
    if (cvFiles.length === 0) {
      setError("Select a CV or LinkedIn PDF export first.");
      return;
    }
    // Supersede any GitHub run still in flight: only this submit's callbacks win.
    // Resetting the status to "idle" here (and to "loading" below when we actually
    // launch a run) also prevents a superseded run — whose guarded terminal
    // callbacks we now ignore — from leaving the status stuck on "loading".
    const githubRunId = ++githubRunIdRef.current;
    const isCurrentGithubRun = () => githubRunId === githubRunIdRef.current;

    setIsLoading(true);
    setIsCompleting(false);
    setError(null);
    setAnalysis(null);
    setGithubAnalysis(null);
    setGithubError(null);
    setGithubWarning(null);
    setGithubStatus("idle");
    setStageState(initialStageState());

    if (hasGithub) {
      void executeGithubAnalysis(githubProfile, { jobDescriptionText, jobDescriptionFile }, {
        onLoading: () => {
          if (isCurrentGithubRun()) setGithubStatus("loading");
        },
        onResult: (result) => {
          if (!isCurrentGithubRun()) return; // a newer submit superseded this run
          setGithubAnalysis(result);
          setGithubStatus("done");
        },
        onWarning: (message) => {
          if (!isCurrentGithubRun()) return; // a newer submit superseded this run
          setGithubWarning(message);
        },
        onError: (message) => {
          if (!isCurrentGithubRun()) return; // a newer submit superseded this run
          setGithubError(message);
          // A hard failure replaces any JD-dropped warning — there's no result
          // for the warning to qualify.
          setGithubWarning(null);
          setGithubStatus("error");
        },
      });
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const analysisRunId = ++analysisRunIdRef.current;

    await executeAnalysis(
      {
        cvFiles,
        jobDescriptionFile,
        jobDescriptionText,
        companyFile,
        companyText,
        selectedJdSlug,
      },
      buildCallbacks(analysisRunId),
      controller.signal
    );
  }

  // User-initiated stop of a running scan (the Cancel button in AnalysisProgress).
  // Keeps the inputs so the user can retry; just halts the run and clears progress.
  function cancel() {
    stopActiveRun();
    setStageState(initialStageState());
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
      cancel,
    },
    // `githubLoading` lets the submit button block a resubmit while a GitHub run
    // is still in flight (it can outlive the main analysis), preventing a duplicate
    // full fan-out (idea-8367f051).
    flags: { hasJobDescription, hasCompany, isLoading, isCompleting, githubLoading: githubStatus === "loading" },
    statuses: { cvStatus, jobStatus, companyStatus, githubStatusLabel },
    library: { jdLibrary, selectedJdSlug, setSelectedJdSlug, pickJd },
    result: { analysis, githubAnalysis, githubStatus, githubError, githubWarning, error, stageState },
  };
}
