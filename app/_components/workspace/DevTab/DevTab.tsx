"use client";

import { useEffect, useMemo, useState } from "react";
import { Boxes, Check, ClipboardList, GitBranch, Loader2, Lock, ShieldCheck, Sparkles } from "lucide-react";
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

  const loadCases = () =>
    fetch("/api/devcase")
      .then((r) => r.json())
      .then((p) => setApprovedCases((p.cases as ApprovedCase[]) ?? []))
      .catch(() => {});
  useEffect(() => {
    loadCases();
  }, []);

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
    const need = {
      title: title.trim() || "Untitled role",
      stack: stackStr.split(",").map((s) => s.trim()).filter(Boolean),
      responsibilities: respStr.split("\n").map((s) => s.trim()).filter(Boolean),
      codebaseRefs: repoUrl.trim() ? [{ kind: "github", ref: repoUrl.trim() }] : [],
      seniorityTarget: seniority,
      roleFamily: "software_engineering",
    };
    const t = await startTask("need_analysis", { need });
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
          <button type="button" onClick={submit} disabled={running}
            className="focus-ring inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-md bg-ink text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {running ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {running ? "Reflecting against the codebase…" : "Analyze need"}
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
                    {result.source === "llm" ? "Claude CLI" : "template"} · conf {Math.round((analysis.confidence ?? 0) * 100)}%
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
                        {k} <span className="text-steel">{Math.round(v * 100)}%</span>
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
                            {d.name} <span className="text-steel">{Math.round((d.weight ?? 0) * 100)}%</span>
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

      {approvedCases.length > 0 ? (
        <section>
          <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
            <ShieldCheck size={13} className="text-moss" /> Approved assignments <span className="text-coral">· {approvedCases.length}</span>
          </h3>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {approvedCases.map((c) => (
              <li key={c.id} className="rounded-lg border border-stone-200 bg-white p-3 shadow-panel">
                <p className="truncate text-sm font-semibold text-ink">{c.title || "Assignment"}</p>
                <p className="truncate text-[11px] text-steel">{c.roleTitle} · {c.seniority}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-steel">{label}</span>
      {children}
    </label>
  );
}
