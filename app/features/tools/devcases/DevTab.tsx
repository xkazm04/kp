"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { NOTICE } from "@/app/_components/ui/recipes";
import { useTasks } from "@/app/features/shell/tasks/TasksProvider";
import { useDevTabData } from "./useDevTabData";
import { useDevTabActions } from "./useDevTabActions";
import { useDevTabNeedAnalysis } from "./useDevTabNeedAnalysis";
import { DevTabSwitcher } from "./DevTabSwitcher";
import { DevTabCasesView } from "./DevTabCasesView";
import { DevTabDefineView } from "./DevTabDefineView";
import { VIEW_HEADING, type DevView } from "./DevTabViews";
import { MAX_CODEBASES } from "@/app/_lib/devcase-constraints";
import { useStageLabel } from "./DevLabels";
import { EMPTY_CASE_FILTERS } from "./DevCasesTable.filter";
import {
  LIFECYCLE_WINDOW,
  assignmentsLinkKey,
  consumedSearch,
  parseAssignmentsLink,
  resolveAssignmentsLink,
  type AssignmentsLink,
  type AssignmentsNotice,
} from "./assignmentsDeepLink";

// Tier 3 (docs/design/loading-choreography.md): the comms outbox is a whole sub-tab's
// worth of table + resend wiring that's only ever needed once the recruiter
// switches to it, so it gets its own chunk. The gap is a quiet reserved box.
const OutboxTable = dynamic(() => import("./OutboxSection").then((m) => ({ default: m.OutboxTable })), {
  loading: () => <div className="reveal-quiet min-h-[18rem]" aria-hidden />,
});

