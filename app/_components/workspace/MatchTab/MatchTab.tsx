"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTasks } from "../tasks/TasksProvider";

type AnalysisRow = {
  slug: string;
  candidate_label: string;
  role_family: string | null;
  seniority: string | null;
};
type ProfileRow = {
  id: string;
  label: string;
  archetype: string | null;
  role_family: string | null;
  completeness: number | null;
};

type MatchResult = {
  jobId: string;
  title: string;
  company?: string;
  location?: string;
  workMode?: string;
  seniority?: string;
  roleFamily?: string;
  salaryBand?: number[];
  total: number;
  skillsScore: number;
  careerScore: number;
  personalScore: number;
  confidenceLow: number;
  confidenceHigh: number;
  matchedSkills?: string[];
  matchedSkillProvenance?: Record<string, string>;
  missingSkills?: string[];
  isEntryEligible?: boolean;
  graduateFriendliness?: number;
};
type MatchResponse = {
  candidate: {
    label?: string;
    seniority?: string;
    roleFamily?: string;
    archetype?: string;
    skills?: number;
    potentialScore?: number | null;
    assumptions?: string[];
  };
  meta: { evaluated?: number; koFiltered?: number; survivors?: number; returned?: number };
  matches: MatchResult[];
};
type MatchRef = { profileId?: string; analysisSlug?: string };

const FAMILY_LABEL: Record<string, string> = {
  software_engineering: "Software",
  data_ai: "Data / AI",
  product_project: "Product / Project",
};
const ARCHETYPE_LABEL: Record<string, string> = {
  bau: "Experienced",
  student: "Student / early-career",
  career_switcher: "Career-switcher",
};
const EARLY_CAREER = new Set(["student", "career_switcher"]);

function provLabel(p: string): { text: string; tone: string } {
  if (p === "professional") return { text: "prod", tone: "bg-stone-200 text-ink" };
  if (p === "internship") return { text: "intern", tone: "bg-blue-50 text-blue-700" };
  if (p === "self_declared") return { text: "self", tone: "bg-stone-100 text-steel" };
  if (p === "open_source") return { text: "OSS", tone: "bg-blue-50 text-blue-700" };
  if (p === "certification") return { text: "cert", tone: "bg-blue-50 text-blue-700" };
  return { text: "academic", tone: "bg-amber-50 text-amber-800" };
}

