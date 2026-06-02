"use client";

import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Crown,
  Loader2,
  Minus,
  RefreshCw,
  Sparkles,
  XCircle,
} from "lucide-react";
import { Modal } from "@/app/_components/Modal";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { ConfidenceBandBadge, confidenceBandTitle, FitTierBadge } from "@/app/_components/Badge";
import { ScoreBreakdown } from "@/app/features/sub_match/MatchShared";
import { provLabel, type Confidence, type ScoreDimension } from "@/app/features/sub_match/MatchTypes";
import { formatCzk, scoreTone, scoreToneColor } from "@/app/_lib/format";
import { styleFor } from "./DecisionsTypes";

// Structured, bold-formatted head-to-head narrative (group_compare_cli). Bold
// spans are marked with **double asterisks** for RichText to render as <strong>.
export type Comparison = { headline: string; keyPoints: string[]; recommendation?: string };

// One candidate as carried by a group evaluation. The base fields (score,
// verdict, strengths, gaps) are always present; the rest are added when the role
// has a job and the recruiter ranker produced a full breakdown (group-eval-run).
export type EvalCandidate = {
  label: string;
  score: number;
  seniority: string | null;
  archetype?: string | null;
  verdict: string;
  strengths: string[];
  gaps: string[];
  interviewProbes?: string[];
  fitTier?: "strong" | "promising" | "partial";
  confidence?: Confidence;
  scoreBreakdown?: ScoreDimension[];
  matchedSkills?: string[];
  matchedSkillProvenance?: Record<string, string>;
  matchedSkillStrength?: Record<string, number>;
  missingSkills?: string[];
  potentialScore?: number | null;
  koPassed?: boolean;
  assumptions?: string[];
  // The candidate's own salary expectation (from their CV analysis). Absent for
  // profile-only candidates; the salary section then shows just the role band.
  salaryExpectation?: { minimum: number; maximum: number; midpoint: number; currency: string; confidence: string } | null;
};

export type GroupEvalPayload = {
  roleTitle?: string;
  source?: string;
  topPick?: { label: string; score: number; why: string } | null;
  recommendedOrder?: string[];
  candidates?: EvalCandidate[];
  differentiators?: string[];
  risks?: string[];
  summary?: string;
  // Structured AI head-to-head narrative (the modal prefers it); `comparisonSummary`
  // is the flat, bold-stripped legacy string.
  comparison?: Comparison | null;
  comparisonSummary?: string | null;
  comparisonSource?: string | null;
  // Canonical role requirements (must-have first) for the skills matrix rows.
  requirements?: { skill: string; kind: string }[];
  // The role's recommended salary band [min, max] — the reference the salary
  // comparison plots each candidate's expectation against. Empty for a job-less role.
  roleSalaryBand?: number[];
  // Coverage bookkeeping (group-eval-run): the top `cap` of `totalCandidates`
  // were compared, sorted by fit. `evaluatedLabels` is the pre-cap pool used to
  // detect drift against the role's current pending entries.
  totalCandidates?: number;
  cap?: number;
  capped?: boolean;
  evaluatedLabels?: string[];
};

const sourceLabel = (s?: string) => (s === "llm" ? "Claude/Gemini" : s === "partial" ? "Partial (some AI)" : "Deterministic");

const ranWhen = (iso?: string | null): string | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString() : null;
};

const initialsOf = (label: string) =>
  label.split(/\s+/).map((p) => p[0]).filter(Boolean).join("").slice(0, 2).toUpperCase() || "?";

// Canonical skill-matrix rows: the role's requirements (must-have first), else the
// union of every matched/missing skill (a skill is "missing" only when must-have).
function buildSkillRows(candidates: EvalCandidate[], requirements: { skill: string; kind: string }[]) {
  let rows: { skill: string; mustHave: boolean }[];
  if (requirements.length) {
    rows = requirements.map((r) => ({ skill: r.skill, mustHave: r.kind === "must_have" }));
  } else {
    const union = new Set<string>();
    const must = new Set<string>();
    for (const c of candidates) {
      (c.matchedSkills ?? []).forEach((s) => union.add(s));
      (c.missingSkills ?? []).forEach((s) => {
        union.add(s);
        must.add(s);
      });
    }
    rows = [...union].map((s) => ({ skill: s, mustHave: must.has(s) }));
  }
  rows.sort((a, b) => Number(b.mustHave) - Number(a.mustHave) || a.skill.localeCompare(b.skill));
  return { rows, mustRows: rows.filter((r) => r.mustHave).map((r) => r.skill) };
}

