"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { isLocale } from "@/i18n/locales";
import {
  applyStageEvent,
  initialStageState,
  type StageState,
} from "@/app/_components/AnalysisProgress";
import { githubAnalysisSchema, type Analysis, type GithubAnalysis } from "@/app/_lib/schemas";
import { useGithubErrorMessage } from "@/app/_lib/use-github-error";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import {
  type AnalyzeErrorInfo,
  type ColumnStatus,
  type GithubStatus,
} from "./AnalyzeTypes";
import { useAnalyzeJdLibrary } from "./useAnalyzeJdLibrary";
import { useAnalyzeCvFiles } from "./useAnalyzeCvFiles";
import { executeAnalysis, executeGithubAnalysis, finalizeStages, resumeAnalysis } from "./analyzeRunAnalysis";
import { resolveAnalyzeErrorText, type VariantProgress } from "./AnalyzeApi";
import { githubStatusAfterCancel, shouldRunGithubDeepDive } from "./analyzeGithubRunPolicy";

export type AnalyzeFormState = ReturnType<typeof useAnalyzeForm>;

// Survives a page refresh: the active analyze task id is stashed here so the
// view can re-attach to the still-running (or finished) server-side task.
const ANALYZE_TASK_KEY = "kp.analyzeTaskId";

// Typed-but-not-yet-run inputs. The Workspace unmounts this tab on every sidebar
// switch, so without this a pasted 5,000-word JD is gone the moment the user
// hops to Pipeline to check a name. Text inputs only — File objects can't be
// stashed in sessionStorage (attachments must be re-added after a switch).
const ANALYZE_DRAFT_KEY = "kp.analyzeDraft";
type AnalyzeDraft = { jd?: string; company?: string; github?: string };

// A message no catalog will ever produce, used as the "this code is unknown"
// signal from resolvers whose only failure mode is silently returning a fallback.
const UNKNOWN_CODE = "__kp_unknown_code__";
const nullIfUnknown = (text: string): string | null => (text === UNKNOWN_CODE ? null : text);

