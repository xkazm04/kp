"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Boxes, Check, ClipboardList, Copy, GitBranch, Inbox, Loader2, Lock, Send, ShieldCheck, Sparkles, Users } from "lucide-react";
import { formatPercent } from "@/app/_lib/format";
import { useTasks } from "../tasks/TasksProvider";

type NeedAnalysis = {
  realStack?: string[];
  coreResponsibilities?: string[];
  statedVsRealGaps?: string[];
  trueComplexity?: string;
  riskAreas?: string[];
  reflection?: string;
  confidence?: number;
};
type RepoSnapshot = {
  ref?: string;
  languages?: Record<string, number>;
  inferredStack?: string[];
  topDirs?: string[];
  recentCommitSummaries?: string[];
  loc?: number;
  readmeExcerpt?: string;
};
type Result = { analysis?: NeedAnalysis; snapshot?: RepoSnapshot | null; source?: string };

type CoverProbe = { id?: string; kind?: string; where?: string; reveals?: string };
type RubricDim = { name?: string; weight?: number; description?: string };
type RoleSpec = { title?: string; seniority?: string; mustHaves?: string[]; niceToHaves?: string[]; responsibilities?: string[] };
type CaseScenario = { title?: string; brief?: string; repoSeed?: string; tasks?: string[]; coverProbes?: CoverProbe[]; rubricDimensions?: RubricDim[]; timeboxHours?: number };
type Design = { role?: RoleSpec; case?: CaseScenario; source?: string };
type ApprovedCase = { id: string; title: string | null; roleTitle: string | null; seniority: string | null; createdAt: string };
type Submission = {
  id: string;
  candidateRef: string | null;
  repoRef: string | null;
  notes: string | null;
  receivedAt: string;
  status?: string;
  evaluation?: EvalBundle | null;
  transferScore?: number | null;
};
type Posting = {
  id: string;
  caseId: string | null;
  channel: string;
  token: string | null;
  roleTitle: string | null;
  caseTitle: string | null;
  submissionCount?: number;
  submissions?: Submission[];
};
type Lifecycle = {
  id: string;
  title: string | null;
  stage: string;
  auto: boolean;
  detail: string | null;
  caseId: string | null;
  postingId: string | null;
  createdAt: string;
};

type OutboxItem = { id: string; recipient: string | null; subject: string | null; kind: string | null; channel: string | null; status: string; createdAt: string };

const LIFECYCLE_STEPS = ["intake", "analyzed", "designed", "approved", "collecting", "ranked", "promoted"];
const STAGE_LABEL: Record<string, string> = {
  intake: "intake",
  analyzed: "analyzed",
  designed: "designed",
  awaiting_approval: "needs approval",
  approved: "approved",
  published: "published",
  collecting: "collecting",
  ranked: "ranked",
  promoted: "promoted",
};

