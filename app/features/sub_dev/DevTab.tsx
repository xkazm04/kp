"use client";

import { useEffect, useMemo, useState } from "react";
import { useLoader } from "@/app/_lib/useLoader";
import { useTasks } from "@/app/features/tasks/TasksProvider";
import { NeedForm } from "./NeedForm";
import { AnalysisView } from "./AnalysisView";
import { LifecycleSection } from "./LifecycleSection";
import { ApprovedCasesSection } from "./ApprovedCasesSection";
import { PostingsSection } from "./PostingsSection";
import { OutboxSection } from "./OutboxSection";
import { MAX_CODEBASES } from "@/app/_lib/devcase-constraints";
import type { ApprovedCase, Design, JdSummary, Lifecycle, OutboxItem, Posting, Result, SelectedJd } from "./DevTypes";

export function DevTab() {
  const { startTask, tasks } = useTasks();
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

  // Each loader tracks its own failure + last-updated so an outage renders an
  // explicit banner/stale pill instead of looking identical to an empty pipeline.
  const { data: approvedCases, state: casesState, reload: loadCases } = useLoader<ApprovedCase[]>(
    "/api/devcase",
    (p) => (p.cases as ApprovedCase[]) ?? [],
    [],
  );
  const { data: postings, state: postingsState, reload: loadPostings } = useLoader<Posting[]>(
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

  // Reload orchestration state as background tasks progress (lifecycle/evaluate update it).
  const lifecycleActive = tasks.some((t) => t.kind === "lifecycle" && (t.status === "running" || t.status === "queued"));
  useEffect(() => {
    loadLifecycles();
    loadPostings();
    loadCases();
    loadOutbox();
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

  const runLifecycle = async () => {
    await fetch("/api/devcase/lifecycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ need: buildNeed(), auto: true }),
    });
    loadLifecycles();
  };

  const approveLifecycle = async (id: string) => {
    await fetch(`/api/devcase/lifecycle/${id}/approve`, { method: "POST" });
    loadLifecycles();
  };

  const publish = async (caseId: string) => {
    await fetch("/api/devcase/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId }),
    });
    loadPostings();
  };

  const source = async (caseId: string) => {
    setSourcing(caseId);
    try {
      const r = await fetch("/api/devcase/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId }),
      });
      const p = await r.json();
      if (r.ok) setSourcedCounts((s) => ({ ...s, [caseId]: p.added }));
    } finally {
      setSourcing(null);
    }
  };

  const needTasks = useMemo(() => tasks.filter((t) => t.kind === "need_analysis"), [tasks]);
  const viewed = useMemo(
    () => needTasks.find((t) => t.id === selectedId) ?? needTasks[0] ?? null,
    [needTasks, selectedId]
  );
  const running = viewed ? viewed.status === "running" || viewed.status === "queued" : false;
  const result = viewed?.status === "succeeded" ? (viewed.result as Result) : null;
  const analysis = result?.analysis ?? {};
  // Multi-repo: `snapshots` is canonical; lift a legacy single `snapshot` into a
  // one-item list so bundles saved before multi-repo render identically.
  const snapshots = result?.snapshots ?? (result?.snapshot ? [result.snapshot] : []);
  const viewedNeed = (viewed?.params as { need?: Record<string, unknown> } | undefined)?.need;

  const designTask = useMemo(() => tasks.find((t) => t.id === designId), [tasks, designId]);
  const designing = designTask ? designTask.status === "running" || designTask.status === "queued" : false;
  const design = designTask?.status === "succeeded" ? (designTask.result as Design) : null;

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
      const r = await fetch("/api/devcase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ need: viewedNeed, analysis: result?.analysis, role: design.role, case: design.case }),
      });
      const p = await r.json();
      if (r.ok) {
        setApprovedId(p.id);
        loadCases();
      }
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="space-y-5">
      <header>
        <p className="text-meta uppercase text-coral">Dev extension</p>
        <h2 className="mt-1 font-serif text-display text-ink">Define the need</h2>
        <p className="mt-1 max-w-2xl text-body text-steel">
          Pick the job description and point us at the real codebases it covers (up to {MAX_CODEBASES}). The
          engine reflects what the JD says you need against what the code <em>actually is</em> — surfacing the
          gaps before we design an assignment. Assume the candidate&apos;s code is LLM-generated; we&apos;ll
          grade judgment, not typing.
        </p>
      </header>

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
          lifecycleActive={lifecycleActive}
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

      <LifecycleSection lifecycles={lifecycles} approveLifecycle={approveLifecycle} state={lifecyclesState} />

      <ApprovedCasesSection
        approvedCases={approvedCases}
        postings={postings}
        publish={publish}
        source={source}
        sourcing={sourcing}
        sourcedCounts={sourcedCounts}
        state={casesState}
      />

      <PostingsSection postings={postings} loadPostings={loadPostings} state={postingsState} />

      <OutboxSection outbox={outbox} state={outboxState} />
    </div>
  );
}
