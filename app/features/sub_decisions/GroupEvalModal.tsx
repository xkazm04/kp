"use client";

import { useState } from "react";
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
import { initials } from "@/app/_lib/initials";
import { styleFor } from "./DecisionsTypes";

// Structured, bold-formatted head-to-head narrative (group_compare_cli). Bold
// spans are marked with **double asterisks** for RichText to render as <strong>.
export type Comparison = { headline: string; keyPoints: string[]; recommendation?: string };

// Cross-scheme fairness matrix (recruiter.fairness_check, via group-eval-run):
// each candidate carries a bounded dynamic weight vector and is re-scored under
// EVERY candidate's scheme, so a pool weighted differently per candidate ranks
// honestly (by the mean). labels / candidateIds / schemes / own / mean align by
// index; weightNotes is keyed by candidateId.
export type FairnessScheme = { skills: number; career: number; personal: number };
export type Fairness = {
  labels: string[];
  candidateIds: string[];
  schemes: FairnessScheme[];
  matrix: number[][];
  own: number[];
  mean: number[];
  ranking: string[];
  weightNotes: Record<string, string[]>;
  // "llm" when the weights were proposed by the AI (within bounds), else "deterministic".
  weightSource?: string;
};

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
  // profile-only candidates; the salary row then shows just the role band.
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
  // Structured AI head-to-head narrative (the modal prefers it).
  comparison?: Comparison | null;
  comparisonSource?: string | null;
  // Canonical role requirements (must-have first) for the skills rows.
  requirements?: { skill: string; kind: string }[];
  // The role's recommended salary band [min, max] — the reference the salary
  // row plots each candidate's expectation against. Empty for a job-less role.
  roleSalaryBand?: number[];
  // Cross-scheme fairness matrix. Null for a job-less role or if the ranker failed.
  fairness?: Fairness | null;
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

const percentOf = (c: EvalCandidate, key: string) => c.scoreBreakdown?.find((d) => d.key === key)?.percent ?? null;
const coverageCount = (c: EvalCandidate, mustRows: string[]) => mustRows.filter((s) => (c.matchedSkills ?? []).includes(s)).length;