export function GroupEvalModal({
  roleTitle,
  evaluation,
  loading,
  createdAt,
  poolDrift,
  onClose,
  onRerun,
}: {
  roleTitle: string;
  evaluation: GroupEvalPayload | null;
  loading: boolean;
  /** When the cached evaluation was generated (ISO); null for a fresh run. */
  createdAt?: string | null;
  /** How many candidates were added/removed from the role's pool since this
   *  evaluation ran. > 0 means the comparison may be stale. */
  poolDrift?: number;
  onClose: () => void;
  onRerun: () => void;
}) {
  const ranAt = ranWhen(createdAt);
  const drift = poolDrift ?? 0;
  const candidates = evaluation?.candidates ?? [];
  // Enriched layout (matrices) only when the recruiter breakdown is present;
  // otherwise fall back to the compact text view so legacy/simulation payloads
  // and job-less roles still render correctly.
  const enriched = candidates.some((c) => (c.scoreBreakdown?.length ?? 0) > 0);
  const { rows: skillRows, mustRows } = buildSkillRows(candidates, evaluation?.requirements ?? []);
  const aiBacked = Boolean(evaluation?.comparison) && evaluation?.comparisonSource === "llm";

  return (
    <Modal
      size="full"
      title={`Group evaluation · ${roleTitle}`}
      subtitle={evaluation ? `Source: ${sourceLabel(evaluation.source)}${ranAt ? ` · ran ${ranAt}` : ""}` : undefined}
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={onRerun}
          disabled={loading}
          className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
        >
          <RefreshCw size={14} /> {loading ? "Generating…" : "Re-run"}
        </button>
      }
    >
      {loading && !evaluation ? (
        <p className="flex items-center gap-2 text-sm text-steel">
          <Loader2 size={16} className="animate-spin text-coral" /> Generating group evaluation across the role&apos;s candidates…
        </p>
      ) : !evaluation ? (
        <p className="text-sm text-steel">No evaluation yet — run one to compare this role&apos;s candidates.</p>
      ) : (
        <div className="space-y-5">
          <Notices drift={drift} ranAt={ranAt} evaluation={evaluation} />
          <AiVerdict comparison={evaluation.comparison} fallback={evaluation.comparisonSummary || evaluation.summary} aiBacked={aiBacked} />

          {enriched ? (
            <>
              <CandidateHeroStrip candidates={candidates} mustRows={mustRows} />
              <ScoreMatrix candidates={candidates} />
              <SkillsMatrix candidates={candidates} skillRows={skillRows} mustRows={mustRows} />
              <SalaryComparison candidates={candidates} roleBand={evaluation.roleSalaryBand ?? []} />
              <PerCandidateDetail candidates={candidates} differentiators={evaluation.differentiators ?? []} topPick={evaluation.topPick?.label} />
            </>
          ) : (
            <LegacyView evaluation={evaluation} />
          )}

          <Risks risks={evaluation.risks ?? []} />
        </div>
      )}
    </Modal>
  );
}

// ---- Primitives -----------------------------------------------------------

const PILL_TONE: Record<string, string> = {
  neutral: "bg-stone-100 text-steel",
  moss: "bg-moss/15 text-moss",
  coral: "bg-coral/10 text-coral",
  amber: "bg-amber-100 text-amber-700",
  info: "bg-blue-50 text-blue-700",
};

function Pill({ children, tone = "neutral", className = "" }: { children: React.ReactNode; tone?: keyof typeof PILL_TONE; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${PILL_TONE[tone]} ${className}`}>{children}</span>
  );
}

// Minimal inline markdown: render **bold** spans as <strong>; everything else verbatim.
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="font-semibold text-ink">
            {p.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

function Avatar({ label, archetype }: { label: string; archetype?: string | null }) {
  const s = styleFor(archetype ?? null);
  return (
    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-semibold text-white ${s.bg}`} title={s.label}>
      {initialsOf(label)}
    </span>
  );
}

