"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { isLocale } from "@/i18n/locales";
import {
  applyStageEvent,
  initialStageState,
  type StageState,
} from "@/app/_components/AnalysisProgress";
import { githubAnalysisSchema, type Analysis, type GithubAnalysis } from "@/app/_lib/schemas";
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
  const t = useTranslations("analyze");
  // CV3 — the report-narrative language for this run, defaulting to the active
  // locale; threaded into the submit FormData so the route can override the
  // cookie per run.
  const appLocale = useLocale();
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
  const [reportLang, setReportLang] = useState<string>(isLocale(appLocale) ? appLocale : "en");
  // b8d711c4 — blind screening: redact identity from the CV before scoring (opt-in).
  const [blind, setBlind] = useState(false);

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [githubAnalysis, setGithubAnalysis] = useState<GithubAnalysis | null>(null);
  const [githubStatus, setGithubStatus] = useState<GithubStatus>("idle");
  const [githubError, setGithubError] = useState<string | null>(null);
  const [githubWarning, setGithubWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [stageState, setStageState] = useState<StageState>(initialStageState);

  const { jdLibrary, selectedJdSlug, setSelectedJdSlug, pickJd, jdLoading, jdLoadFailed } =
    useAnalyzeJdLibrary(setJobDescriptionText);

  const hasJobDescription = Boolean(jobDescriptionFile || jobDescriptionText.trim());
  const hasCompany = Boolean(companyFile || companyText.trim());
  const hasGithub = Boolean(githubProfile.trim());

  const cvStatus = useMemo<ColumnStatus>(() => {
    if (cvFiles.length === 0) return { tone: "required", label: t("required") };
    if (cvFiles.length === 1) return { tone: "attached", label: cvFiles[0].name };
    return { tone: "attached", label: t("cvVariants", { count: cvFiles.length }) };
  }, [cvFiles, t]);

  const jobStatus: ColumnStatus = hasJobDescription
    ? {
        tone: "attached",
        label: jobDescriptionFile?.name ?? t("charsCount", { count: jobDescriptionText.trim().length }),
      }
    : { tone: "optional", label: t("optional") };

  const companyStatus: ColumnStatus = hasCompany
    ? { tone: "attached", label: companyFile?.name ?? t("charsCount", { count: companyText.trim().length }) }
    : { tone: "optional", label: t("optional") };

  const githubStatusLabel: ColumnStatus = hasGithub
    ? { tone: "attached", label: githubProfile.trim() }
    : { tone: "optional", label: t("optional") };

  // Mirror cvFiles into a ref so the serialized intake below sees pending appends across
  // its async hash await. Synced in an effect (post-commit) to avoid mutating a ref during
  // render; addCvFileInner also advances it synchronously on append so a queued add sees
  // the prior add before the next render lands.
  useEffect(() => {
    cvFilesRef.current = cvFiles;
  }, [cvFiles]);

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

  // True once this mount re-attached to a server task after a refresh — gates
  // the GitHub-restore effect below (a fresh submit never needs the restore).
  const resumedRef = useRef(false);

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
      resumedRef.current = true;
      setIsLoading(true);
      setIsCompleting(false);
      void resumeAnalysis(resumeStored, buildCallbacks(runId), controller.signal);
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // GH1 — persist the GitHub deep-dive onto the saved analysis row once BOTH
  // the save receipt (analysis.persistence.slug) and a done GitHub result
  // exist. Completion order varies (the deep-dive can outlive the main run and
  // vice versa), so this watches both. Per-slug guard so re-renders can't
  // re-PATCH; cleared on failure so a later pass may retry. Best-effort: the
  // live view already shows the result — only the saved report misses it.
  const githubPersistedRef = useRef<string | null>(null);
  useEffect(() => {
    const slug = analysis?.persistence?.slug;
    if (!slug || githubStatus !== "done" || !githubAnalysis) return;
    if (githubPersistedRef.current === slug) return;
    githubPersistedRef.current = slug;
    void fetch(`/api/analyses/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ githubAnalysis }),
    }).catch(() => {
      if (githubPersistedRef.current === slug) githubPersistedRef.current = null;
    });
  }, [analysis, githubAnalysis, githubStatus]);

  // GH1 — the deep-dive runs client-side, so a page refresh loses it even
  // though the resumed server task restores the main analysis. Once the
  // resumed analysis lands with its save receipt, restore the persisted
  // deep-dive from the saved row (written by the pre-refresh session's PATCH).
  useEffect(() => {
    if (!resumedRef.current) return;
    const slug = analysis?.persistence?.slug;
    if (!slug || githubStatus !== "idle" || githubAnalysis) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/analyses/${encodeURIComponent(slug)}`);
        if (!r.ok || cancelled) return;
        const payload = (await r.json()) as { githubAnalysis?: unknown };
        if (cancelled || !payload.githubAnalysis) return;
        const parsed = githubAnalysisSchema.safeParse(payload.githubAnalysis);
        if (parsed.success && !cancelled) {
          githubPersistedRef.current = slug; // already persisted — don't re-PATCH
          setGithubAnalysis(parsed.data);
          setGithubStatus("done");
        }
      } catch {
        /* best-effort restore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [analysis, githubAnalysis, githubStatus]);

  // Abort an in-flight analyze run when the tab unmounts (e.g. switching the
  // workspace segmented control), so the poll loop + stage interval don't leak.
  useEffect(() => () => abortRef.current?.abort(), []);

  // One GitHub deep-dive launch — used by submit AND by the panel's "Retry
  // GitHub analysis" (GH5), so a transient rate-limit failure can be retried
  // alone without re-running the whole CV pipeline. Mints a fresh run id
  // (superseding any in-flight deep-dive) and clears the result state; the
  // guarded callbacks ignore anything a superseded run still emits.
  function launchGithubRun() {
    if (!hasGithub) return;
    const githubRunId = ++githubRunIdRef.current;
    const isCurrentGithubRun = () => githubRunId === githubRunIdRef.current;
    setGithubAnalysis(null);
    setGithubError(null);
    setGithubWarning(null);
    void executeGithubAnalysis(githubProfile, { jobDescriptionText, jobDescriptionFile }, {
      onLoading: () => {
        if (isCurrentGithubRun()) setGithubStatus("loading");
      },
      onResult: (result) => {
        if (!isCurrentGithubRun()) return; // a newer run superseded this one
        setGithubAnalysis(result);
        setGithubStatus("done");
      },
      onWarning: (message) => {
        if (!isCurrentGithubRun()) return; // a newer run superseded this one
        setGithubWarning(message);
      },
      onError: (message) => {
        if (!isCurrentGithubRun()) return; // a newer run superseded this one
        setGithubError(message);
        // A hard failure replaces any JD-dropped warning — there's no result
        // for the warning to qualify.
        setGithubWarning(null);
        setGithubStatus("error");
      },
    });
  }

  async function submit() {
    // GH3 — a GitHub profile alone is a valid run: the deep-dive route needs
    // nothing but the handle (+ optional JD), so a recruiter holding just a
    // sourcing lead's username isn't forced to fabricate a CV upload. Only the
    // empty form is rejected.
    const githubOnly = cvFiles.length === 0;
    if (githubOnly && !hasGithub) {
      setError(t("selectCvFirst"));
      return;
    }
    // Belt-and-suspenders for the saved-JD pick: a recorded slug with no JD body
    // means the body fetch failed (the hook normally detaches the slug on failure,
    // but a regression here would persist a JD-blind score tagged as a
    // role-specific match). Block instead of posting.
    if (selectedJdSlug && !hasJobDescription) {
      setError(t("jdLoadFailed"));
      return;
    }
    // Supersede any GitHub run still in flight even when this submit launches
    // none (hasGithub false): a stale run's guarded terminal callbacks must not
    // land on the fresh form. Resetting the status to "idle" below also keeps a
    // superseded run from leaving the status stuck on "loading".
    githubRunIdRef.current += 1;

    setError(null);
    setAnalysis(null);
    setGithubAnalysis(null);
    setGithubError(null);
    setGithubWarning(null);
    setGithubStatus("idle");

    if (hasGithub) launchGithubRun();

    // GitHub-only run: the deep-dive above is the whole job — no server task,
    // no main-analysis loading flags or stage strip.
    if (githubOnly) return;

    setIsLoading(true);
    setIsCompleting(false);
    setStageState(initialStageState());

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
        reportLang,
        blind,
      },
      buildCallbacks(analysisRunId),
      controller.signal
    );
  }

  // User-initiated stop of a running scan (the Cancel button in AnalysisProgress).
  // Keeps the inputs so the user can retry; just halts the run and clears progress.
  function cancel() {
    // Supersede a GitHub deep-dive still in flight too (it can outlive the main analysis).
    // stopActiveRun only halts the MAIN poll; without this the orphaned GitHub run keeps
    // going, its guarded callbacks still fire on the cancelled form, and githubStatus stays
    // "loading" — which keeps the Analyze button disabled (githubLoading) until the
    // abandoned call finally resolves. Mirrors reset()'s GitHub handling.
    githubRunIdRef.current += 1;
    setGithubStatus("idle");
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
      reportLang,
      blind,
    },
    setters: {
      setJobDescriptionFile,
      setJobDescriptionText,
      setCompanyFile,
      setCompanyText,
      setGithubProfile,
      setReportLang,
      setBlind,
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
      // GH5 — re-fire the deep-dive alone from the panel's error state.
      retryGithub: launchGithubRun,
    },
    // `githubLoading` lets the submit button block a resubmit while a GitHub run
    // is still in flight (it can outlive the main analysis), preventing a duplicate
    // full fan-out (idea-8367f051).
    flags: { hasJobDescription, hasCompany, hasGithub, isLoading, isCompleting, githubLoading: githubStatus === "loading", jdLoading },
    statuses: { cvStatus, jobStatus, companyStatus, githubStatusLabel },
    library: { jdLibrary, selectedJdSlug, setSelectedJdSlug, pickJd, jdLoadFailed },
    result: { analysis, githubAnalysis, githubStatus, githubError, githubWarning, error, stageState },
  };
}