// Canonical skill rows: the role's requirements (must-have first), else the union
// of every matched/missing skill (a skill is "missing" only when must-have).
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
  error,
  createdAt,
  poolDrift,
  onClose,
  onRerun,
}: {
  roleTitle: string;
  evaluation: GroupEvalPayload | null;
  loading: boolean;
  /** Explicit unavailable/timed-out message. When set (and there's no evaluation),
   *  the modal shows an honest "evaluation unavailable" notice instead of the
   *  ambiguous "no evaluation yet" empty state — used by the simulation when the
   *  group-eval poll times out. */
  error?: string | null;
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
  // Enriched layout (the comparison table) only when the recruiter breakdown is
  // present; otherwise fall back to the compact text view so legacy/simulation
  // payloads and job-less roles still render correctly.
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
          className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-stone-200 px-3 text-base font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
        >
          <RefreshCw size={14} /> {loading ? "Generating…" : "Re-run"}
        </button>
      }
    >
      {loading && !evaluation ? (
        <p className="flex items-center gap-2 text-base text-steel">
          <Loader2 size={16} className="animate-spin text-coral" /> Generating group evaluation across the role&apos;s candidates…
        </p>
      ) : error && !evaluation ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-base text-amber-900">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold">Evaluation unavailable.</span> {error}
          </span>
        </div>
      ) : !evaluation ? (
        <p className="text-base text-steel">No evaluation yet — run one to compare this role&apos;s candidates.</p>
      ) : (
        <div className="space-y-5">
          <Notices drift={drift} ranAt={ranAt} evaluation={evaluation} />
          <AiVerdict comparison={evaluation.comparison} fallback={evaluation.summary} aiBacked={aiBacked} />

          {enriched ? (
            <>
              <ComparisonTable candidates={candidates} skillRows={skillRows} mustRows={mustRows} roleBand={evaluation.roleSalaryBand ?? []} />
              <FairnessPanel fairness={evaluation.fairness ?? null} headlineOrder={evaluation.recommendedOrder ?? []} />
              <PerCandidateTabs candidates={candidates} differentiators={evaluation.differentiators ?? []} topPick={evaluation.topPick?.label} />
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
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm font-semibold ${PILL_TONE[tone]} ${className}`}>{children}</span>
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

function Avatar({ label, archetype, size = "md" }: { label: string; archetype?: string | null; size?: "sm" | "md" }) {
  const s = styleFor(archetype ?? null);
  const dim = size === "sm" ? "h-6 w-6 text-sm" : "h-8 w-8 text-base";
  return (
    <span className={`grid ${dim} shrink-0 place-items-center rounded-full font-semibold text-white ${s.bg}`} title={s.label}>
      {initials(label, "?")}
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
  return <h3 className="text-sm font-semibold uppercase tracking-wide text-steel">{children}</h3>;
}

function Notices({ drift, ranAt, evaluation }: { drift: number; ranAt: string | null; evaluation: GroupEvalPayload }) {
  return (
    <>
      {drift > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-base text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            <b>{drift} candidate{drift === 1 ? "" : "s"} changed</b> since this evaluation ran
            {ranAt ? ` (${ranAt})` : ""}. The ranking below may exclude a newly added candidate or
            recommend one already decided — re-run for an up-to-date comparison.
          </span>
        </div>
      ) : null}
      {evaluation.capped ? (
        <p className="text-sm text-steel">
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
        <Sparkles size={15} className="text-coral" aria-hidden />
        <span className="text-sm font-semibold uppercase tracking-wide text-steel">AI comparison</span>
        <Pill tone={aiBacked ? "info" : "neutral"}>{aiBacked ? "AI" : "rule-based"}</Pill>
      </div>
      {comparison ? (
        <>
          <p className="font-serif text-h3 leading-snug text-ink">
            <RichText text={comparison.headline} />
          </p>
          {comparison.keyPoints.length ? (
            <ul className="mt-3 grid gap-x-5 gap-y-2 sm:grid-cols-2">
              {comparison.keyPoints.map((p, i) => (
                <li key={i} className="flex gap-2 text-base text-steel">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-coral/60" aria-hidden />
                  <span>
                    <RichText text={p} />
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {comparison.recommendation ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-moss/30 bg-moss/5 p-2.5 text-base text-ink">
              <ArrowRight size={16} className="mt-0.5 shrink-0 text-moss" aria-hidden />
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

// ---- One comparison table (candidates = columns, attributes = grouped rows) ---
// Candidate identity lives ONLY in the sticky header; every section below reuses
// the same fixed column layout, so widths line up across Overview / Score / Skills
// / Salary and the eye scans straight down a candidate's column.

function CandidateHeader({ c, rank, isLead }: { c: EvalCandidate; rank: number; isLead: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ink/85 text-sm font-semibold text-white tabular-nums">{rank}</span>
      <Avatar label={c.label} archetype={c.archetype} size="sm" />
      <div className="min-w-0">
        <div className="truncate font-semibold text-ink">{c.label}</div>
        {isLead ? (
          <Pill tone="moss">
            <Crown size={12} /> Lead
          </Pill>
        ) : c.koPassed === false ? (
          <Pill tone="coral">KO</Pill>
        ) : null}
      </div>
    </div>
  );
}

function GroupTr({ label, cols, aside }: { label: string; cols: number; aside?: React.ReactNode }) {
  return (
    <tr className="bg-paper/60">
      <td colSpan={cols} className="border-y border-stone-200 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="h-3.5 w-1 rounded-full bg-coral/50" aria-hidden />
          <span className="text-sm font-semibold uppercase tracking-wide text-steel">{label}</span>
          {aside}
        </div>
      </td>
    </tr>
  );
}

function SubGroupTr({ label, cols }: { label: string; cols: number }) {
  return (
    <tr className="bg-paper/30">
      <td colSpan={cols} className="px-3 py-1 text-sm font-semibold uppercase tracking-wide text-steel">
        {label}
      </td>
    </tr>
  );
}

function RowHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <>
      <span className="block text-sm font-semibold uppercase tracking-wide text-steel">{title}</span>
      {sub ? <span className="block text-sm font-normal normal-case text-steel">{sub}</span> : null}
    </>
  );
}

// A generic comparison row: a sticky label cell + one value cell per candidate.
// `leaderValue` (when given) tints the winning cell so the column comparison reads
// without hunting for the highest number.
function Row({
  head,
  candidates,
  render,
  leaderValue,
}: {
  head: React.ReactNode;
  candidates: EvalCandidate[];
  render: (c: EvalCandidate, isLeader: boolean) => React.ReactNode;
  leaderValue?: (c: EvalCandidate) => number;
}) {
  const leader = leaderValue && candidates.length > 1 ? Math.max(...candidates.map(leaderValue)) : null;
  return (
    <tr className="border-b border-stone-100 last:border-0">
      <th scope="row" className="sticky left-0 z-10 bg-white px-3 py-2 text-left align-middle">
        {head}
      </th>
      {candidates.map((c) => {
        const isLeader = leader != null && leader > -Infinity && leaderValue!(c) === leader;
        return (
          <td key={c.label} className={`px-3 py-2 align-middle ${isLeader ? "bg-moss/5" : ""}`}>
            {render(c, isLeader)}
          </td>
        );
      })}
    </tr>
  );
}

const Dash = () => <span className="text-stone-300">—</span>;

function FitCell({ c }: { c: EvalCandidate }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-serif text-[26px] leading-none tabular-nums" style={{ color: scoreToneColor(scoreTone(c.score)) }}>
        {c.score}
      </span>
      <FitTierBadge tier={c.fitTier} score={c.score} />
    </div>
  );
}

function ConfidenceCell({ c }: { c: EvalCandidate }) {
  if (!c.confidence) return <Dash />;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="nums text-sm text-steel" title={confidenceBandTitle(c.confidence.drivers)}>
        {c.confidence.low}–{c.confidence.high}
      </span>
      <ConfidenceBandBadge level={c.confidence.level} drivers={c.confidence.drivers} />
    </div>
  );
}

function ProfileCell({ c }: { c: EvalCandidate }) {
  return (
    <div className="flex flex-wrap gap-1">
      <ArchetypeTag archetype={c.archetype} />
      {c.seniority ? <Pill>{c.seniority}</Pill> : null}
      {c.potentialScore != null ? <Pill>potential {Math.round(c.potentialScore * 100)}</Pill> : null}
    </div>
  );
}

function CoverageCell({ c, mustRows }: { c: EvalCandidate; mustRows: string[] }) {
  const n = coverageCount(c, mustRows);
  const tone = n === mustRows.length ? "text-moss" : n === 0 ? "text-red-700" : "text-amber-700";
  return (
    <div>
      <span className={`text-sm font-semibold tabular-nums ${tone}`}>
        {n}/{mustRows.length}
      </span>
      <div className="mt-1 flex gap-0.5" aria-hidden>
        {mustRows.map((_, i) => (
          <span key={i} className={`h-2 flex-1 rounded-full ${i < n ? "bg-moss" : "bg-stone-200"}`} />
        ))}
      </div>
    </div>
  );
}

function DimCell({ c, dimKey, isLeader }: { c: EvalCandidate; dimKey: string; isLeader: boolean }) {
  const pct = percentOf(c, dimKey);
  if (pct == null) return <Dash />;
  return (
    <div className="flex items-center gap-2">
      <span className={`w-7 shrink-0 tabular-nums ${isLeader ? "font-semibold text-ink" : "text-ink"}`}>{pct}</span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100" aria-hidden>
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: scoreToneColor(scoreTone(pct)) }} />
      </span>
      {isLeader ? <Pill tone="moss">lead</Pill> : null}
    </div>
  );
}

function SkillsLegend() {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Pill tone="moss">
        <CheckCircle2 size={12} /> strong
      </Pill>
      <Pill tone="amber">
        <CircleDot size={12} /> partial
      </Pill>
      <Pill tone="coral">
        <XCircle size={12} /> missing
      </Pill>
    </span>
  );
}

function SkillCell({ skill, c }: { skill: string; c: EvalCandidate }) {
  const matched = (c.matchedSkills ?? []).includes(skill);
  const missing = (c.missingSkills ?? []).includes(skill);
  if (matched) {
    const strength = c.matchedSkillStrength?.[skill] ?? 1;
    const strong = strength >= 0.85;
    const pl = provLabel(c.matchedSkillProvenance?.[skill] ?? "self_declared");
    return (
      <span className="inline-flex items-center gap-1" title={`match ${Math.round(strength * 100)}%${strong ? "" : " · partial (taxonomy / provenance-discounted)"}`}>
        {strong ? <CheckCircle2 size={16} className="text-moss" aria-hidden /> : <CircleDot size={16} className="text-amber-600" aria-hidden />}
        <span className={`rounded px-1 text-sm uppercase ${pl.tone}`}>{pl.text}</span>
        {!strong ? <span className="nums text-sm text-steel">{Math.round(strength * 100)}%</span> : null}
      </span>
    );
  }
  if (missing) {
    return (
      <span className="inline-flex items-center text-red-700" title="missing must-have" aria-label="missing">
        <XCircle size={16} aria-hidden />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center text-stone-300" title="not required / not claimed" aria-label="not applicable">
      <Minus size={16} aria-hidden />
    </span>
  );
}

// Verdict for a candidate's expectation midpoint against the role band [lo, hi].
function salaryVerdict(mid: number, lo: number, hi: number): { label: string; tone: keyof typeof PILL_TONE } {
  if (hi > 0 && mid > hi) return { label: `+${Math.round(((mid - hi) / hi) * 100)}% over`, tone: "coral" };
  if (lo > 0 && mid < lo) return { label: `${Math.round(((lo - mid) / lo) * 100)}% under`, tone: "info" };
  return { label: "within band", tone: "moss" };
}

type SalaryScale = { lo: number; hi: number; pct: (v: number) => number };

function SalaryCell({ c, sal }: { c: EvalCandidate; sal: SalaryScale }) {
  const s = c.salaryExpectation;
  const verdict = s && sal.hi > 0 ? salaryVerdict(s.midpoint, sal.lo, sal.hi) : null;
  return (
    <div className="space-y-1">
      <div className="relative h-5 overflow-hidden rounded-md bg-stone-100">
        {sal.hi > 0 ? (
          <span
            className="absolute inset-y-0 bg-moss/15 ring-1 ring-inset ring-moss/30"
            style={{ left: `${sal.pct(sal.lo)}%`, width: `${Math.max(1, sal.pct(sal.hi) - sal.pct(sal.lo))}%` }}
            aria-hidden
          />
        ) : null}
        {s ? (
          <>
            <span
              className="absolute inset-y-1 rounded-full bg-ink/70"
              style={{ left: `${sal.pct(s.minimum)}%`, width: `${Math.max(1.5, sal.pct(s.maximum) - sal.pct(s.minimum))}%` }}
              aria-hidden
            />
            <span className="absolute inset-y-0 w-0.5 bg-coral" style={{ left: `${sal.pct(s.midpoint)}%` }} title={`midpoint ${formatCzk(s.midpoint)}`} aria-hidden />
          </>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-1">
        <span className="text-sm text-steel">{s ? `${formatCzk(s.minimum)}–${formatCzk(s.maximum)}` : "no expectation"}</span>
        {verdict ? <Pill tone={verdict.tone}>{verdict.label}</Pill> : null}
      </div>
    </div>
  );
}

function ComparisonTable({
  candidates,
  skillRows,
  mustRows,
  roleBand,
}: {
  candidates: EvalCandidate[];
  skillRows: { skill: string; mustHave: boolean }[];
  mustRows: string[];
  roleBand: number[];
}) {
  const cols = candidates.length + 1;

  // Dimension rows: union of breakdown keys (skills/career/personal), labelled
  // from the first candidate that carries each (archetype-aware labels).
  const dims: { key: string; label: string; weight: number }[] = [];
  const seenDim = new Set<string>();
  for (const c of candidates) {
    for (const d of c.scoreBreakdown ?? []) {
      if (!seenDim.has(d.key)) {
        seenDim.add(d.key);
        dims.push({ key: d.key, label: d.label, weight: d.weight });
      }
    }
  }

  const must = skillRows.filter((r) => r.mustHave);
  const nice = skillRows.filter((r) => !r.mustHave);

  // Salary: one shared scale across the role band + every expectation so the bars
  // are comparable column-to-column (and align, since columns are equal width).
  const [lo, hi] = roleBand.length >= 2 ? [roleBand[0], roleBand[1]] : [0, 0];
  const withSalary = candidates.filter((c) => c.salaryExpectation);
  const showSalary = withSalary.length > 0 || hi > 0;
  const vals = [...(hi > 0 ? [lo, hi] : []), ...withSalary.flatMap((c) => [c.salaryExpectation!.minimum, c.salaryExpectation!.maximum])].filter((n) => n > 0);
  const loScale = vals.length ? Math.min(...vals) : 0;
  const hiScale = vals.length ? Math.max(...vals) : 1;
  const span = hiScale - loScale || 1;
  const sal: SalaryScale = { lo, hi, pct: (v) => Math.max(0, Math.min(100, ((v - loScale) / span) * 100)) };

  return (
    <section>
      <SectionTitle>Comparison</SectionTitle>
      <div className="mt-2 overflow-x-auto rounded-xl border border-stone-200">
        <table className="w-full min-w-[60rem] table-fixed border-collapse text-base">
          <colgroup>
            <col className="w-[12.5rem]" />
            {candidates.map((c) => (
              <col key={c.label} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 top-0 z-30 border-b border-stone-200 bg-paper px-3 py-2 text-left align-bottom text-sm font-semibold uppercase tracking-wide text-steel"
              >
                Candidate →
              </th>
              {candidates.map((c, i) => (
                <th key={c.label} scope="col" className="sticky top-0 z-20 border-b border-stone-200 bg-paper px-3 py-2 text-left align-bottom font-normal">
                  <CandidateHeader c={c} rank={i + 1} isLead={i === 0} />
                </th>
              ))}
            </tr>
          </thead>

          {/* Overview */}
          <tbody>
            <GroupTr label="Overview" cols={cols} />
            <Row head={<RowHead title="Overall fit" />} candidates={candidates} leaderValue={(c) => c.score} render={(c) => <FitCell c={c} />} />
            <Row head={<RowHead title="Confidence band" />} candidates={candidates} render={(c) => <ConfidenceCell c={c} />} />
            <Row head={<RowHead title="Profile" />} candidates={candidates} render={(c) => <ProfileCell c={c} />} />
            {mustRows.length ? (
              <Row
                head={<RowHead title="Must-have coverage" />}
                candidates={candidates}
                leaderValue={(c) => coverageCount(c, mustRows)}
                render={(c) => <CoverageCell c={c} mustRows={mustRows} />}
              />
            ) : null}
          </tbody>

          {/* Score breakdown */}
          {dims.length ? (
            <tbody>
              <GroupTr label="Score breakdown" cols={cols} />
              {dims.map((d) => (
                <Row
                  key={d.key}
                  head={<RowHead title={d.label} sub={`weight ${d.weight}%`} />}
                  candidates={candidates}
                  leaderValue={(c) => percentOf(c, d.key) ?? -1}
                  render={(c, isLeader) => <DimCell c={c} dimKey={d.key} isLeader={isLeader} />}
                />
              ))}
            </tbody>
          ) : null}

          {/* Skills */}
          {skillRows.length ? (
            <tbody>
              <GroupTr label="Skills" cols={cols} aside={<SkillsLegend />} />
              {must.length ? <SubGroupTr label={`Must-have · ${must.length}`} cols={cols} /> : null}
              {must.map((r) => (
                <Row key={r.skill} head={<span className="font-medium text-ink">{r.skill}</span>} candidates={candidates} render={(c) => <SkillCell skill={r.skill} c={c} />} />
              ))}
              {nice.length ? <SubGroupTr label={`Nice-to-have · ${nice.length}`} cols={cols} /> : null}
              {nice.map((r) => (
                <Row key={r.skill} head={<span className="font-medium text-ink">{r.skill}</span>} candidates={candidates} render={(c) => <SkillCell skill={r.skill} c={c} />} />
              ))}
            </tbody>
          ) : null}

          {/* Salary */}
          {showSalary ? (
            <tbody>
              <GroupTr
                label="Salary · expectation vs band"
                cols={cols}
                aside={hi > 0 ? <Pill tone="info">role band {formatCzk(lo)}–{formatCzk(hi)}</Pill> : <Pill>no role band</Pill>}
              />
              <Row head={<RowHead title="Expected" sub="green = band · bar = range · tick = midpoint" />} candidates={candidates} render={(c) => <SalaryCell c={c} sal={sal} />} />
            </tbody>
          ) : null}
        </table>
      </div>
    </section>
  );
}

// ---- Per candidate (full-width tab switcher) ------------------------------

function IconList({ title, items, icon: Icon, tone }: { title: string; items: string[]; icon: LucideIcon; tone: "moss" | "coral" | "steel" }) {
  if (!items.length) return null;
  const color = tone === "moss" ? "text-moss" : tone === "coral" ? "text-coral" : "text-steel";
  return (
    <div>
      <p className="text-sm font-semibold uppercase tracking-wide text-steel">{title}</p>
      <ul className="mt-1 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex gap-1.5 text-base text-ink">
            <Icon size={15} className={`mt-1 shrink-0 ${color}`} aria-hidden />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// One candidate's full evaluation, laid out across the modal's full width so the
// text-heavy strengths / gaps / probes get room instead of cramped cards.
function CandidateDetail({ c, differentiators, topPick }: { c: EvalCandidate; differentiators: string[]; topPick?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar label={c.label} archetype={c.archetype} />
        <div className="min-w-0">
          <p className="font-serif text-h3 text-ink">{c.label}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <ArchetypeTag archetype={c.archetype} />
            {c.seniority ? <Pill>{c.seniority}</Pill> : null}
            {c.potentialScore != null ? <Pill>potential {Math.round(c.potentialScore * 100)}</Pill> : null}
            {c.koPassed === false ? <Pill tone="coral">KO-filtered</Pill> : null}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ScoreBadge score={c.score} />
          <FitTierBadge tier={c.fitTier} score={c.score} />
          {c.confidence ? <ConfidenceBandBadge level={c.confidence.level} drivers={c.confidence.drivers} /> : null}
        </div>
      </div>

      {c.scoreBreakdown?.length ? (
        <div className="mt-3">
          <ScoreBreakdown dims={c.scoreBreakdown} total={c.score} />
        </div>
      ) : null}

      {c.verdict ? <p className="mt-3 text-base text-ink">{c.verdict}</p> : null}

      {topPick === c.label && differentiators.length ? (
        <div className="mt-3">
          <p className="text-sm font-semibold uppercase tracking-wide text-steel">Unique strengths (lead)</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {differentiators.map((s) => (
              <Pill key={s} tone="moss">
                {s}
              </Pill>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3 grid gap-4 md:grid-cols-3">
        <IconList title="Strengths" items={c.strengths} icon={CheckCircle2} tone="moss" />
        <IconList title="Gaps" items={c.gaps} icon={AlertTriangle} tone="coral" />
        <IconList title="Interview probes" items={c.interviewProbes ?? []} icon={CircleDot} tone="steel" />
      </div>

      {c.assumptions?.length ? (
        <p className="mt-3 text-sm text-steel">
          <span className="font-semibold uppercase">Assumptions:</span> {c.assumptions.join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

function PerCandidateTabs({ candidates, differentiators, topPick }: { candidates: EvalCandidate[]; differentiators: string[]; topPick?: string }) {
  const [active, setActive] = useState(0);
  if (!candidates.length) return null;
  const idx = Math.min(active, candidates.length - 1);
  const current = candidates[idx];

  return (
    <section>
      <SectionTitle>Per candidate</SectionTitle>
      <div role="tablist" aria-label="Candidates" className="mt-2 flex flex-wrap gap-1 border-b border-stone-200">
        {candidates.map((c, i) => {
          const selected = i === idx;
          const s = styleFor(c.archetype ?? null);
          return (
            <button
              key={c.label}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(i)}
              className={`focus-ring -mb-px inline-flex items-center gap-2 rounded-t-md border-b-2 px-3 py-2 text-base font-semibold ${
                selected ? "border-coral text-ink" : "border-transparent text-steel hover:text-ink"
              }`}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${s.bg}`} aria-hidden />
              <span className="max-w-[160px] truncate">{c.label}</span>
              <ScoreBadge score={c.score} />
            </button>
          );
        })}
      </div>
      <div role="tabpanel" className="mt-3">
        <CandidateDetail c={current} differentiators={differentiators} topPick={topPick} />
      </div>
    </section>
  );
}