const COMPLEXITY: Record<string, string> = {
  low: "bg-moss/15 text-moss",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-coral/15 text-coral",
};

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
        <section className="space-y-3 rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
          <Field label="Role title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Senior Backend Engineer"
              className="focus-ring w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-sm" />
          </Field>
          <Field label="Stack (comma-separated)">
            <input value={stackStr} onChange={(e) => setStackStr(e.target.value)} placeholder="Python, Django, PostgreSQL"
              className="focus-ring w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-sm" />
          </Field>
          <Field label="Responsibilities (one per line)">
            <textarea value={respStr} onChange={(e) => setRespStr(e.target.value)} rows={3} placeholder={"Own the ingest pipeline\nReview PRs"}
              className="focus-ring w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-sm" />
          </Field>
          <Field label="Codebase (GitHub URL)">
            <input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/owner/repo"
              className="focus-ring w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-sm" />
          </Field>
          <Field label="Seniority target">
            <select value={seniority} onChange={(e) => setSeniority(e.target.value)}
              className="focus-ring w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-sm">
              {["junior", "medior", "senior", "lead"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
          <button
            type="button"
            onClick={runLifecycle}
            disabled={lifecycleActive}
            title="Automated lifecycle: analyze → design → policy gate → publish → (on submissions) evaluate → rank → promote to Decisions"
            className="focus-ring inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-md bg-coral text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {lifecycleActive ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {lifecycleActive ? "Lifecycle running…" : "▶ Run automated lifecycle"}
          </button>
          <button type="button" onClick={submit} disabled={running}
            className="focus-ring inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-stone-200 bg-white text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50">
            {running ? <Loader2 size={14} className="animate-spin" /> : null}
            {running ? "Reflecting…" : "Analyze need only"}
          </button>

          {needTasks.length > 0 ? (
            <div className="border-t border-stone-100 pt-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-steel">Recent</p>
              <ul className="mt-1 space-y-0.5">
                {needTasks.slice(0, 6).map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => selectNeed(t.id)}
                      className={`focus-ring w-full truncate rounded px-1.5 py-1 text-left text-xs ${
                        viewed?.id === t.id ? "bg-coral/10 text-coral" : "text-ink/80 hover:bg-paper"
                      }`}>
                      {t.label?.replace("Need analysis · ", "") || t.id}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        {/* reality reflection */}
        <section className="min-w-0">
          {viewed == null ? (
            <div className="rounded-lg border border-dashed border-stone-200 p-8 text-center text-sm text-steel">
              Define a need and analyze it — the reality reflection appears here.
            </div>
          ) : running ? (
            <div className="rounded-lg border border-stone-200 bg-white p-8 text-center shadow-panel">
              <Loader2 className="mx-auto animate-spin text-coral" size={26} />
              <p className="mt-2 text-sm font-semibold text-ink">Pulling the codebase + reflecting…</p>
              <p className="text-xs text-steel">This runs as a background task — you can leave this tab.</p>
            </div>
          ) : result ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-meta uppercase tracking-wide text-steel">Reality reflection</span>
                  {analysis.trueComplexity ? (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${COMPLEXITY[analysis.trueComplexity] ?? "bg-stone-100 text-steel"}`}>
                      {analysis.trueComplexity} complexity
                    </span>
                  ) : null}
                  <span className="ml-auto text-[10px] uppercase text-steel">
                    {result.source === "llm" ? "Claude CLI" : "template"} · conf {formatPercent(analysis.confidence ?? 0, { fraction: true })}
                  </span>
                </div>
                <p className="text-sm text-ink">{analysis.reflection}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(analysis.realStack ?? []).map((s) => (
                    <span key={s} className="rounded-full bg-paper px-2 py-0.5 text-[11px] text-ink">{s}</span>
                  ))}
                </div>
                {(analysis.statedVsRealGaps ?? []).length > 0 ? (
                  <div className="mt-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-coral">Stated vs. real gaps</p>
                    <ul className="mt-1 space-y-0.5">
                      {(analysis.statedVsRealGaps ?? []).map((g, i) => (
                        <li key={i} className="flex gap-1.5 text-xs text-ink"><span className="text-coral">•</span>{g}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {(analysis.riskAreas ?? []).length > 0 ? (
                  <p className="mt-2 text-[11px] text-steel">Risk areas: {(analysis.riskAreas ?? []).join(" · ")}</p>
                ) : null}
              </div>

              {snapshot ? (
                <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
                  <div className="mb-2 flex items-center gap-1.5">
                    <Boxes size={14} className="text-steel" />
                    <span className="text-meta uppercase tracking-wide text-steel">Codebase snapshot</span>
                    <span className="ml-auto text-[11px] text-steel">~{(snapshot.loc ?? 0).toLocaleString()} LOC</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(snapshot.languages ?? {}).slice(0, 6).map(([k, v]) => (
                      <span key={k} className="rounded-md border border-stone-200 px-2 py-0.5 text-[11px] text-ink">
                        {k} <span className="text-steel">{formatPercent(v, { fraction: true })}</span>
                      </span>
                    ))}
                  </div>
                  {(snapshot.topDirs ?? []).length > 0 ? (
                    <p className="mt-2 text-[11px] text-steel">Top dirs: {(snapshot.topDirs ?? []).slice(0, 10).join(" / ")}</p>
                  ) : null}
                  {(snapshot.recentCommitSummaries ?? []).length > 0 ? (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-steel">
                      <GitBranch size={11} /> {(snapshot.recentCommitSummaries ?? []).length} recent commits read
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="rounded-md border border-dashed border-stone-200 p-3 text-xs text-steel">
                  No codebase snapshot — analysis is ungrounded. Add a public GitHub URL to ground it in reality.
                </p>
              )}

              {/* D3 — artifact design + human gate */}
              {!design && !designing ? (
                <button type="button" onClick={startDesign}
                  className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-md border border-coral/40 bg-coral/5 px-3 text-sm font-semibold text-coral hover:bg-coral/10">
                  <ClipboardList size={15} /> Design role &amp; assignment
                </button>
              ) : null}
              {designing ? (
                <div className="rounded-lg border border-stone-200 bg-white p-6 text-center shadow-panel">
                  <Loader2 className="mx-auto animate-spin text-coral" size={22} />
                  <p className="mt-2 text-sm font-semibold text-ink">Designing the role + assignment…</p>
                  <p className="text-xs text-steel">Background task — leave any time.</p>
                </div>
              ) : null}
              {design ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-meta uppercase tracking-wide text-steel">Role</span>
                      <span className="ml-auto text-[10px] uppercase text-steel">{design.source === "llm" ? "Claude CLI" : "template"}</span>
                    </div>
                    <p className="font-serif text-h3 text-ink">{design.role?.title}</p>
                    <p className="text-xs uppercase text-steel">{design.role?.seniority}</p>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <MiniList title="Must-haves" items={design.role?.mustHaves ?? []} />
                      <MiniList title="Responsibilities" items={design.role?.responsibilities ?? []} />
                    </div>
                  </div>

                  <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
                    <div className="mb-2 flex items-center gap-2">
                      <ClipboardList size={14} className="text-steel" />
                      <span className="text-meta uppercase tracking-wide text-steel">Assignment</span>
                      <span className="ml-auto text-[11px] text-steel">~{design.case?.timeboxHours ?? 4}h</span>
                    </div>
                    <p className="font-semibold text-ink">{design.case?.title}</p>
                    <p className="mt-1 text-sm text-ink">{design.case?.brief}</p>
                    {(design.case?.tasks ?? []).length ? (
                      <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-xs text-ink">
                        {(design.case?.tasks ?? []).map((t, i) => <li key={i}>{t}</li>)}
                      </ol>
                    ) : null}

                    {(design.case?.coverProbes ?? []).length ? (
                      <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/60 p-2.5">
                        <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                          <Lock size={11} /> Covert probes — internal, hidden from the candidate
                        </p>
                        <ul className="mt-1 space-y-1">
                          {(design.case?.coverProbes ?? []).map((p, i) => (
                            <li key={i} className="text-[11px] text-ink">
                              <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-amber-700">{p.kind}</span>{" "}
                              <span className="text-steel">@ {p.where}</span> — {p.reveals}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {(design.case?.rubricDimensions ?? []).length ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(design.case?.rubricDimensions ?? []).map((d) => (
                          <span key={d.name} className="rounded-full bg-paper px-2 py-0.5 text-[10px] text-ink">
                            {d.name} <span className="text-steel">{formatPercent(d.weight ?? 0, { fraction: true })}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
                      {approvedId ? (
                        <span className="inline-flex items-center gap-1 text-sm font-semibold text-moss"><Check size={16} /> Approved</span>
                      ) : (
                        <button type="button" onClick={approve} disabled={approving}
                          className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-moss px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                          <ShieldCheck size={15} /> {approving ? "Approving…" : "Approve assignment"}
                        </button>
                      )}
                      <span className="text-[11px] text-steel">Human gate — review the probes, then approve to save it.</span>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-lg border border-stone-200 bg-red-50 p-4 text-sm text-red-700">
              {viewed.error ?? "Analysis did not complete."}
            </div>
          )}
        </section>
      </div>

      {lifecycles.length > 0 ? (
        <section>
          <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
            <Sparkles size={13} className="text-coral" /> Automated lifecycle <span className="text-coral">· {lifecycles.length}</span>
          </h3>
          <p className="mt-1 text-[11px] text-steel">
            Each case advances under policy — auto-approving clean designs, routing flagged ones to you, publishing, and
            (as submissions arrive) evaluating → ranking → promoting the top candidates into Decisions. No manual steps between.
          </p>
          <div className="mt-3 space-y-2">
            {lifecycles.map((lc) => (
              <LifecycleRow key={lc.id} lc={lc} onApprove={() => approveLifecycle(lc.id)} />
            ))}
          </div>
        </section>
      ) : null}

      {approvedCases.length > 0 ? (
        <section>
          <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
            <ShieldCheck size={13} className="text-moss" /> Approved assignments <span className="text-coral">· {approvedCases.length}</span>
          </h3>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {approvedCases.map((c) => {
              const published = postings.some((p) => p.caseId === c.id);
              return (
                <li key={c.id} className="flex flex-col rounded-lg border border-stone-200 bg-white p-3 shadow-panel">
                  <p className="truncate text-sm font-semibold text-ink">{c.title || "Assignment"}</p>
                  <p className="truncate text-[11px] text-steel">{c.roleTitle} · {c.seniority}</p>
                  <div className="mt-2 flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => publish(c.id)}
                      disabled={published}
                      className="focus-ring inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-stone-200 px-2 text-[11px] font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
                    >
                      <Send size={12} /> {published ? "Published" : "Publish"}
                    </button>
                    <button
                      type="button"
                      onClick={() => source(c.id)}
                      disabled={sourcing === c.id}
                      title="Rank the existing candidate DB against this role and seed the pipeline at Sourced"
                      className="focus-ring inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-stone-200 px-2 text-[11px] font-semibold text-coral hover:border-coral/40 disabled:opacity-50"
                    >
                      <Users size={12} />
                      {sourcing === c.id ? "…" : sourcedCounts[c.id] != null ? `sourced ${sourcedCounts[c.id]}` : "Source DB"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {postings.length > 0 ? (
        <section>
          <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
            <Inbox size={13} className="text-coral" /> Postings &amp; submissions <span className="text-coral">· {postings.length}</span>
          </h3>
          <p className="mt-1 text-[11px] text-steel">
            The distribution seam. Publishing posts to a channel (local stub) and returns an apply token; submissions arrive
            on the IN side. Real channels (email / ATS / job board) plug into the same adapter.
          </p>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {postings.map((p) => (
              <div key={p.id} className="rounded-lg border border-stone-200 bg-white p-3 shadow-panel">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-paper px-2 py-0.5 text-[10px] font-semibold uppercase text-steel">{p.channel}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{p.caseTitle || p.roleTitle || "Posting"}</span>
                  <span className="text-[11px] text-steel">{p.submissions?.length ?? p.submissionCount ?? 0} in</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="shrink-0 text-[9px] uppercase tracking-wide text-steel">Apply link</span>
                  <ApplyTokenPill token={p.token} />
                </div>

                {(p.submissions ?? []).length > 0 ? (
                  <ul className="mt-2 space-y-1.5 border-t border-stone-100 pt-2">
                    {[...(p.submissions ?? [])]
                      .sort((a, b) => (b.transferScore ?? -1) - (a.transferScore ?? -1))
                      .map((s, i, arr) => {
                        const rank = s.transferScore != null ? i + 1 : null;
                        const isTop = rank === 1;
                        return (
                          <Fragment key={s.id}>
                            <SubmissionRow submission={s} caseId={p.caseId} rank={rank} isTop={isTop} onChanged={loadPostings} />
                            {/* subtle divider separating the recommended leader from the rest */}
                            {isTop && arr.length > 1 ? (
                              <li aria-hidden className="border-t border-dashed border-stone-200" />
                            ) : null}
                          </Fragment>
                        );
                      })}
                  </ul>
                ) : null}

                <SubmissionForm postingId={p.id} onDone={loadPostings} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {outbox.length > 0 ? (
        <section>
          <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
            <Send size={13} className="text-coral" /> Comms outbox <span className="text-coral">· {outbox.length}</span>
          </h3>
          <p className="mt-1 text-[11px] text-steel">
            Every message the pipeline sent (acknowledgements on intake, invites on promote). &quot;queued&quot; = recorded locally;
            set <span className="font-mono">COMMS_WEBHOOK_URL</span> to relay through a real channel (email / ATS).
          </p>
          <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white shadow-panel">
            {outbox.slice(0, 12).map((m) => (
              <li key={m.id} className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                    m.kind === "invite" ? "bg-moss/15 text-moss" : "bg-paper text-steel"
                  }`}
                >
                  {m.kind}
                </span>
                <span className="w-28 shrink-0 truncate text-steel">{m.recipient}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{m.subject}</span>
                <span className="shrink-0 text-[9px] uppercase text-steel">{m.status === "queued" ? `${m.channel}` : m.status}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

// The OUT side of the distribution seam: the apply token is the artifact you
// hand to candidates/channels. Render it as a tappable pill that copies the full
// apply URL and confirms with a moss check for ~1.5s.
function ApplyTokenPill({ token }: { token: string | null }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!token) {
    return <span className="font-mono text-[10px] text-steel">no token</span>;
  }

  const applyUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/devcase/inbound?token=${token}`
      : `/api/devcase/inbound?token=${token}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(applyUrl);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (insecure context / denied) — no-op */
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy the apply link to share with candidates"
      aria-label={copied ? "Apply link copied to clipboard" : "Copy apply link to clipboard"}
      className="focus-ring inline-flex min-w-0 items-center gap-1.5 rounded-full border border-stone-200 bg-paper px-2 py-0.5 text-[10px] font-medium text-steel transition-colors hover:border-coral/40 hover:text-ink"
    >
      {copied ? (
        <Check size={11} className="shrink-0 text-moss" aria-hidden />
      ) : (
        <Copy size={11} className="shrink-0" aria-hidden />
      )}
      <span className="truncate font-mono">{copied ? "Copied!" : `token ${token}`}</span>
    </button>
  );
}

function SubmissionForm({ postingId, onDone }: { postingId: string; onDone: () => void }) {
  const [candidate, setCandidate] = useState("");
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!candidate.trim() || !repo.trim()) return;
    setBusy(true);
    try {
      await fetch("/api/devcase/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postingId, candidateRef: candidate.trim(), repoRef: repo.trim() }),
      });
      setCandidate("");
      setRepo("");
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-stone-100 pt-2">
      <input value={candidate} onChange={(e) => setCandidate(e.target.value)} placeholder="candidate"
        className="focus-ring h-7 w-24 rounded border border-stone-200 px-1.5 text-[11px]" />
      <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="submission repo URL"
        className="focus-ring h-7 min-w-0 flex-1 rounded border border-stone-200 px-1.5 text-[11px]" />
      <button type="button" onClick={send} disabled={busy}
        className="focus-ring inline-flex h-7 items-center gap-1 rounded border border-stone-200 px-2 text-[11px] font-semibold text-coral hover:bg-coral/5 disabled:opacity-50">
        <Inbox size={11} /> {busy ? "…" : "Record"}
      </button>
    </div>
  );
}

type Reflection = {
  narrative?: string;
  iterationPattern?: string;
  deadEnds?: string[];
  readBeforeWrite?: number;
  verificationHabits?: string[];
  confidence?: number;
};
type ProbeOutcome = { probeId?: string; detected?: boolean; handledWell?: boolean; note?: string };
type Tooling = { fluency?: number; probeOutcomes?: ProbeOutcome[]; overRelianceFlags?: string[]; evidence?: string[]; confidence?: number };
type CaseEval = { dimensionScores?: Record<string, number>; strengths?: string[]; concerns?: string[]; summary?: string };
type Transfer = { transferScore?: number; transfers?: string[]; gaps?: string[]; roleFitRationale?: string };
type EvalBundle = { reflection?: Reflection; tooling?: Tooling; evaluation?: CaseEval; transfer?: Transfer; source?: string; commitCount?: number };

function scoreColor(v: number): string {
  if (v >= 72) return "bg-moss";
  if (v >= 55) return "bg-moss/60";
  if (v >= 40) return "bg-amber-400";
  return "bg-coral";
}

// Foreground that stays legible on each scoreColor band: dark text on the light
// amber / translucent-moss bands, white on the solid moss / coral ones.
function scoreTextColor(v: number): string {
  if (v >= 72) return "text-white";
  if (v >= 55) return "text-ink";
  if (v >= 40) return "text-ink";
  return "text-white";
}

function SubmissionRow({ submission, caseId, rank, isTop = false, onChanged }: { submission: Submission; caseId: string | null; rank: number | null; isTop?: boolean; onChanged: () => void }) {
  const { startTask, tasks } = useTasks();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [promoted, setPromoted] = useState(false);
  const seen = useRef(false);
  const task = tasks.find((t) => t.id === taskId);
  const busy = task ? task.status === "running" || task.status === "queued" : false;
  const fresh = task?.status === "succeeded" ? (task.result as EvalBundle) : null;
  const ev = fresh ?? submission.evaluation ?? null;

  // reload postings once when the evaluate task lands (so the score persists into the list)
  useEffect(() => {
    if (task?.status === "succeeded" && !seen.current) {
      seen.current = true;
      onChanged();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.status]);

  const evaluate = async () => {
    seen.current = false;
    const t = await startTask("evaluate_submission", { submissionId: submission.id, candidateRef: submission.candidateRef });
    if (t) setTaskId(t.id);
  };
  const promote = async () => {
    const r = await fetch("/api/devcase/promote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submissionId: submission.id }),
    });
    if (r.ok) setPromoted(true);
  };

  const ts = submission.transferScore ?? ev?.transfer?.transferScore ?? null;

  return (
    <li className={`rounded-md border p-2 ${isTop ? "border-moss/30 bg-moss/5 ring-1 ring-moss/40" : "border-stone-100 bg-paper/40"}`}>
      <div className="flex items-center gap-1.5 text-[11px]">
        {rank ? (
          <span className={`shrink-0 rounded px-1 text-[9px] font-bold text-white ${rank === 1 ? "bg-moss" : "bg-ink"}`}>#{rank}</span>
        ) : null}
        {isTop ? (
          <span className="shrink-0 rounded-full bg-moss/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-moss">
            Top match
          </span>
        ) : null}
        <GitBranch size={11} className="shrink-0 text-steel" />
        <span className="font-semibold text-ink">{submission.candidateRef}</span>
        <span className="min-w-0 flex-1 truncate text-steel">{submission.repoRef}</span>
        {ts != null ? (
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${scoreColor(ts)} ${scoreTextColor(ts)}`}
            aria-label={`Transfer fit score ${ts} of 100`}
          >
            {ts}<span className="opacity-70"> fit</span>
          </span>
        ) : null}
        <button type="button" onClick={evaluate} disabled={busy}
          className="focus-ring inline-flex h-6 shrink-0 items-center gap-1 rounded border border-stone-200 bg-white px-1.5 text-[10px] font-semibold text-coral hover:bg-coral/5 disabled:opacity-50">
          <Sparkles size={10} /> {busy ? "Evaluating…" : ev ? "Re-evaluate" : "Evaluate"}
        </button>
      </div>
      {ev ? <EvalPanel ev={ev} onPromote={promote} promoted={promoted} /> : null}
    </li>
  );
}

function EvalPanel({ ev, onPromote, promoted }: { ev: EvalBundle; onPromote: () => void; promoted: boolean }) {
  const r = ev.reflection ?? {};
  const t = ev.tooling ?? {};
  const e = ev.evaluation ?? {};
  const x = ev.transfer ?? {};
  const dims = e.dimensionScores ?? {};
  return (
    <div className="mt-2 rounded-md border border-stone-200 bg-white p-2.5 text-[11px] text-ink">
      {/* capability scores */}
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-steel">Capability scores</span>
        <span className="ml-auto text-[9px] uppercase text-steel">
          transfer <b className="text-ink">{x.transferScore ?? "—"}</b> · {ev.source === "llm" ? "Claude CLI" : "template"} · {ev.commitCount ?? 0} commits
        </span>
      </div>
      <div className="space-y-1">
        {["framing", "tooling", "judgment", "architecture", "transfer"].map((k, i) => (
          <ScoreBar key={k} label={k} value={dims[k] ?? 0} index={i} />
        ))}
      </div>
      {e.summary ? <p className="mt-1.5 text-[11px] text-ink">{e.summary}</p> : null}
      <div className="mt-1 grid grid-cols-2 gap-2 text-[10px]">
        {(e.strengths ?? []).length ? <div><span className="font-semibold text-moss">+ </span>{(e.strengths ?? []).join("; ")}</div> : null}
        {(e.concerns ?? []).length ? <div><span className="font-semibold text-coral">! </span>{(e.concerns ?? []).join("; ")}</div> : null}
      </div>

      {/* trace + tooling (D5) */}
      <div className="mt-2 border-t border-stone-100 pt-2 text-[10px] text-steel">
        <span className="rounded bg-paper px-1.5 py-0.5 uppercase">{r.iterationPattern}</span>{" "}
        read-before-write <b className="text-ink">{formatPercent(r.readBeforeWrite ?? 0, { fraction: true })}</b>{" "}
        · fluency <b className="text-ink">{formatPercent(t.fluency ?? 0, { fraction: true })}</b>
        {(x.gaps ?? []).length ? <span> · gaps: {(x.gaps ?? []).join(", ")}</span> : null}
      </div>
      <p className="mt-1 text-[9px] italic text-steel">Code assumed LLM-generated — using AI is never penalised; judged on judgment + verification + transfer.</p>

      <div className="mt-2 flex items-center gap-2 border-t border-stone-100 pt-2">
        {promoted ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-moss"><Check size={13} /> In pipeline</span>
        ) : (
          <button type="button" onClick={onPromote}
            className="focus-ring inline-flex h-7 items-center gap-1 rounded-md bg-ink px-2.5 text-[11px] font-semibold text-white hover:opacity-90">
            <Send size={12} /> Promote to pipeline
          </button>
        )}
        <span className="text-[9px] text-steel">→ becomes a Decisions review card</span>
      </div>
    </div>
  );
}

// A single capability bar that grows from 0 to its value on mount, so the row
// reads as a live measurement rather than a static printout. Rows stagger by
// ~60ms; prefers-reduced-motion users skip the transition and see the final
// width immediately (motion-reduce honors globals.css's reduced-motion intent).
function ScoreBar({ label, value, index }: { label: string; value: number; index: number }) {
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-[10px] capitalize text-steel">{label}</span>
      <span
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} score ${value} of 100`}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200"
      >
        <span
          className={`block h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none ${scoreColor(value)}`}
          style={{ width: filled ? `${value}%` : "0%", transitionDelay: `${index * 60}ms` }}
        />
      </span>
      <span className="w-6 shrink-0 text-right text-[10px] text-ink">{value}</span>
    </div>
  );
}

function MiniList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-steel">{title}</p>
      <ul className="mt-0.5 space-y-0.5">
        {items.slice(0, 5).map((it, i) => (
          <li key={i} className="flex gap-1 text-[11px] text-ink"><span className="text-moss">•</span><span>{it}</span></li>
        ))}
        {items.length === 0 ? <li className="text-[11px] text-steel">—</li> : null}
      </ul>
    </div>
  );
}

function LifecycleRow({ lc, onApprove }: { lc: Lifecycle; onApprove: () => void }) {
  const mapped = lc.stage === "awaiting_approval" ? "designed" : lc.stage === "published" ? "collecting" : lc.stage;
  const idx = LIFECYCLE_STEPS.indexOf(mapped);
  const awaiting = lc.stage === "awaiting_approval";
  const done = lc.stage === "promoted";
  // Describe the dot-rail for screen readers, since the steps are otherwise
  // conveyed purely by color/position.
  const railLabel = `Lifecycle progress — ${LIFECYCLE_STEPS.map(
    (s, i) => `${s}: ${i < idx ? "done" : i === idx ? "current" : "upcoming"}`
  ).join(", ")}`;
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3 shadow-panel">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{lc.title || "Role"}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
            awaiting ? "bg-amber-100 text-amber-700" : done ? "bg-moss/15 text-moss" : "bg-paper text-steel"
          }`}
        >
          {STAGE_LABEL[lc.stage] ?? lc.stage}
        </span>
        {awaiting ? (
          <button
            type="button"
            onClick={onApprove}
            className="focus-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-moss px-2.5 text-[11px] font-semibold text-white hover:opacity-90"
          >
            <ShieldCheck size={12} /> Approve
          </button>
        ) : null}
      </div>
      <div className="mt-2 flex items-center" role="img" aria-label={railLabel}>
        {LIFECYCLE_STEPS.map((s, i) => (
          <div key={s} aria-hidden className={`flex items-center ${i < LIFECYCLE_STEPS.length - 1 ? "flex-1" : ""}`}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${i <= idx ? "bg-coral" : "bg-stone-200"}`} title={s} />
            {i < LIFECYCLE_STEPS.length - 1 ? <span className={`h-0.5 flex-1 ${i < idx ? "bg-coral/40" : "bg-stone-200"}`} /> : null}
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-steel">{lc.detail}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-steel">{label}</span>
      {children}
    </label>
  );
}