export function MatchTab() {
  const [source, setSource] = useState<"profile" | "analysis">("profile");
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [analyses, setAnalyses] = useState<AnalysisRow[]>([]);
  const [selProfile, setSelProfile] = useState("");
  const [selAnalysis, setSelAnalysis] = useState("");

  const [result, setResult] = useState<MatchResponse | null>(null);
  const [matchRef, setMatchRef] = useState<MatchRef>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useSearchParams();
  const profileParam = search.get("profile");
  const [autoRan, setAutoRan] = useState(false);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((p) => {
        const rows = (p.profiles as ProfileRow[]) ?? [];
        setProfiles(rows);
        if (rows.length) setSelProfile(rows[0].id);
        else setSource("analysis");
      })
      .catch(() => undefined);
    fetch("/api/analyses")
      .then((r) => r.json())
      .then((p) => {
        const rows = (p.analyses as AnalysisRow[]) ?? [];
        setAnalyses(rows);
        if (rows.length) setSelAnalysis(rows[0].slug);
      })
      .catch(() => undefined);
  }, []);

  const runMatchFor = async (ref: MatchRef) => {
    if (!ref.profileId && !ref.analysisSlug) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...ref, limit: 25 }),
      });
      const payload = await r.json();
      if (!r.ok) throw new Error(payload.error ?? `Match failed (${r.status}).`);
      setResult(payload as MatchResponse);
      setMatchRef(ref);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Match failed.");
    } finally {
      setLoading(false);
    }
  };

  const runMatch = () =>
    runMatchFor(source === "profile" ? { profileId: selProfile } : { analysisSlug: selAnalysis });

  // Deep link from the Pipeline (?tab=match&profile=<id>): preselect + auto-run once.
  useEffect(() => {
    if (profileParam && !autoRan) {
      setSource("profile");
      setSelProfile(profileParam);
      setAutoRan(true);
      void runMatchFor({ profileId: profileParam });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileParam, autoRan]);

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <header className="border-b border-stone-200 pb-4">
        <p className="text-meta uppercase text-coral">Workspace</p>
        <h2 className="mt-1 font-serif text-display text-ink">Match candidate → jobs</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">
          Run a candidate against the whole corpus. KO filters narrow it, a multi-factor scorer ranks the survivors,
          and the per-match reasoning explains the fit. Student / career-switcher profiles are scored on a different
          profile — <strong>potential replaces years of experience</strong>, skills are provenance-discounted, and
          the KO filter keeps only entry-eligible roles.
        </p>
      </header>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-steel">Source</span>
          <div className="flex gap-1">
            {(["profile", "analysis"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSource(s)}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  source === s ? "border-ink bg-ink text-white" : "border-stone-200 text-ink hover:bg-paper"
                }`}
              >
                {s === "profile" ? "Saved profile" : "Saved analysis"}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-steel">Candidate</span>
          {source === "profile" ? (
            <select
              value={selProfile}
              onChange={(e) => setSelProfile(e.target.value)}
              className="focus-ring h-10 min-w-[280px] rounded-md border border-stone-200 bg-white px-2 text-sm text-ink"
            >
              {profiles.length === 0 ? (
                <option value="">No saved profiles — build one in Profile</option>
              ) : (
                profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} · {ARCHETYPE_LABEL[p.archetype ?? ""] ?? p.archetype} ·{" "}
                    {Math.round((p.completeness ?? 0) * 100)}%
                  </option>
                ))
              )}
            </select>
          ) : (
            <select
              value={selAnalysis}
              onChange={(e) => setSelAnalysis(e.target.value)}
              className="focus-ring h-10 min-w-[280px] rounded-md border border-stone-200 bg-white px-2 text-sm text-ink"
            >
              {analyses.length === 0 ? (
                <option value="">No saved analyses — run one in Analyze</option>
              ) : (
                analyses.map((a) => (
                  <option key={a.slug} value={a.slug}>
                    {a.candidate_label} · {a.role_family ?? "—"} / {a.seniority ?? "—"}
                  </option>
                ))
              )}
            </select>
          )}
        </label>

        <button
          type="button"
          onClick={runMatch}
          disabled={loading || (source === "profile" ? !selProfile : !selAnalysis)}
          className="focus-ring h-10 rounded-md bg-ink px-4 text-sm font-semibold text-white disabled:opacity-40"
        >
          {loading ? "Matching…" : "Run matching"}
        </button>
      </div>

      <div className="mt-5">
        {error ? (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>
        ) : result ? (
          <Results result={result} matchRef={matchRef} />
        ) : (
          <p className="rounded-md bg-paper p-4 text-sm text-steel">
            Pick a candidate and run matching to see ranked, KO-filtered, scored jobs.
          </p>
        )}
      </div>
    </section>
  );
}

type Reasoning = { verdict: string; strengths: string[]; gaps: string[]; interviewProbes: string[] };
type ReasoningState = { loading?: boolean; error?: string; source?: string; cached?: boolean; data?: Reasoning };

function Results({ result, matchRef }: { result: MatchResponse; matchRef: MatchRef }) {
  const { candidate, meta, matches } = result;
  const archetype = candidate.archetype ?? "bau";
  const early = EARLY_CAREER.has(archetype);

  const candidateId = matchRef.profileId ?? matchRef.analysisSlug ?? "";
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<Set<string>>(new Set());

  const addToPipeline = async (m: MatchResult) => {
    if (!candidateId || added.has(m.jobId) || adding.has(m.jobId)) return;
    setAdding((s) => new Set(s).add(m.jobId));
    try {
      const r = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId,
          candidateLabel: candidate.label,
          archetype,
          roleFamily: m.roleFamily,
          jobId: m.jobId,
          jobTitle: m.title,
          matchScore: m.total,
          stage: "AI-matched",
        }),
      });
      if (r.ok) setAdded((s) => new Set(s).add(m.jobId));
    } finally {
      setAdding((s) => {
        const n = new Set(s);
        n.delete(m.jobId);
        return n;
      });
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Chip label="Candidate" value={candidate.label ?? "—"} />
        <Chip label="Archetype" value={ARCHETYPE_LABEL[archetype] ?? archetype} tone={early ? "green" : "neutral"} />
        <Chip label="Profile" value={`${candidate.roleFamily ?? "—"} / ${candidate.seniority ?? "—"}`} />
        <Chip label="Evaluated" value={meta.evaluated ?? 0} />
        <Chip label="KO-filtered" value={meta.koFiltered ?? 0} tone="amber" />
        <Chip label="Ranked" value={meta.returned ?? matches.length} tone="green" />
      </div>
      {early ? (
        <p className="mt-2 text-xs text-steel">
          Early-career scoring profile: the <strong>Potential</strong> bar is the readiness model (replacing years of
          experience), and only entry-eligible roles survive the KO filter. Scores are not comparable to experienced
          candidates&apos; numbers.
        </p>
      ) : null}
      {candidate.assumptions?.length ? (
        <p className="mt-1 text-xs text-steel">
          <span className="font-semibold uppercase">Assumptions:</span> {candidate.assumptions.join(" · ")}
        </p>
      ) : null}

      <ol className="mt-4 space-y-2">
        {matches.map((m, i) => (
          <MatchCard
            key={m.jobId}
            m={m}
            index={i}
            matchRef={matchRef}
            archetype={archetype}
            canAdd={Boolean(candidateId)}
            added={added.has(m.jobId)}
            adding={adding.has(m.jobId)}
            onAdd={() => addToPipeline(m)}
          />
        ))}
      </ol>
    </div>
  );
}

function MatchCard({
  m,
  index,
  matchRef,
  archetype,
  canAdd,
  added,
  adding,
  onAdd,
}: {
  m: MatchResult;
  index: number;
  matchRef: MatchRef;
  archetype: string;
  canAdd: boolean;
  added: boolean;
  adding: boolean;
  onAdd: () => void;
}) {
  const { startTask, tasks } = useTasks();
  const [reasoning, setReasoning] = useState<ReasoningState | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [skillsExpanded, setSkillsExpanded] = useState(false);
  const MATCHED_CAP = 8;
  const MISSING_CAP = 6;
  const early = EARLY_CAREER.has(archetype);
  const canExplain = Boolean(matchRef.profileId || matchRef.analysisSlug);

  // Routed through the background-task system: tracked, dedup'd, refresh-safe.
  const explain = async () => {
    if (reasoning?.loading) return;
    setReasoning({ loading: true });
    const t = await startTask("reasoning", { ...matchRef, jobId: m.jobId, label: m.title });
    if (!t) {
      setReasoning({ error: "Couldn't start the fit analysis." });
      return;
    }
    setTaskId(t.id);
  };

  useEffect(() => {
    if (!taskId) return;
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    if (t.status === "succeeded") {
      const p = t.result as { reasoning?: Reasoning; source?: string; cached?: boolean } | null;
      setReasoning(p?.reasoning ? { data: p.reasoning, source: p.source, cached: p.cached } : { error: "No reasoning returned." });
      setTaskId(null);
    } else if (t.status === "failed" || t.status === "canceled" || t.status === "interrupted") {
      setReasoning({ error: t.error ?? "Reasoning failed." });
      setTaskId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, taskId]);

  return (
    <li className="rounded-lg border border-stone-200 p-3">
      <div className="flex items-start gap-4">
        <div className="w-16 shrink-0 text-center">
          <div className="font-serif text-2xl text-ink">{m.total}</div>
          <div className="text-[10px] text-steel">
            {m.confidenceLow}–{m.confidenceHigh}
          </div>
          <div className="mt-0.5 text-[10px] uppercase text-steel">#{index + 1}</div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">{m.title}</span>
            {m.isEntryEligible ? (
              <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                entry-eligible
              </span>
            ) : null}
            <div className="ml-auto flex items-center gap-1.5">
              {canAdd ? (
                <button
                  type="button"
                  onClick={onAdd}
                  disabled={added || adding}
                  className={`focus-ring rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                    added
                      ? "bg-moss/10 text-moss"
                      : "border border-stone-200 text-ink hover:bg-paper disabled:opacity-40"
                  }`}
                >
                  {added ? "✓ In pipeline" : adding ? "Adding…" : "+ Pipeline"}
                </button>
              ) : null}
              {canExplain ? (
                <button
                  type="button"
                  onClick={explain}
                  disabled={reasoning?.loading}
                  className="focus-ring rounded-md border border-stone-200 px-2 py-0.5 text-[11px] font-semibold text-coral hover:bg-paper disabled:opacity-40"
                >
                  {reasoning?.loading ? "Reasoning…" : reasoning?.data ? "Refresh reasoning" : "Explain fit"}
                </button>
              ) : null}
            </div>
          </div>
          <p className="text-xs text-steel">
            {m.company ?? "—"} · {m.location ?? "—"} · {m.workMode ?? "—"} ·{" "}
            {FAMILY_LABEL[m.roleFamily ?? ""] ?? m.roleFamily} / {m.seniority} ·{" "}
            {m.salaryBand && m.salaryBand.length === 2
              ? `${Math.round(m.salaryBand[0] / 1000)}–${Math.round(m.salaryBand[1] / 1000)}k CZK`
              : "—"}
          </p>

          <div className="mt-2 grid max-w-md grid-cols-3 gap-2">
            <Bar label={early ? "Foundation" : "Skills"} value={m.skillsScore} />
            <Bar label={early ? "Potential" : "Career"} value={m.careerScore} />
            <Bar label={early ? "Fit" : "Personal"} value={m.personalScore} />
          </div>

          {(() => {
            const matched = m.matchedSkills ?? [];
            const missing = m.missingSkills ?? [];
            const matchedShown = skillsExpanded ? matched : matched.slice(0, MATCHED_CAP);
            const missingShown = skillsExpanded ? missing : missing.slice(0, MISSING_CAP);
            const hidden = Math.max(0, matched.length - matchedShown.length) + Math.max(0, missing.length - missingShown.length);
            return (
              <div className="mt-2 flex flex-wrap gap-1">
                {matchedShown.map((s) => {
                  const pl = early ? provLabel((m.matchedSkillProvenance ?? {})[s] ?? "self_declared") : null;
                  return (
                    <span
                      key={`m-${s}`}
                      className="inline-flex items-center gap-1 rounded-md bg-green-50 px-1.5 py-0.5 text-[11px] text-green-700"
                    >
                      {s}
                      {pl ? <span className={`rounded px-1 text-[9px] uppercase ${pl.tone}`}>{pl.text}</span> : null}
                    </span>
                  );
                })}
                {missingShown.map((s) => (
                  <span
                    key={`x-${s}`}
                    className="rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] text-red-700"
                    title={early ? "Missing must-have (often learnable)" : "Missing must-have"}
                  >
                    ✗ {s}
                  </span>
                ))}
                {hidden > 0 || skillsExpanded ? (
                  <button
                    type="button"
                    onClick={() => setSkillsExpanded((v) => !v)}
                    className="focus-ring rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] font-semibold text-steel hover:bg-stone-200"
                  >
                    {skillsExpanded ? "Show less" : `+${hidden} more`}
                  </button>
                ) : null}
              </div>
            );
          })()}

          {reasoning ? <ReasoningPanel state={reasoning} /> : null}
        </div>
      </div>
    </li>
  );
}

function ReasoningPanel({ state }: { state: ReasoningState }) {
  if (state.loading) return <p className="mt-3 text-xs text-steel">Generating reasoning…</p>;
  if (state.error) return <p className="mt-3 rounded-md bg-red-50 p-2 text-xs text-red-700">{state.error}</p>;
  if (!state.data) return null;
  const r = state.data;
  return (
    <div className="mt-3 rounded-md border border-stone-200 bg-paper/50 p-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-coral">Reasoning</span>
        <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-steel">
          {state.source === "llm" ? "LLM" : "rule-based"}
          {state.cached ? " · cached" : ""}
        </span>
      </div>
      <p className="mt-1 text-sm text-ink">{r.verdict}</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <ReasonList title="Strengths" items={r.strengths} tone="green" />
        <ReasonList title="Gaps" items={r.gaps} tone="red" />
        <ReasonList title="Interview probes" items={r.interviewProbes} tone="neutral" />
      </div>
    </div>
  );
}

function ReasonList({ title, items, tone }: { title: string; items: string[]; tone: "green" | "red" | "neutral" }) {
  const dot = tone === "green" ? "text-green-600" : tone === "red" ? "text-red-600" : "text-steel";
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-steel">{title}</p>
      <ul className="mt-1 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex gap-1 text-xs text-ink">
            <span className={dot}>•</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  // Fill color tracks the score (coral -> amber -> moss), not just bar length.
  const tone = pct < 45 ? "bg-coral/70" : pct < 72 ? "bg-dial-amber" : "bg-moss";
  return (
    <div>
      <div className="flex justify-between text-[10px] text-steel">
        <span className="uppercase">{label}</span>
        <span>{pct}</span>
      </div>
      <div className="mt-0.5 h-1.5 rounded-full bg-stone-100">
        <div className={`h-1.5 rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Chip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "green" | "amber";
}) {
  const toneClass =
    tone === "green"
      ? "border-green-200 bg-green-50 text-green-800"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-stone-200 bg-paper text-ink";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${toneClass}`}>
      <span className="uppercase tracking-wide text-steel">{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}