// ---- Fairness check (cross-scheme dynamic-weight matrix) -------------------
const fmtScheme = (s: FairnessScheme): string =>
  `S ${Math.round(s.skills * 100)} · C ${Math.round(s.career * 100)} · P ${Math.round(s.personal * 100)}`;

// Renders the fairness matrix: each candidate (row) re-scored under every
// candidate's bounded weighting (column), the mean, the robust order, and the
// per-candidate weight-adjustment notes. When no weighting was actually adjusted
// the matrix is uniform and adds nothing, so we say that plainly instead.
function FairnessPanel({ fairness, headlineOrder }: { fairness: Fairness | null; headlineOrder: string[] }) {
  if (!fairness || !fairness.labels?.length || !fairness.matrix?.length) return null;
  const { labels, schemes, matrix, mean, ranking, weightNotes, candidateIds, weightSource } = fairness;
  const adjusted = candidateIds.some((id) => (weightNotes?.[id]?.length ?? 0) > 0);

  if (!adjusted) {
    return (
      <section>
        <SectionTitle>Fairness check</SectionTitle>
        <p className="mt-1 text-base text-steel">
          Every candidate used the standard weighting for their archetype — the ranking above already compares
          like-for-like.
        </p>
      </section>
    );
  }

  const diverges = ranking.length === headlineOrder.length && ranking.some((l, i) => l !== headlineOrder[i]);

  return (
    <section>
      <div className="flex items-center gap-2">
        <SectionTitle>Fairness check</SectionTitle>
        <Pill tone={weightSource === "llm" ? "info" : "neutral"}>
          {weightSource === "llm" ? "AI-tuned weights" : "Rule-based weights"}
        </Pill>
      </div>
      <p className="mt-1 text-base text-steel">
        Some candidates carry a bounded, evidence-driven weighting — demonstrated skill is weighted higher when backed by
        high-trust evidence. Each candidate is re-scored under <em>every</em> candidate&apos;s weighting; the robust order
        is the average across all schemes, so a candidate strong under everyone&apos;s weights is robustly strong.
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white p-2 text-left text-meta uppercase text-steel">Scored candidate</th>
              {labels.map((l, j) => (
                <th key={j} className="min-w-[120px] p-2 text-left align-bottom">
                  <p className="font-medium text-ink">under {l}</p>
                  <p className="text-meta text-steel nums">{fmtScheme(schemes[j])}</p>
                </th>
              ))}
              <th className="p-2 text-left text-meta uppercase text-steel">Mean</th>
            </tr>
          </thead>
          <tbody>
            {labels.map((l, i) => (
              <tr key={i} className="border-t border-stone-100">
                <td className="sticky left-0 bg-white p-2 font-medium text-ink">{l}</td>
                {labels.map((other, j) => (
                  <td key={j} className="p-2">
                    <span
                      className={`inline-flex h-7 w-9 items-center justify-center rounded-md font-semibold nums ${
                        i === j ? "bg-coral/10 text-coral ring-1 ring-coral/30" : "bg-stone-100 text-ink"
                      }`}
                      title={i === j ? "Under their own weighting" : `${l} under ${other}'s weighting`}
                    >
                      {matrix[i][j]}
                    </span>
                  </td>
                ))}
                <td className="p-2 font-semibold text-ink nums">{mean[i]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-meta uppercase text-steel">Robust order</span>
        {ranking.map((l, i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            {i > 0 ? <ArrowRight size={12} className="text-steel" aria-hidden /> : null}
            <Pill tone={i === 0 ? "moss" : "neutral"}>{l}</Pill>
          </span>
        ))}
      </div>
      <p className={`mt-1.5 text-sm ${diverges ? "text-amber-700" : "text-steel"}`}>
        {diverges
          ? "Under each candidate's own weighting, the robust order differs from the headline fit order above — weigh the matrix before deciding."
          : "Agrees with the headline fit order above."}
      </p>

      <ul className="mt-2 space-y-1">
        {candidateIds.map((id, i) =>
          (weightNotes?.[id]?.length ?? 0) > 0 ? (
            <li key={id} className="text-sm text-ink">
              <span className="font-medium">{labels[i]}:</span>{" "}
              <span className="text-steel">{weightNotes[id].join("; ")}</span>
            </li>
          ) : null
        )}
      </ul>
    </section>
  );
}

function Risks({ risks }: { risks: string[] }) {
  if (!risks.length) return null;
  return (
    <section>
      <p className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-coral">
        <AlertTriangle size={14} /> Watch-outs · {risks.length}
      </p>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {risks.map((r, i) => (
          <div key={i} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-2 text-base text-amber-900">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
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
          <p className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-moss">
            <Sparkles size={14} /> Recommended lead
          </p>
          <p className="mt-1 flex items-center gap-2 font-serif text-h3 text-ink">
            {evaluation.topPick.label} <ScoreBadge score={evaluation.topPick.score} />
          </p>
          {evaluation.topPick.why ? <p className="mt-1 text-base text-steel">{evaluation.topPick.why}</p> : null}
        </div>
      ) : null}

      {evaluation.candidates?.length ? (
        <section>
          <SectionTitle>Per candidate</SectionTitle>
          <div className="mt-2 grid gap-2 lg:grid-cols-2">
            {evaluation.candidates.map((c, i) => (
              <div key={i} className="rounded-md border border-stone-200 p-2.5">
                <p className="flex items-center gap-2 text-base font-semibold text-ink">
                  {c.label}
                  <ScoreBadge score={c.score} />
                  {c.seniority ? <span className="font-normal text-steel">{c.seniority}</span> : null}
                </p>
                {c.verdict ? <p className="mt-0.5 text-base text-ink">{c.verdict}</p> : null}
                <div className="mt-1 grid gap-1 text-base sm:grid-cols-2">
                  {c.strengths.length ? <p><span className="font-semibold text-moss">+ </span>{c.strengths.slice(0, 3).join("; ")}</p> : null}
                  {c.gaps.length ? <p><span className="font-semibold text-coral">! </span>{c.gaps.slice(0, 3).join("; ")}</p> : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {evaluation.differentiators?.length ? (
        <p className="text-base text-ink">
          <span className="font-semibold">Differentiators (lead):</span> {evaluation.differentiators.join(", ")}
        </p>
      ) : null}
    </div>
  );
}
