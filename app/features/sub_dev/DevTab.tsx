"use client";

import { useEffect, useMemo, useState } from "react";
import { useTasks } from "@/app/features/tasks/TasksProvider";
import { NeedForm } from "./NeedForm";
import { AnalysisView } from "./AnalysisView";
import { LifecycleSection } from "./LifecycleSection";
import { ApprovedCasesSection } from "./ApprovedCasesSection";
import { PostingsSection } from "./PostingsSection";
import { OutboxSection } from "./OutboxSection";
import type { ApprovedCase, Design, Lifecycle, OutboxItem, Posting, Result } from "./DevTypes";

export function DevTab() {
  const { startTask, tasks } = useTasks();
  const [title, setTitle] = useState("");
  const [stackStr, setStackStr] = useState("");
  const [respStr, setRespStr] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [seniority, setSeniority] = useState("medior");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [designId, setDesignId] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approvedId, setApprovedId] = useState<string | null>(null);
  const [approvedCases, setApprovedCases] = useState<ApprovedCase[]>([]);
  const [postings, setPostings] = useState<Posting[]>([]);
  const [lifecycles, setLifecycles] = useState<Lifecycle[]>([]);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [sourcedCounts, setSourcedCounts] = useState<Record<string, number>>({});
  const [sourcing, setSourcing] = useState<string | null>(null);

  const loadCases = () =>
    fetch("/api/devcase")
      .then((r) => r.json())
      .then((p) => setApprovedCases((p.cases as ApprovedCase[]) ?? []))
      .catch(() => {});
  const loadPostings = () =>
    fetch("/api/devcase/postings")
      .then((r) => r.json())
      .then((p) => setPostings((p.postings as Posting[]) ?? []))
      .catch(() => {});
  const loadLifecycles = () =>
    fetch("/api/devcase/lifecycle")
      .then((r) => r.json())
      .then((p) => setLifecycles((p.lifecycles as Lifecycle[]) ?? []))
      .catch(() => {});
  const loadOutbox = () =>
    fetch("/api/devcase/comms")
      .then((r) => r.json())
      .then((p) => setOutbox((p.outbox as OutboxItem[]) ?? []))
      .catch(() => {});
  useEffect(() => {
    loadCases();
    loadPostings();
    loadLifecycles();
    loadOutbox();
  }, []);

  // Reload orchestration state as background tasks progress (lifecycle/evaluate update it).
  const lifecycleActive = tasks.some((t) => t.kind === "lifecycle" && (t.status === "running" || t.status === "queued"));
  useEffect(() => {
    loadLifecycles();
    loadPostings();
    loadCases();
    loadOutbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  const buildNeed = () => ({
    title: title.trim() || "Untitled role",
    stack: stackStr.split(",").map((s) => s.trim()).filter(Boolean),
    responsibilities: respStr.split("\n").map((s) => s.trim()).filter(Boolean),
    codebaseRefs: repoUrl.trim() ? [{ kind: "github", ref: repoUrl.trim() }] : [],
    seniorityTarget: seniority,
    roleFamily: "software_engineering",
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
  const snapshot = result?.snapshot ?? null;
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
          Describe the role and point us at the real codebase. The engine reflects what you say you need against
          what the code <em>actually is</em> — surfacing the gaps before we design an assignment. Assume the
          candidate&apos;s code is LLM-generated; we&apos;ll grade judgment, not typing.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,360px)_1fr]">
        {/* intake */}
        <NeedForm
          title={title}
          setTitle={setTitle}
          stackStr={stackStr}
          setStackStr={setStackStr}
          respStr={respStr}
          setRespStr={setRespStr}
          repoUrl={repoUrl}
          setRepoUrl={setRepoUrl}
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
          snapshot={snapshot}
          design={design}
          designing={designing}
          startDesign={startDesign}
          approve={approve}
          approving={approving}
          approvedId={approvedId}
        />
      </div>

      <LifecycleSection lifecycles={lifecycles} approveLifecycle={approveLifecycle} />

      <ApprovedCasesSection
        approvedCases={approvedCases}
        postings={postings}
        publish={publish}
        source={source}
        sourcing={sourcing}
        sourcedCounts={sourcedCounts}
      />

      <PostingsSection postings={postings} loadPostings={loadPostings} />

      <OutboxSection outbox={outbox} />
    </div>
  );
}
