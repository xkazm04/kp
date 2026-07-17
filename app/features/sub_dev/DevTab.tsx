"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLoader } from "@/app/_lib/useLoader";
import { useTasks, useTaskResult } from "@/app/features/tasks/TasksProvider";
import { NeedForm } from "./NeedForm";
import { AnalysisView } from "./AnalysisView";
import { LifecycleSection } from "./LifecycleSection";
import { CasesTable } from "./CasesTable";
import { CaseDetail } from "./CaseDetail";
import { OutboxTable } from "./OutboxSection";
import { MAX_CODEBASES } from "@/app/_lib/devcase-constraints";
import type { Design, DevCaseDetail, JdSummary, Lifecycle, OutboxItem, Posting, Result, SelectedJd } from "./DevTypes";

// The studio's three workspaces: the case library first (read + operate),
// creation second, comms third. Local state only — the dev tab owns its own
// sub-navigation, the workspace-level ?tab= param stays untouched.
const DEV_VIEWS = [
  { id: "cases", label: "Cases" },
  { id: "define", label: "Define need" },
  { id: "outbox", label: "Outbox" },
] as const;
type DevView = (typeof DEV_VIEWS)[number]["id"];

const VIEW_HEADING: Record<DevView, { title: string; blurb: string }> = {
  cases: {
    title: "Active cases",
    blurb:
      "Every designed assignment in one place — stage, intake and evaluations. Click a case to read the full brief and its internal probe material.",
  },
  define: {
    title: "Define the need",
    blurb:
      `Pick the job description and point us at the real codebases it covers (up to ${MAX_CODEBASES}). The engine reflects what the JD says you need against what the code actually is — surfacing the gaps before we design an assignment. Assume the candidate's code is LLM-generated; we'll grade judgment, not typing.`,
  },
  outbox: {
    title: "Comms outbox",
    blurb:
      "Every message the pipeline sent — intake acknowledgements, promote invites, recruiter outreach, and rejections.",
  },
};