export function DevTab() {
  // Named `tCopy`, not `t`: this file already binds `t` to a Task in three
  // callbacks below, and a shadowed translator is a rename waiting to break one.
  const tCopy = useTranslations("devcase");
  // The studio's own copy, including the three sub-tab headings. They were English
  // literals in DevTabViews.ts, rendered UNDER a localized eyebrow — so a Czech reader
  // got a Czech kicker over an English headline, on the surface's own masthead.
  const tStudio = useTranslations("devcase.studio");
  const { startTask, tasks } = useTasks();
  const [view, setView] = useState<DevView>("cases");
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  const {
    jds, jd, jdLoading, pickJd, jdsError, reloadJds,
    repoUrls, setRepoUrl, addRepo, removeRepo,
    seniority, setSeniority,
    cases, casesTruncated, casesState, loadCases,
    caseFacets, caseFilters, setCaseFilters, caseFiltersActive,
    raiseCaseLimit, canLoadMoreCases,
    postings, loadPostings,
    lifecycles, lifecyclesState, loadLifecycles,
    outbox, outboxState, loadOutbox,
    buildNeed,
  } = useDevTabData();

  const {
    runAction,
    runLifecycle, runningLifecycle,
    approveLifecycle,
    publish, publishingCase,
    source, sourcing, sourcedCounts,
    actionError, setActionError,
  } = useDevTabActions({ buildNeed, loadLifecycles, loadPostings });

  const {
    selectNeed,
    needTasks, viewed,
    running, result, analysis, snapshots,
    design, designing,
    submit, startDesign, approve, approving, approvedId,
  } = useDevTabNeedAnalysis({ tasks, startTask, buildNeed, runAction, loadCases });

  // ASSIGNMENTS AS AN ADDRESS (challenge-r03 devcase-workspace/B). ?lifecycle= (the
  // Control Room's Art. 22 gate Review link), ?case= and ?job= (the job page's
  // assignments chip) used to be read by nothing here: view and selection were local
  // state, so a reviewer sent to sign off a gate landed on an unfocused table. The
  // rules are pure in assignmentsDeepLink.ts; this is only the plumbing. An intent is
  // adopted when its key ARRIVES (during render, the useUrlInboxState pattern - no
  // flash of the unfocused tab), held until the list it resolves against has loaded,
  // then applied once; the params are stripped as soon as they are read.
  const tCases = useTranslations("devcase.casesTable");
  const stageLabel = useStageLabel();
  const search = useSearchParams();
  const searchString = search.toString();
  const incomingLink = parseAssignmentsLink(searchString);
  const incomingKey = assignmentsLinkKey(incomingLink);
  const [seenLinkKey, setSeenLinkKey] = useState<string | null>(null);
  const [pendingLink, setPendingLink] = useState<AssignmentsLink | null>(null);
  const [linkNotice, setLinkNotice] = useState<AssignmentsNotice | null>(null);
  const [lifecycleFocus, setLifecycleFocus] = useState<{ id: string; openReview: boolean; nonce: number } | null>(null);
  if (incomingKey !== seenLinkKey) {
    setSeenLinkKey(incomingKey);
    if (incomingLink) {
      setPendingLink(incomingLink);
      setView("cases");
      setLinkNotice(null);
    }
  }
  if (pendingLink) {
    const resolved = resolveAssignmentsLink(pendingLink, {
      lifecycles,
      // A failed lifecycle load keeps the intent pending: "not found" would be a claim
      // the list never established, and the section below already names the failure.
      loaded: lifecyclesState.lastUpdated != null,
    });
    if (!("pending" in resolved)) {
      setPendingLink(null);
      setLinkNotice(resolved.notice ?? null);
      if (resolved.selectedCaseId) {
        // Read by id (GET /api/devcase/[id]): a case past the loaded page opens all the
        // same, and a foreign or deleted id is answered by the reader's coded 404.
        setSelectedCaseId(resolved.selectedCaseId);
      } else if (resolved.focus || resolved.jobFilter) {
        // Both point at the ledger view; an open case reader would hide them.
        setSelectedCaseId(null);
      }
      if (resolved.jobFilter) setCaseFilters({ ...EMPTY_CASE_FILTERS, job: resolved.jobFilter });
      if (resolved.focus) {
        setLifecycleFocus((prev) => ({
          id: resolved.focus as string,
          openReview: resolved.openReview === resolved.focus,
          nonce: (prev?.nonce ?? 0) + 1,
        }));
      }
    }
  }
  useEffect(() => {
    // One-shot, like ?arm= (useDecisionsQueue): a raw history write, not a router
    // navigation - the intent is already captured in state above, so erasing the params
    // must not re-render or re-fetch anything. Keyed on the whole query, not only the
    // intent: the shell's own ?tab= cleanup can re-write the query from a snapshot that
    // still carried these params, and they must not survive that either.
    if (incomingKey == null) return;
    const qs = consumedSearch(window.location.search);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
  }, [incomingKey, searchString]);

  const lifecycleActive = tasks.some((t) => t.kind === "lifecycle" && (t.status === "running" || t.status === "queued"));
  // 56a20eb2 — reload ONLY the lists the just-finished task kind actually touched,
  // and only when a task transitions to terminal — not the whole studio on every
  // poll tick. Previously the [tasks] effect re-fetched cases + postings +
  // lifecycles + outbox on every array change, so a long cohort evaluation
  // reflowed the entire tab on each row's progress. A ref of already-handled task
  // ids makes each completion fire its scoped reload exactly once.
  const reloadedTasks = useRef<Set<string>>(new Set());
  useEffect(() => {
    const done = tasks.filter(
      (t) => (t.status === "succeeded" || t.status === "failed") && !reloadedTasks.current.has(t.id)
    );
    if (done.length === 0) return;
    const kinds = new Set(done.map((t) => t.kind));
    done.forEach((t) => reloadedTasks.current.add(t.id));
    // evaluate persists the score onto its submission → only the postings list.
    if (kinds.has("evaluate_submission")) loadPostings();
    // a lifecycle step can analyze/design/approve/publish/comm → its own lists.
    if (kinds.has("lifecycle")) {
      loadLifecycles();
      loadCases();
      loadPostings();
      loadOutbox();
    }
    // need-analysis updates the lifecycle it belongs to.
    if (kinds.has("need_analysis")) loadLifecycles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  const heading = VIEW_HEADING[view];
  // Tier 1: cases is the tab's primary, always-loaded-first section — its first
  // load gates aria-busy on the whole tab. A later refresh (or switching to
  // define/outbox, which don't depend on it) never re-triggers this.
  const firstLoad = casesState.lastUpdated == null && !casesState.failed;

  return (
    <div className="stagger-children space-y-5" aria-busy={firstLoad}>
      <header>
        {/* ONE THREAD (gap 7) — this eyebrow read "Dev extension", hardcoded in
            English, above a tab the sidebar calls Assignments. It named the module
            after the engineering team that built it, in the one place a reader looks
            to find out what surface they are on. */}
        <p className="text-meta uppercase text-coral">{tCopy("eyebrow")}</p>
        <h2 className="mt-1 font-serif text-display text-ink">{tStudio(heading.titleKey)}</h2>
        {/* `max` is passed for every view; only the define blurb names it, and an unused
            value is inert. The number is the SHARED cap the form enforces. */}
        <p className="mt-1 max-w-2xl text-body text-steel">{tStudio(heading.blurbKey, { max: MAX_CODEBASES })}</p>
      </header>

      {actionError ? (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-md border border-coral/30 bg-coral/10 px-3 py-2 text-sm text-coral"
        >
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="focus-ring shrink-0 font-semibold hover:underline">
            {tCopy("studio.dismiss")}
          </button>
        </div>
      ) : null}

      {linkNotice ? (
        <div role="status" className={`${NOTICE("info")} flex items-start justify-between gap-3 px-3 py-2 text-sm`}>
          <span>
            {linkNotice.kind === "gateDecided"
              ? tCases("linkGateDecided", { stage: stageLabel(linkNotice.stage) })
              : linkNotice.kind === "lifecycleOutsideWindow"
                ? tCases("linkLifecycleOutsideWindow", { count: LIFECYCLE_WINDOW })
                : tCases("linkLifecycleMissing")}
          </span>
          <button type="button" onClick={() => setLinkNotice(null)} className="focus-ring shrink-0 font-semibold hover:underline">
            {tCopy("studio.dismiss")}
          </button>
        </div>
      ) : null}

      <DevTabSwitcher view={view} onChange={setView} casesCount={cases.length} outboxCount={outbox.length} />

      {view === "cases" ? (
        <DevTabCasesView
          cases={cases}
          casesTruncated={casesTruncated}
          caseFacets={caseFacets}
          caseFilters={caseFilters}
          caseFiltersActive={caseFiltersActive}
          onCaseFiltersChange={setCaseFilters}
          onLoadMoreCases={canLoadMoreCases ? raiseCaseLimit : undefined}
          casesState={casesState}
          lifecycles={lifecycles}
          lifecyclesState={lifecyclesState}
          postings={postings}
          selectedCaseId={selectedCaseId}
          onOpenCase={setSelectedCaseId}
          onBack={() => setSelectedCaseId(null)}
          onDefine={() => setView("define")}
          publish={publish}
          publishingCase={publishingCase}
          source={source}
          sourcing={sourcing}
          sourcedCounts={sourcedCounts}
          loadPostings={loadPostings}
          approveLifecycle={approveLifecycle}
          loadLifecycles={loadLifecycles}
          lifecycleFocus={lifecycleFocus}
        />
      ) : null}

      {view === "define" ? (
        <DevTabDefineView
          needForm={{
            jds,
            jd,
            jdLoading,
            pickJd,
            jdsError,
            reloadJds,
            repoUrls,
            setRepoUrl,
            addRepo,
            removeRepo,
            seniority,
            setSeniority,
            runLifecycle,
            lifecycleActive: lifecycleActive || runningLifecycle,
            submit,
            running,
            needTasks,
            viewed,
            selectNeed,
          }}
          analysisView={{
            viewed,
            running,
            result,
            analysis,
            snapshots,
            design,
            designing,
            startDesign,
            approve,
            approving,
            approvedId,
          }}
        />
      ) : null}

      {view === "outbox" ? <OutboxTable outbox={outbox} state={outboxState} onResent={loadOutbox} /> : null}
    </div>
  );
}