function ArchetypeTag({ archetype }: { archetype?: string | null }) {
  const s = styleFor(archetype ?? null);
  return (
    <Pill>
      <span className={`h-2 w-2 rounded-full ${s.bg}`} aria-hidden /> {s.label}
    </Pill>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-meta uppercase tracking-wide text-steel">{children}</h3>;
}

function Notices({ drift, ranAt, evaluation }: { drift: number; ranAt: string | null; evaluation: GroupEvalPayload }) {
  return (
    <>
      {drift > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            <b>{drift} candidate{drift === 1 ? "" : "s"} changed</b> since this evaluation ran
            {ranAt ? ` (${ranAt})` : ""}. The ranking below may exclude a newly added candidate or
            recommend one already decided — re-run for an up-to-date comparison.
          </span>
        </div>
      ) : null}
      {evaluation.capped ? (
        <p className="text-meta text-steel">
          Showing top {evaluation.cap ?? evaluation.candidates?.length} of {evaluation.totalCandidates} candidates, ranked by fit.
        </p>
      ) : null}
    </>
  );
}

// ---- AI verdict (formatted, bold) -----------------------------------------

function AiVerdict({ comparison, fallback, aiBacked }: { comparison?: Comparison | null; fallback?: string; aiBacked: boolean }) {
  if (!comparison && !fallback) return null;
  return (
    <section className="rounded-xl border border-stone-200 bg-paper/40 p-4">
      <div className="mb-1.5 flex items-center gap-2">
        <Sparkles size={14} className="text-coral" aria-hidden />
        <span className="text-meta uppercase tracking-wide text-steel">AI comparison</span>
        <Pill tone={aiBacked ? "info" : "neutral"}>{aiBacked ? "AI" : "rule-based"}</Pill>
      </div>
      {comparison ? (
        <>
          <p className="font-serif text-h3 leading-snug text-ink">
            <RichText text={comparison.headline} />
          </p>
          {comparison.keyPoints.length ? (
            <ul className="mt-3 grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
              {comparison.keyPoints.map((p, i) => (
                <li key={i} className="flex gap-2 text-sm text-steel">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-coral/60" aria-hidden />
                  <span>
                    <RichText text={p} />
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {comparison.recommendation ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-moss/30 bg-moss/5 p-2.5 text-sm text-ink">
              <ArrowRight size={15} className="mt-0.5 shrink-0 text-moss" aria-hidden />
              <span>
                <RichText text={comparison.recommendation} />
              </span>
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-base text-ink">{fallback}</p>
      )}
    </section>
  );
}

// ---- Candidate hero strip (glanceable stat cards) -------------------------

function HeroCard({ c, rank, isLead, mustRows }: { c: EvalCandidate; rank: number; isLead: boolean; mustRows: string[] }) {
  const tone = scoreTone(c.score);
  const matchedMust = mustRows.filter((s) => (c.matchedSkills ?? []).includes(s)).length;
  return (
    <div className={`flex min-w-[200px] flex-1 flex-col rounded-xl border p-3 ${isLead ? "border-moss/50 bg-moss/5 shadow-panel" : "border-stone-200 bg-white"}`}>
      <div className="flex items-center justify-between">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-ink/85 text-[11px] font-semibold text-white tabular-nums">{rank}</span>
        {isLead ? (
          <Pill tone="moss">
            <Crown size={11} /> Lead
          </Pill>
        ) : c.koPassed === false ? (
          <Pill tone="coral">KO</Pill>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Avatar label={c.label} archetype={c.archetype} />
        <span className="min-w-0">
          <span className="block truncate font-semibold text-ink">{c.label}</span>
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <ArchetypeTag archetype={c.archetype} />
        {c.seniority ? <Pill>{c.seniority}</Pill> : null}
      </div>
      <div className="mt-2 flex items-end gap-2">
        <span className="font-serif text-[30px] leading-none tabular-nums" style={{ color: scoreToneColor(tone) }}>
          {c.score}
        </span>
        <span className="pb-0.5">
          <FitTierBadge tier={c.fitTier} score={c.score} />
        </span>
      </div>
      {c.confidence ? (
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="nums text-[11px] text-steel" title={confidenceBandTitle(c.confidence.drivers)}>
            {c.confidence.low}–{c.confidence.high}
          </span>
          <ConfidenceBandBadge level={c.confidence.level} drivers={c.confidence.drivers} />
        </div>
      ) : null}
      {mustRows.length ? (
        <div className="mt-auto pt-2.5">
          <div className="flex items-center justify-between text-[11px] text-steel">
            <span className="uppercase tracking-wide">Must-haves</span>
            <span className="font-semibold tabular-nums text-ink">
              {matchedMust}/{mustRows.length}
            </span>
          </div>
          <div className="mt-1 flex gap-0.5" aria-hidden>
            {mustRows.map((_, i) => (
              <span key={i} className={`h-1.5 flex-1 rounded-full ${i < matchedMust ? "bg-moss" : "bg-stone-200"}`} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CandidateHeroStrip({ candidates, mustRows }: { candidates: EvalCandidate[]; mustRows: string[] }) {
  return (
    <section>
      <SectionTitle>Candidates at a glance</SectionTitle>
      <div className="mt-2 flex gap-3 overflow-x-auto pb-1">
        {candidates.map((c, i) => (
          <HeroCard key={c.label} c={c} rank={i + 1} isLead={i === 0} mustRows={mustRows} />
        ))}
      </div>
    </section>
  );
}

// ---- Score matrix (dimension × candidate) ---------------------------------

function ScoreMatrix({ candidates }: { candidates: EvalCandidate[] }) {
  const dims: { key: string; label: string; weight: number }[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    for (const d of c.scoreBreakdown ?? []) {
      if (!seen.has(d.key)) {
        seen.add(d.key);
        dims.push({ key: d.key, label: d.label, weight: d.weight });
      }
    }
  }
  if (!dims.length) return null;
  const percentOf = (c: EvalCandidate, key: string) => c.scoreBreakdown?.find((d) => d.key === key)?.percent ?? null;
  const leaderFor = (key: string) => Math.max(...candidates.map((c) => percentOf(c, key) ?? -1));

  return (
    <section>
      <SectionTitle>Score breakdown</SectionTitle>
      <div className="mt-2 overflow-x-auto rounded-lg border border-stone-200">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-stone-200 bg-paper/60">
              <th className="sticky left-0 z-10 bg-paper/60 px-3 py-2 text-left text-meta uppercase tracking-wide text-steel">Dimension</th>
              {candidates.map((c) => (
                <th key={c.label} className="min-w-[170px] px-3 py-2 text-left font-normal">
                  <span className="flex items-center gap-1.5">
                    <Avatar label={c.label} archetype={c.archetype} />
                    <span className="truncate font-semibold text-ink">{c.label}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dims.map((d) => {
              const leader = leaderFor(d.key);
              return (
                <tr key={d.key} className="border-b border-stone-100 last:border-0">
                  <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left align-middle">
                    <span className="block font-semibold uppercase tracking-wide text-steel">{d.label}</span>
                    <span className="block text-[11px] text-steel">weight {d.weight}%</span>
                  </th>
                  {candidates.map((c) => {
                    const pct = percentOf(c, d.key);
                    const isLeader = pct != null && pct === leader && candidates.length > 1;
                    return (
                      <td key={c.label} className={`px-3 py-2 align-middle ${isLeader ? "bg-moss/5" : ""}`}>
                        {pct == null ? (
                          <span className="text-steel">—</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className={`w-6 shrink-0 tabular-nums ${isLeader ? "font-semibold text-ink" : "text-ink"}`}>{pct}</span>
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100" aria-hidden>
                              <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: scoreToneColor(scoreTone(pct)) }} />
                            </span>
                            {isLeader ? <Pill tone="moss">lead</Pill> : null}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---- Skills matrix (skill × candidate) ------------------------------------

function SkillCell({ skill, c }: { skill: string; c: EvalCandidate }) {
  const matched = (c.matchedSkills ?? []).includes(skill);
  const missing = (c.missingSkills ?? []).includes(skill);
  if (matched) {
    const strength = c.matchedSkillStrength?.[skill] ?? 1;
    const strong = strength >= 0.85;
    const pl = provLabel(c.matchedSkillProvenance?.[skill] ?? "self_declared");
    return (
      <span className="inline-flex items-center gap-1" title={`match ${Math.round(strength * 100)}%${strong ? "" : " · partial (taxonomy / provenance-discounted)"}`}>
        {strong ? <CheckCircle2 size={15} className="text-moss" aria-hidden /> : <CircleDot size={15} className="text-amber-600" aria-hidden />}
        <span className={`rounded px-1 text-[10px] uppercase ${pl.tone}`}>{pl.text}</span>
        {!strong ? <span className="nums text-[11px] text-steel">{Math.round(strength * 100)}%</span> : null}
      </span>
    );
  }
  if (missing) {
    return (
      <span className="inline-flex items-center text-red-700" title="missing must-have" aria-label="missing">
        <XCircle size={15} aria-hidden />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center text-stone-300" title="not required / not claimed" aria-label="not applicable">
      <Minus size={15} aria-hidden />
    </span>
  );
}

function SkillGroup({ label, rows, candidates }: { label: string; rows: { skill: string }[]; candidates: EvalCandidate[] }) {
  return (
    <tbody>
      <tr className="bg-paper/40">
        <td colSpan={candidates.length + 1} className="px-3 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-steel">
          {label}
        </td>
      </tr>
      {rows.map(({ skill }) => (
        <tr key={skill} className="border-b border-stone-100 last:border-0">
          <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-medium text-ink">{skill}</th>
          {candidates.map((c) => (
            <td key={c.label} className="px-3 py-2">
              <SkillCell skill={skill} c={c} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

function SkillsMatrix({
  candidates,
  skillRows,
  mustRows,
}: {
  candidates: EvalCandidate[];
  skillRows: { skill: string; mustHave: boolean }[];
  mustRows: string[];
}) {
  if (!skillRows.length) return null;
  const must = skillRows.filter((r) => r.mustHave);
  const nice = skillRows.filter((r) => !r.mustHave);
  const coverageOf = (c: EvalCandidate) => mustRows.filter((s) => (c.matchedSkills ?? []).includes(s)).length;

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2">
        <SectionTitle>Skills matrix</SectionTitle>
        <span className="flex flex-wrap items-center gap-1.5">
          <Pill tone="moss">
            <CheckCircle2 size={11} /> strong
          </Pill>
          <Pill tone="amber">
            <CircleDot size={11} /> partial
          </Pill>
          <Pill tone="coral">
            <XCircle size={11} /> missing
          </Pill>
        </span>
      </div>
      <div className="mt-2 overflow-x-auto rounded-lg border border-stone-200">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-stone-200 bg-paper/60">
              <th className="sticky left-0 z-10 bg-paper/60 px-3 py-2 text-left text-meta uppercase tracking-wide text-steel">Required skill</th>
              {candidates.map((c) => (
                <th key={c.label} className="min-w-[120px] px-3 py-2 text-left">
                  <span className="flex items-center gap-1.5">
                    <Avatar label={c.label} archetype={c.archetype} />
                    <span className="truncate font-semibold text-ink">{c.label}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          {must.length ? <SkillGroup label={`Must-have · ${must.length}`} rows={must} candidates={candidates} /> : null}
          {nice.length ? <SkillGroup label={`Nice-to-have · ${nice.length}`} rows={nice} candidates={candidates} /> : null}
          {mustRows.length ? (
            <tfoot>
              <tr className="border-t-2 border-stone-200 bg-paper/40">
                <th className="sticky left-0 z-10 bg-paper/40 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-steel">Must-have coverage</th>
                {candidates.map((c) => {
                  const n = coverageOf(c);
                  const tone = n === mustRows.length ? "text-moss" : n === 0 ? "text-red-700" : "text-amber-700";
                  return (
                    <td key={c.label} className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className={`shrink-0 font-semibold tabular-nums ${tone}`}>
                          {n}/{mustRows.length}
                        </span>
                        <span className="flex flex-1 gap-0.5" aria-hidden>
                          {mustRows.map((_, i) => (
                            <span key={i} className={`h-1.5 flex-1 rounded-full ${i < n ? "bg-moss" : "bg-stone-200"}`} />
                          ))}
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </section>
  );
}

// ---- Per-candidate detail (compact + progressive disclosure) --------------

function IconList({ title, items, icon: Icon, tone }: { title: string; items: string[]; icon: LucideIcon; tone: "moss" | "coral" | "steel" }) {
  if (!items.length) return null;
  const color = tone === "moss" ? "text-moss" : tone === "coral" ? "text-coral" : "text-steel";
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-steel">{title}</p>
      <ul className="mt-0.5 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex gap-1.5 text-sm text-ink">
            <Icon size={13} className={`mt-0.5 shrink-0 ${color}`} aria-hidden />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PerCandidateDetail({ candidates, differentiators, topPick }: { candidates: EvalCandidate[]; differentiators: string[]; topPick?: string }) {
  return (
    <section>
      <SectionTitle>Per candidate</SectionTitle>
      <div className="mt-2 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {candidates.map((c) => (
          <div key={c.label} className="rounded-xl border border-stone-200 p-3">
            <div className="flex items-center gap-2">
              <Avatar label={c.label} archetype={c.archetype} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink">{c.label}</span>
                {c.potentialScore != null ? <span className="block text-[11px] text-steel">potential {Math.round(c.potentialScore * 100)}</span> : null}
              </span>
              <ScoreBadge score={c.score} />
              <FitTierBadge tier={c.fitTier} score={c.score} />
            </div>

            {c.scoreBreakdown?.length ? <ScoreBreakdown dims={c.scoreBreakdown} total={c.score} /> : null}
            {c.verdict ? <p className="mt-2 text-sm text-ink">{c.verdict}</p> : null}

            {topPick === c.label && differentiators.length ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {differentiators.map((s) => (
                  <Pill key={s} tone="moss">
                    {s}
                  </Pill>
                ))}
              </div>
            ) : null}

            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <IconList title="Strengths" items={c.strengths.slice(0, 3)} icon={CheckCircle2} tone="moss" />
              <IconList title="Gaps" items={c.gaps.slice(0, 3)} icon={AlertTriangle} tone="coral" />
            </div>

            {c.interviewProbes?.length || c.assumptions?.length ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-steel hover:text-ink">
                  Interview probes &amp; assumptions
                </summary>
                <div className="mt-1.5 space-y-2">
                  <IconList title="Interview probes" items={c.interviewProbes ?? []} icon={CircleDot} tone="steel" />
                  {c.assumptions?.length ? (
                    <p className="text-[12px] text-steel">
                      <span className="font-semibold uppercase">Assumptions:</span> {c.assumptions[0]}
                    </p>
                  ) : null}
                </div>
              </details>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---- Salary comparison (expectation vs role recommendation) ---------------

// Verdict for a candidate's expectation midpoint against the role band [lo, hi].
function salaryVerdict(mid: number, lo: number, hi: number): { label: string; tone: keyof typeof PILL_TONE } {
  if (hi > 0 && mid > hi) return { label: `+${Math.round(((mid - hi) / hi) * 100)}% over band`, tone: "coral" };
  if (lo > 0 && mid < lo) return { label: `${Math.round(((lo - mid) / lo) * 100)}% under band`, tone: "info" };
  return { label: "within band", tone: "moss" };
}

function SalaryComparison({ candidates, roleBand }: { candidates: EvalCandidate[]; roleBand: number[] }) {
  const withSalary = candidates.filter((c) => c.salaryExpectation);
  const [lo, hi] = roleBand.length >= 2 ? [roleBand[0], roleBand[1]] : [0, 0];
  // Nothing to compare: no role band AND no candidate expectations.
  if (!withSalary.length && !(hi > 0)) return null;

  // One shared linear scale across the role band + every expectation, padded 8%,
  // so the bars are visually comparable candidate-to-candidate and to the role.
  const vals = [
    ...(hi > 0 ? [lo, hi] : []),
    ...withSalary.flatMap((c) => [c.salaryExpectation!.minimum, c.salaryExpectation!.maximum]),
  ].filter((n) => n > 0);
  const loScale = Math.min(...vals);
  const hiScale = Math.max(...vals);
  const span = hiScale - loScale || 1;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - loScale) / span) * 100));

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2">
        <SectionTitle>Salary · expectation vs recommendation</SectionTitle>
        {hi > 0 ? (
          <Pill tone="info">
            Role band {formatCzk(lo)}–{formatCzk(hi)}
          </Pill>
        ) : (
          <Pill>No role band set</Pill>
        )}
      </div>
      <div className="mt-2 space-y-2 rounded-lg border border-stone-200 p-3">
        {candidates.map((c) => {
          const s = c.salaryExpectation;
          const verdict = s && hi > 0 ? salaryVerdict(s.midpoint, lo, hi) : null;
          return (
            <div key={c.label} className="grid grid-cols-[minmax(120px,180px)_1fr] items-center gap-3">
              <div className="flex items-center gap-2">
                <Avatar label={c.label} archetype={c.archetype} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{c.label}</span>
                  {s ? (
                    <span className="block text-[11px] text-steel">
                      expects {formatCzk(s.minimum)}–{formatCzk(s.maximum)}
                    </span>
                  ) : (
                    <span className="block text-[11px] text-steel">no expectation on file</span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative h-6 flex-1 overflow-hidden rounded-md bg-stone-100">
                  {/* role band reference zone */}
                  {hi > 0 ? (
                    <span
                      className="absolute inset-y-0 bg-moss/15 ring-1 ring-inset ring-moss/30"
                      style={{ left: `${pct(lo)}%`, width: `${Math.max(1, pct(hi) - pct(lo))}%` }}
                      aria-hidden
                    />
                  ) : null}
                  {/* candidate expectation range + midpoint */}
                  {s ? (
                    <>
                      <span
                        className="absolute inset-y-1.5 rounded-full bg-ink/70"
                        style={{ left: `${pct(s.minimum)}%`, width: `${Math.max(1.5, pct(s.maximum) - pct(s.minimum))}%` }}
                        aria-hidden
                      />
                      <span
                        className="absolute inset-y-0.5 w-0.5 bg-coral"
                        style={{ left: `${pct(s.midpoint)}%` }}
                        title={`expected midpoint ${formatCzk(s.midpoint)}`}
                        aria-hidden
                      />
                    </>
                  ) : null}
                </div>
                {verdict ? <Pill tone={verdict.tone}>{verdict.label}</Pill> : null}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-1 text-[11px] text-steel">
        Green zone = role&apos;s recommended band · dark bar = candidate&apos;s expected range · coral tick = their midpoint.
      </p>
    </section>
  );
}

function Risks({ risks }: { risks: string[] }) {
  if (!risks.length) return null;
  return (
    <section>
      <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-coral">
        <AlertTriangle size={13} /> Watch-outs · {risks.length}
      </p>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {risks.map((r, i) => (
          <div key={i} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-2 text-sm text-amber-900">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>{r}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---- Legacy fallback (no recruiter breakdown: job-less role, old saved eval,
// or the simulation's loading payload) ------------------------------------
function LegacyView({ evaluation }: { evaluation: GroupEvalPayload }) {
  return (
    <div className="space-y-4">
      {evaluation.topPick ? (
        <div className="rounded-lg border border-moss/30 bg-moss/5 p-3">
          <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-moss">
            <Sparkles size={13} /> Recommended lead
          </p>
          <p className="mt-1 flex items-center gap-2 font-serif text-h3 text-ink">
            {evaluation.topPick.label} <ScoreBadge score={evaluation.topPick.score} />
          </p>
          {evaluation.topPick.why ? <p className="mt-1 text-sm text-steel">{evaluation.topPick.why}</p> : null}
        </div>
      ) : null}

      {evaluation.candidates?.length ? (
        <section>
          <SectionTitle>Per candidate</SectionTitle>
          <div className="mt-2 grid gap-2 lg:grid-cols-2">
            {evaluation.candidates.map((c, i) => (
              <div key={i} className="rounded-md border border-stone-200 p-2.5">
                <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                  {c.label}
                  <ScoreBadge score={c.score} />
                  {c.seniority ? <span className="font-normal text-steel">{c.seniority}</span> : null}
                </p>
                {c.verdict ? <p className="mt-0.5 text-sm text-ink">{c.verdict}</p> : null}
                <div className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
                  {c.strengths.length ? <p><span className="font-semibold text-moss">+ </span>{c.strengths.slice(0, 3).join("; ")}</p> : null}
                  {c.gaps.length ? <p><span className="font-semibold text-coral">! </span>{c.gaps.slice(0, 3).join("; ")}</p> : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {evaluation.differentiators?.length ? (
        <p className="text-sm text-ink">
          <span className="font-semibold">Differentiators (lead):</span> {evaluation.differentiators.join(", ")}
        </p>
      ) : null}
    </div>
  );
}