export function DevTab() {
  const { startTask, tasks } = useTasks();
  const [view, setView] = useState<DevView>("cases");
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  // JD-first intake: the saved job description IS the need's metadata (title +
  // stack + responsibilities live in its body); the form only adds codebases +
  // a seniority target on top.
  const [jds, setJds] = useState<JdSummary[]>([]);
  const [jd, setJd] = useState<SelectedJd | null>(null);
  const [jdLoading, setJdLoading] = useState(false);
  const [repoUrls, setRepoUrls] = useState<string[]>([""]);
  const [seniority, setSeniority] = useState("medior");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [designId, setDesignId] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approvedId, setApprovedId] = useState<string | null>(null);
  const [sourcedCounts, setSourcedCounts] = useState<Record<string, number>>({});
  const [sourcing, setSourcing] = useState<string | null>(null);
  // In-flight publish guard: `published` only becomes true after the postings reload,
  // so without this the Publish button stays clickable mid-request and a double-click
  // mints duplicate postings + apply tokens.
  const [publishingCase, setPublishingCase] = useState<string | null>(null);
  // In-flight guard for "Run automated lifecycle": lifecycleActive only flips true once
  // the task appears in the tasks poll, so without this a double-click in the gap fires
  // two lifecycle runs.
  const [runningLifecycle, setRunningLifecycle] = useState(false);
  // The write actions below previously swallowed every error, so a failed publish /
  // approve / source / lifecycle-run looked identical to a click that did nothing.
  const [actionError, setActionError] = useState<string | null>(null);

  // Each loader tracks its own failure + last-updated so an outage renders an
  // explicit banner/stale pill instead of looking identical to an empty pipeline.
  // /api/devcase returns FULL records (role/case/scenario JSON), so the detail
  // reader opens instantly from the already-loaded list — no second fetch.
  const { data: cases, state: casesState, reload: loadCases } = useLoader<DevCaseDetail[]>(
    "/api/devcase",
    (p) => (p.cases as DevCaseDetail[]) ?? [],
    [],
  );
  const { data: postings, reload: loadPostings } = useLoader<Posting[]>(
    "/api/devcase/postings",
    (p) => (p.postings as Posting[]) ?? [],
    [],
  );
  const { data: lifecycles, state: lifecyclesState, reload: loadLifecycles } = useLoader<Lifecycle[]>(
    "/api/devcase/lifecycle",
    (p) => (p.lifecycles as Lifecycle[]) ?? [],
    [],
  );
  const { data: outbox, state: outboxState, reload: loadOutbox } = useLoader<OutboxItem[]>(
    "/api/devcase/comms",
    (p) => (p.outbox as OutboxItem[]) ?? [],
    [],
  );
  useEffect(() => {
    loadCases();
    loadPostings();
    loadLifecycles();
    loadOutbox();
  }, [loadCases, loadPostings, loadLifecycles, loadOutbox]);

  // The saved-JD library backing the picker (same source as the Analyze tab).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/jds")
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (!cancelled && p?.jds) setJds(p.jds as JdSummary[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Picking a JD fetches its full body — that body travels as need.jdText, the
  // primary statement of the need the analyze step extracts metadata from.
  const pickJd = async (slug: string) => {
    if (!slug) {
      setJd(null);
      return;
    }
    setJdLoading(true);
    try {
      const r = await fetch(`/api/jds/${encodeURIComponent(slug)}`);
      if (r.ok) {
        const p = (await r.json()) as SelectedJd;
        setJd({ slug: p.slug, title: p.title, body: p.body });
      }
    } finally {
      setJdLoading(false);
    }
  };

  const setRepoUrl = (index: number, value: string) =>
    setRepoUrls((urls) => urls.map((u, i) => (i === index ? value : u)));
  const addRepo = () => setRepoUrls((urls) => (urls.length < MAX_CODEBASES ? [...urls, ""] : urls));
  const removeRepo = (index: number) =>
    setRepoUrls((urls) => (urls.length > 1 ? urls.filter((_, i) => i !== index) : [""]));

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

  // A selected JD is REQUIRED — the single recorded contract for the need. NeedForm
  // marks the picker `*`, sets aria-invalid while nothing is selected, and disables
  // both Run and Analyze until a JD body has loaded, so buildNeed only ever runs
  // with a real title + jdText. Stack/responsibilities are deliberately empty: the
  // analyze step extracts them from the JD body (the old free-text metadata fields
  // duplicated what every JD already says).
  const buildNeed = () => ({
    title: (jd?.title ?? "").trim(),
    stack: [],
    responsibilities: [],
    codebaseRefs: repoUrls
      .map((u) => u.trim())
      .filter(Boolean)
      .slice(0, MAX_CODEBASES)
      .map((ref) => ({ kind: "github", ref })),
    seniorityTarget: seniority,
    // Intentionally FIXED for now (recorded decision, not a config knob): the Dev
    // case flow only supports engineering roles end-to-end (design + eval backend),
    // so roleFamily is a constant rather than a NeedForm selector like
    // seniorityTarget. Add a selector here and thread the value through if/when
    // other families become real.
    roleFamily: "software_engineering",
    jdSlug: jd?.slug ?? "",
    jdText: jd?.body ?? "",
  });

  // Shared error surfacing for the write actions: surface a failed/non-OK POST as a
  // banner instead of silently no-op'ing. Returns true on success so callers can chain.
  const runAction = async (
    label: string,
    fetcher: () => Promise<Response>,
    onOk?: (body: unknown) => void
  ): Promise<boolean> => {
    setActionError(null);
    try {
      const r = await fetcher();
      const body = await r.json().catch(() => null);
      if (!r.ok) {
        const msg = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : null;
        setActionError(msg ?? `${label} failed. Please try again.`);
        return false;
      }
      onOk?.(body);
      return true;
    } catch {
      setActionError(`${label} failed — the request could not be completed.`);
      return false;
    }
  };

  const runLifecycle = async () => {
    if (runningLifecycle) return; // single-flight: no double-launch in the pre-poll gap
    setRunningLifecycle(true);
    try {
      const ok = await runAction("Run lifecycle", () =>
        fetch("/api/devcase/lifecycle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ need: buildNeed(), auto: true }),
        })
      );
      if (ok) loadLifecycles();
    } finally {
      setRunningLifecycle(false);
    }
  };

  const approveLifecycle = async (id: string) => {
    const ok = await runAction("Approve", () => fetch(`/api/devcase/lifecycle/${id}/approve`, { method: "POST" }));
    if (ok) loadLifecycles();
  };

  const publish = async (caseId: string) => {
    if (publishingCase) return; // single-flight: a double-click can't mint duplicate postings
    setPublishingCase(caseId);
    try {
      const ok = await runAction("Publish", () =>
        fetch("/api/devcase/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caseId }),
        })
      );
      if (ok) loadPostings();
    } finally {
      setPublishingCase(null);
    }
  };

  const source = async (caseId: string) => {
    setSourcing(caseId);
    try {
      await runAction(
        "Source candidates",
        () =>
          fetch("/api/devcase/source", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ caseId }),
          }),
        (body) => {
          const added = body && typeof body === "object" && "added" in body ? Number((body as { added: unknown }).added) : 0;
          setSourcedCounts((s) => ({ ...s, [caseId]: added }));
        }
      );
    } finally {
      setSourcing(null);
    }
  };

  const needTasks = useMemo(() => tasks.filter((t) => t.kind === "need_analysis"), [tasks]);
  const viewed = useMemo(
    () => needTasks.find((t) => t.id === selectedId) ?? needTasks[0] ?? null,
    [needTasks, selectedId]
  );
  // result/params live in the full task record, which the poll omits — fetch the
  // viewed need-analysis task's full record on demand. `awaitingResult` holds the
  // "analyzing" state through the brief fetch after the task succeeds, so the panel
  // never flashes its "did not complete" error between finish and result arrival.
  const { full: viewedFull } = useTaskResult(viewed?.id ?? null);
  const awaitingResult = viewed?.status === "succeeded" && !viewedFull;
  const running = (viewed ? viewed.status === "running" || viewed.status === "queued" : false) || awaitingResult;
  const result = viewed?.status === "succeeded" ? ((viewedFull?.result as Result | undefined) ?? null) : null;
  const analysis = result?.analysis ?? {};
  // Multi-repo: `snapshots` is canonical; lift a legacy single `snapshot` into a
  // one-item list so bundles saved before multi-repo render identically.
  const snapshots = result?.snapshots ?? (result?.snapshot ? [result.snapshot] : []);
  const viewedNeed = (viewedFull?.params as { need?: Record<string, unknown> } | undefined)?.need;

  const { full: designFull, status: designStatus } = useTaskResult(designId);
  const designing = designStatus === "running" || designStatus === "queued" || (designStatus === "succeeded" && !designFull);
  const design = designStatus === "succeeded" ? ((designFull?.result as Design | undefined) ?? null) : null;

  const selectNeed = (id: string) => {
    setSelectedId(id);
    setDesignId(null);
    setApprovedId(null);
  };

  const submit = async () => {
    const t = await startTask("need_analysis", { need: buildNeed() });
    if (t) selectNeed(t.id);
  };

  const startDesign = async () => {
    if (!viewedNeed || !result) return;
    setApprovedId(null);
    const t = await startTask("design_artifacts", { need: viewedNeed, analysis: result.analysis });
    if (t) setDesignId(t.id);
  };

  const approve = async () => {
    if (!design?.role || !design?.case) return;
    setApproving(true);
    try {
      // Route through the shared runAction error surface like every other write on
      // this tab (dev-case-authoring-publishing #2). approve() previously did a bare
      // fetch that only acted `if (r.ok)`, so a probe-gate block (enforceProbeGate
      // returns a structured error + code + verdict) spun and then did nothing — no
      // banner, no explanation, a dead button. Now the server's message lands in the
      // actionError banner.
      await runAction(
        "Approve",
        () =>
          fetch("/api/devcase", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ need: viewedNeed, analysis: result?.analysis, role: design.role, case: design.case }),
          }),
        (body) => {
          setApprovedId((body as { id?: string } | null)?.id ?? null);
          loadCases();
        }
      );
    } finally {
      setApproving(false);
    }
  };

  const selectedCase = selectedCaseId ? cases.find((c) => c.id === selectedCaseId) ?? null : null;
  const heading = VIEW_HEADING[view];

  return (
    <div className="space-y-5">
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

      {/* sub-tab switcher */}
      <div role="tablist" aria-label="Dev studio sections" className="inline-flex rounded-lg border border-stone-200 bg-paper p-0.5">
        {DEV_VIEWS.map((t) => {
          const active = view === t.id;
          const count = t.id === "cases" ? cases.length : t.id === "outbox" ? outbox.length : null;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setView(t.id)}
              className={`focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors ${
                active ? "bg-white text-ink shadow-panel" : "text-steel hover:text-ink"
              }`}
            >
              {t.label}
              {count != null && count > 0 ? (
                <span className={`rounded-full px-1.5 text-micro nums ${active ? "bg-coral/10 text-coral" : "bg-stone-200/70 text-steel"}`}>
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {view === "cases" ? (
        selectedCase ? (
          <CaseDetail
            kase={selectedCase}
            postings={postings}
            onBack={() => setSelectedCaseId(null)}
            publish={publish}
            publishing={publishingCase === selectedCase.id}
            source={source}
            sourcing={sourcing}
            sourcedCounts={sourcedCounts}
            loadPostings={loadPostings}
          />
        ) : (
          <>
            <CasesTable
              cases={cases}
              lifecycles={lifecycles}
              postings={postings}
              state={casesState}
              onOpen={setSelectedCaseId}
              onDefine={() => setView("define")}
            />
            <LifecycleSection lifecycles={lifecycles} postings={postings ?? []} approveLifecycle={approveLifecycle} state={lifecyclesState} onChanged={loadLifecycles} />
          </>
        )
      ) : null}

      {view === "define" ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,360px)_1fr]">
          {/* intake */}
          <NeedForm
            jds={jds}
            jd={jd}
            jdLoading={jdLoading}
            pickJd={pickJd}
            repoUrls={repoUrls}
            setRepoUrl={setRepoUrl}
            addRepo={addRepo}
            removeRepo={removeRepo}
            seniority={seniority}
            setSeniority={setSeniority}
            runLifecycle={runLifecycle}
            lifecycleActive={lifecycleActive || runningLifecycle}
            submit={submit}
            running={running}
            needTasks={needTasks}
            viewed={viewed}
            selectNeed={selectNeed}
          />

          {/* reality reflection */}
          <AnalysisView
            viewed={viewed}
            running={running}
            result={result}
            analysis={analysis}
            snapshots={snapshots}
            design={design}
            designing={designing}
            startDesign={startDesign}
            approve={approve}
            approving={approving}
            approvedId={approvedId}
          />
        </div>
      ) : null}

      {view === "outbox" ? <OutboxTable outbox={outbox} state={outboxState} onResent={loadOutbox} /> : null}
    </div>
  );
}