export function useAnalyzeForm() {
  const t = useTranslations("analyze");
  // The GitHub deep-dive publishes its own failure codes (results.github.errors.*).
  const ghErrMsg = useGithubErrorMessage();
  // The app-wide `errors` catalog: /api/analyze's refusals (UPLOAD_*, ANALYZE_*,
  // TOO_MANY_REQUESTS, the billing quota code) live there, not in the deep-dive's
  // own namespace — so a 413 no longer resolves to the generic failure line.
  const apiErrMsg = useErrorMessage();
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
  // …and the matching AbortController. The run id only made a superseded run's
  // callbacks *ignored*; the request itself (the GitHub route plus its optional
  // extract-text hop) kept running to completion, so a recruiter who reset the
  // form or hit Retry twice still paid for every abandoned deep-dive. Bumping the
  // id and aborting the controller are one action — supersedeGithubRun below.
  const githubAbortRef = useRef<AbortController | null>(null);

  // Supersede whatever GitHub deep-dive is in flight: its late callbacks are
  // ignored (the id moved) AND its network work stops (the signal aborts).
  const supersedeGithubRun = useCallback(() => {
    githubRunIdRef.current += 1;
    githubAbortRef.current?.abort();
    githubAbortRef.current = null;
  }, []);

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

  const { cvFiles, addCvFile, replaceCvFile, removeCvFile, clearCvFiles, syncCvFilesRef } = useAnalyzeCvFiles();
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
  // #5 — the server's REAL per-variant completion for a multi-CV comparison
  // (null until the poll reports it); drives the honest progress bar.
  const [variantProgress, setVariantProgress] = useState<VariantProgress | null>(null);

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

  // Mirror cvFiles into useAnalyzeCvFiles' internal ref so its serialized intake sees
  // pending appends across its async hash await. Synced in an effect (post-commit) to
  // avoid mutating a ref during render; the hook's addCvFileInner also advances it
  // synchronously on append so a queued add sees the prior add before the next render.
  useEffect(() => {
    syncCvFilesRef(cvFiles);
  }, [cvFiles, syncCvFilesRef]);

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
    // cleared state (same guard as submit — see githubRunIdRef) AND stop its
    // network work, so a reset does not leave a deep-dive running for nobody.
    supersedeGithubRun();
    // Stop the main analyze run too: abort the poll, cancel the server task, reset
    // the loading flags, and supersede its callbacks — otherwise the orphaned poll
    // resolves and writes the stale result back over the just-cleared form.
    stopActiveRun();
    clearCvFiles();
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
    setVariantProgress(null);
    // Drop the persisted draft NOW — the debounced writer would flush the removal
    // 300 ms later, and a reset-then-switch inside that window would cancel it,
    // resurrecting the cleared inputs on the next visit.
    try {
      sessionStorage.removeItem(ANALYZE_DRAFT_KEY);
    } catch {
      /* ignore */
    }
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
    if (id) {
      void fetch(`/api/tasks/${id}`, { method: "DELETE" })
        .then((r) => {
          // A cancel that the server refused leaves a Python child still burning
          // an engine call while this UI shows an idle form — the one state in
          // which "nothing happened" is a lie. Say what is actually true and point
          // at the indicator that still tracks it.
          if (!r.ok) setError(t("cancelFailed"));
        })
        .catch(() => setError(t("cancelFailed")));
    }
    clearStoredTask();
    setIsLoading(false);
    setIsCompleting(false);
  };

  // Resolve a run's localizable failure/notice descriptor to display text. Engine
  // or server-owned English (serverText) is preferred verbatim — the honest
  // "shown in English" disclosure on this operator surface — otherwise the stable
  // code maps to the localized `analyze` catalog (falling back to the generic
  // failure line for an unknown code). Single-sourced so every onError/onWarning
  // resolves identically.
  const resolveAnalyzeMessage = (info: AnalyzeErrorInfo): string =>
    resolveAnalyzeErrorText(info, {
      // Each channel answers null for a code it does not know, so the pure
      // resolver can keep walking. A sentinel fallback is how "unknown" is
      // detected — both hooks resolve to their fallback rather than reporting it.
      appCode: (code) => nullIfUnknown(apiErrMsg({ code }, UNKNOWN_CODE)),
      githubCode: (code) => nullIfUnknown(ghErrMsg({ code }, UNKNOWN_CODE)),
      analyzeCode: (code) => (t.has(code as Parameters<typeof t>[0]) ? t(code as Parameters<typeof t>[0]) : null),
      retryAfter: (seconds) => t("errRateLimitedRetry", { seconds }),
      generic: t("errFailed"),
    });

  const buildCallbacks = (runId: number) => {
    const current = () => runId === analysisRunIdRef.current;
    return {
      onProgress: (stage: Parameters<typeof applyStageEvent>[1], status: Parameters<typeof applyStageEvent>[2]) => {
        if (!current()) return;
        setStageState((prev) => applyStageEvent(prev, stage, status));
      },
      // #5 — record the server's genuine per-variant progress for the bar.
      onVariantProgress: (p: VariantProgress) => {
        if (!current()) return;
        setVariantProgress(p);
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
      onError: (error: AnalyzeErrorInfo) => {
        if (!current()) return;
        setError(resolveAnalyzeMessage(error));
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

  // Restore the typed draft on mount (post-hydration, so SSR markup matches the
  // empty initial state). Only fills fields that are still empty — a saved-JD
  // pick or prop-seeded value from this mount always wins over the stale draft.
  useEffect(() => {
    let draft: AnalyzeDraft | null = null;
    try {
      const raw = sessionStorage.getItem(ANALYZE_DRAFT_KEY);
      draft = raw ? (JSON.parse(raw) as AnalyzeDraft) : null;
    } catch {
      /* ignore */
    }
    if (!draft) return;
    const { jd, company, github } = draft;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount restore from sessionStorage; can't be an initializer without an SSR hydration mismatch
    if (jd) setJobDescriptionText((prev) => prev || jd);
    if (company) setCompanyText((prev) => prev || company);
    if (github) setGithubProfile((prev) => prev || github);
  }, []);

  // Persist the draft (debounced) so it survives the tab unmount. An all-empty
  // draft removes the key instead — reset()/clear leave no stale residue behind.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        if (!jobDescriptionText && !companyText && !githubProfile) {
          sessionStorage.removeItem(ANALYZE_DRAFT_KEY);
        } else {
          sessionStorage.setItem(
            ANALYZE_DRAFT_KEY,
            JSON.stringify({ jd: jobDescriptionText, company: companyText, github: githubProfile } satisfies AnalyzeDraft)
          );
        }
      } catch {
        /* ignore */
      }
    }, 300);
    return () => clearTimeout(id);
  }, [jobDescriptionText, companyText, githubProfile]);

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
  // The GitHub deep-dive is aborted here too: it outlives the main run by design,
  // so an unmount mid-deep-dive used to leave a request (and its extract-text
  // subprocess hop) running against a surface that no longer exists. Aborting also
  // clears the 320 ms result-delivery timer on the main run (scheduleResultDelivery).
  useEffect(
    () => () => {
      abortRef.current?.abort();
      githubAbortRef.current?.abort();
    },
    []
  );

  // One GitHub deep-dive launch — used by submit AND by the panel's "Retry
  // GitHub analysis" (GH5), so a transient rate-limit failure can be retried
  // alone without re-running the whole CV pipeline. Mints a fresh run id
  // (superseding any in-flight deep-dive) and clears the result state; the
  // guarded callbacks ignore anything a superseded run still emits.
  function launchGithubRun() {
    // #3 — in blind mode the deep-dive is suppressed: it would render the
    // candidate's real GitHub identity beside the blind-scored CV, defeating the
    // anti-bias promise. The rule lives in one pure predicate (githubRunPolicy),
    // enforced at this single launch site (submit AND retry both route here).
    if (!shouldRunGithubDeepDive({ hasGithub, blind })) return;
    // Supersede + abort whatever is already in flight before minting this run's
    // id, so a double-click on Retry does not leave the first request running.
    supersedeGithubRun();
    const githubRunId = githubRunIdRef.current;
    const isCurrentGithubRun = () => githubRunId === githubRunIdRef.current;
    const controller = new AbortController();
    githubAbortRef.current = controller;
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
      onWarning: (warning: AnalyzeErrorInfo) => {
        if (!isCurrentGithubRun()) return; // a newer run superseded this one
        setGithubWarning(resolveAnalyzeMessage(warning));
      },
      onError: (error: AnalyzeErrorInfo) => {
        if (!isCurrentGithubRun()) return; // a newer run superseded this one
        setGithubError(resolveAnalyzeMessage(error));
        // A hard failure replaces any JD-dropped warning — there's no result
        // for the warning to qualify.
        setGithubWarning(null);
        setGithubStatus("error");
      },
    }, controller.signal);
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
    // #3 — blind mode suppresses the GitHub deep-dive (it would reveal the
    // identity blind screening redacts). A blind submit carrying only a GitHub
    // handle and no CV therefore has nothing to run — say so instead of a silent
    // no-op. (bug-ui-scan-2026-07-09 cv-analysis-workspace #3)
    if (githubOnly && blind) {
      setError(t("blindGithubOnly"));
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
    supersedeGithubRun();

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
    setVariantProgress(null);

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
    // abandoned call finally resolves. supersedeGithubRun also ABORTS it, so the
    // cancel actually stops the spend instead of only ignoring the answer.
    supersedeGithubRun();
    // …but ONLY a still-loading deep-dive needs that unsticking. The deep-dive runs in
    // parallel and usually finishes first, so at cancel time it may already hold a
    // delivered result ("done") or a retryable failure ("error"). Blanking those to
    // "idle" hid the GitHub panel entirely (AnalyzeTab gates it on `!== "idle"`),
    // erasing a deep-dive the recruiter was reading and had already paid for.
    // Cancelling the CV scan is not a reset — reset() is what clears everything.
    setGithubStatus(githubStatusAfterCancel);
    stopActiveRun();
    setStageState(initialStageState());
    setVariantProgress(null);
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
    result: { analysis, githubAnalysis, githubStatus, githubError, githubWarning, error, stageState, variantProgress },
  };
}
