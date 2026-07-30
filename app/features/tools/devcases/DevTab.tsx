"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useTasks } from "@/app/features/shell/tasks/TasksProvider";
import { useDevTabData } from "./useDevTabData";
import { useDevTabActions } from "./useDevTabActions";
import { useDevTabNeedAnalysis } from "./useDevTabNeedAnalysis";
import { DevTabSwitcher } from "./DevTabSwitcher";
import { DevTabCasesView } from "./DevTabCasesView";
import { DevTabDefineView } from "./DevTabDefineView";
import { VIEW_HEADING, type DevView } from "./DevTabViews";

// Tier 3 (docs/design/loading-choreography.md): the comms outbox is a whole sub-tab's
// worth of table + resend wiring that's only ever needed once the recruiter
// switches to it, so it gets its own chunk. The gap is a quiet reserved box.
const OutboxTable = dynamic(() => import("./OutboxSection").then((m) => ({ default: m.OutboxTable })), {
  loading: () => <div className="reveal-quiet min-h-[18rem]" aria-hidden />,
});

export function DevTab() {
  const { startTask, tasks } = useTasks();
  const [view, setView] = useState<DevView>("cases");
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  const {
    jds, jd, jdLoading, pickJd,
    repoUrls, setRepoUrl, addRepo, removeRepo,
    seniority, setSeniority,
    cases, casesState, loadCases,
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

  const selectedCase = selectedCaseId ? cases.find((c) => c.id === selectedCaseId) ?? null : null;
  const heading = VIEW_HEADING[view];
  // Tier 1: cases is the tab's primary, always-loaded-first section — its first
  // load gates aria-busy on the whole tab. A later refresh (or switching to
  // define/outbox, which don't depend on it) never re-triggers this.
  const firstLoad = casesState.lastUpdated == null && !casesState.failed;

  return (
    <div className="stagger-children space-y-5" aria-busy={firstLoad}>
      <header>
        <p className="text-meta uppercase text-coral">Dev extension</p>
        <h2 className="mt-1 font-serif text-display text-ink">{heading.title}</h2>
        <p className="mt-1 max-w-2xl text-body text-steel">{heading.blurb}</p>
      </header>

      {actionError ? (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-md border border-coral/30 bg-coral/10 px-3 py-2 text-sm text-coral"
        >
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="focus-ring shrink-0 font-semibold hover:underline">
            Dismiss
          </button>
        </div>
      ) : null}

      <DevTabSwitcher view={view} onChange={setView} casesCount={cases.length} outboxCount={outbox.length} />

      {view === "cases" ? (
        <DevTabCasesView
          cases={cases}
          casesState={casesState}
          lifecycles={lifecycles}
          lifecyclesState={lifecyclesState}
          postings={postings}
          selectedCase={selectedCase}
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
        />
      ) : null}

      {view === "define" ? (
        <DevTabDefineView
          needForm={{
            jds,
            jd,
            jdLoading,
            pickJd,
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
