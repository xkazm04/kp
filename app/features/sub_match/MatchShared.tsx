"use client";

import { AnimatePresence, motion } from "framer-motion";
import { SearchX } from "lucide-react";
import { Meter } from "@/app/_components/Meter";
import { scoreTone, scoreToneColor } from "@/app/_lib/format";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import type { KoReason, MatchResponse, Reasoning, ReasoningState, ScoreDimension } from "./MatchTypes";
import { isEarlyCareer } from "./MatchTypes";

// "Explain fit" runs as a background task, so the panel below the card swaps
// between three async states. The outer wrapper is a polite live region so a
// screen reader hears the verdict the moment it lands instead of nothing, and
// the shimmer mirrors the resolved 3-column grid so the card holds its height
// while the answer is computed. `layout` tweens the residual height delta and
// AnimatePresence crossfades the swap, turning a jarring pop into a soft reveal.
// Both effects collapse to a snap under the OS "reduce motion" preference.
export function ReasoningPanel({ state }: { state: ReasoningState }) {
  const reduced = useReducedMotion();

  const content = state.loading ? (
    <motion.div key="loading" initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0.1 : 0.15 }}>
      <ReasoningSkeleton />
      <span className="sr-only">Generating fit reasoning…</span>
    </motion.div>
  ) : state.error ? (
    <motion.p
      key="error"
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0.12 : 0.18 }}
      className="rounded-md bg-red-50 p-2 text-sm text-red-700"
    >
      {state.error}
    </motion.p>
  ) : state.data ? (
    <motion.div
      key="resolved"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0.12 : 0.24, ease: "easeOut" }}
    >
      <ResolvedReasoning r={state.data} source={state.source} cached={state.cached} />
    </motion.div>
  ) : null;

  return (
    <motion.div
      layout={!reduced}
      role="status"
      aria-live="polite"
      className="mt-3"
      transition={reduced ? { duration: 0 } : { duration: 0.25, ease: "easeOut" }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {content}
      </AnimatePresence>
    </motion.div>
  );
}

function ResolvedReasoning({ r, source, cached }: { r: Reasoning; source?: string; cached?: boolean }) {
  return (
    <div className="rounded-md border border-stone-200 bg-paper/50 p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold uppercase tracking-wide text-coral">Reasoning</span>
        <span className="rounded bg-white px-1.5 py-0.5 text-sm text-steel">
          {source === "llm" ? "LLM" : "rule-based"}
          {cached ? " · cached" : ""}
        </span>
      </div>
      <p className="mt-1 text-base text-ink">{r.verdict}</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <ReasonList title="Strengths" items={r.strengths} tone="green" />
        <ReasonList title="Gaps" items={r.gaps} tone="red" />
        <ReasonList title="Interview probes" items={r.interviewProbes} tone="neutral" />
      </div>
    </div>
  );
}

// Pulsing placeholder shaped like ResolvedReasoning (header + chip, a verdict
// line, then the three bullet columns) so swapping shimmer → answer barely
// nudges the card height. aria-hidden because the sibling sr-only line already
// voices the loading state.
function ReasoningSkeleton() {
  return (
    <div className="rounded-md border border-stone-200 bg-paper/50 p-3" aria-hidden>
      <div className="flex items-center gap-2">
        <SkelBar className="h-4 w-24" />
        <SkelBar className="h-4 w-20" />
      </div>
      <SkelBar className="mt-2 h-4 w-3/4" />
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((c) => (
          <div key={c}>
            <SkelBar className="h-3.5 w-20" />
            <div className="mt-2 space-y-1.5">
              <SkelBar className="h-3 w-full" />
              <SkelBar className="h-3 w-5/6" />
              <SkelBar className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SkelBar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-stone-200/80 motion-reduce:animate-none ${className}`} />;
}

function ReasonList({ title, items, tone }: { title: string; items: string[]; tone: "green" | "red" | "neutral" }) {
  const dot = tone === "green" ? "text-green-600" : tone === "red" ? "text-red-600" : "text-steel";
  return (
    <div>
      <p className="text-sm font-semibold uppercase tracking-wide text-steel">{title}</p>
      <ul className="mt-1 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex gap-1 text-sm text-ink">
            <span className={dot}>•</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Bar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  // Fill color tracks the score (weak -> mid -> strong), not just bar length,
  // and shares the app-wide 75/50 cutoffs via scoreTone so a bar never disagrees
  // with the badge/dial for the same number.
  const tone = scoreTone(pct);
  return (
    <div>
      <div className="flex justify-between text-sm text-steel">
        <span className="uppercase">{label}</span>
        <span className="tabular-nums tracking-tight">{pct}</span>
      </div>
      <Meter value={pct} tone={tone} className="mt-0.5" aria-label={`${label} score ${pct}`} />
    </div>
  );
}

// Weight-aware "where the score comes from" bar. Each dimension's SEGMENT WIDTH is
// its contribution (the points it adds to the total), so the highest-weighted,
// best-scoring dimension reads as visually dominant and the filled width equals the
// headline total — the trailing track is the unearned remainder (100 - total). The
// segment + legend-dot hue reuse the app-wide score scale (scoreTone) so a strong
// dimension is green here exactly as on the badge/dial. Every number is
// server-supplied (matching.build_score_breakdown): the bar carries `contribution`,
// the legend carries `percent` + `weight`, so it renders with zero client-side math
// and no 0-1 vs 0-100 scale guessing — the bug this replaces.
export function ScoreBreakdown({ dims, total }: { dims: ScoreDimension[]; total: number }) {
  const remainder = Math.max(0, 100 - total);
  return (
    <div className="mt-2 max-w-md">
      <div
        className="flex h-2 gap-px overflow-hidden rounded-full bg-stone-100"
        role="img"
        aria-label={`Score ${total} of 100 — ${dims
          .map((d) => `${d.label} contributes ${Math.round(d.contribution)} of ${d.weight} points`)
          .join(", ")}`}
      >
        {dims.map((d) => (
          <div
            key={d.key}
            style={{ flexGrow: d.contribution, backgroundColor: scoreToneColor(scoreTone(d.percent)) }}
            className="h-full"
          />
        ))}
        <div style={{ flexGrow: remainder }} className="h-full" aria-hidden />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        {dims.map((d) => (
          <div key={d.key} className="flex items-center gap-1.5 text-sm text-steel">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: scoreToneColor(scoreTone(d.percent)) }}
              aria-hidden
            />
            <span className="uppercase">{d.label}</span>
            <span className="tabular-nums tracking-tight text-ink">{d.percent}</span>
            <span className="tabular-nums tracking-tight">· {d.weight}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Next-action hint keyed off the dominant KO category — turns the "why nothing
// matched" breakdown into a single concrete thing the recruiter can do next.
const KO_HINT: Record<string, string> = {
  language: "Add the languages the candidate speaks to the profile, then re-run.",
  seniority: "These roles sit outside the candidate's level — try a profile closer to their seniority.",
  education: "The roles required a higher formal education level than the profile records.",
  work_mode: "Loosen the work-mode preference on the profile to widen the field.",
  early_career: "Few roles in this corpus are open to early-career candidates yet.",
  other: "Adjust the profile and re-run to widen the field.",
};

const roleCount = (n: number) => `${n} role${n === 1 ? "" : "s"}`;

// The KO reasons match() now rolls into meta.koReasons (matching.aggregate_ko_reasons):
// one "{n} roles {clause}" line per blocker, counts first so the worst gate reads first.
function KoReasonList({ reasons }: { reasons: KoReason[] }) {
  return (
    <ul className="mt-2 space-y-1 text-left">
      {reasons.map((r) => (
        <li key={r.key} className="flex gap-2 text-sm text-steel">
          <span className="shrink-0 font-semibold tabular-nums text-ink">{roleCount(r.count)}</span>
          <span>{r.label}</span>
        </li>
      ))}
    </ul>
  );
}

// Empty state for a 0-match run. Everything filtered means survivors === 0, so the
// aggregated blockers ARE the explanation — surface them plus a keyed next action
// instead of a blank list. (An empty corpus is a distinct, simpler story.)
export function NoMatchesExplainer({ meta, archetype }: { meta: MatchResponse["meta"]; archetype: string }) {
  const evaluated = meta.evaluated ?? 0;
  const reasons = meta.koReasons ?? [];
  const early = isEarlyCareer(archetype);

  if (evaluated === 0) {
    return (
      <Card>
        <p className="text-base font-semibold text-ink">No jobs to match against</p>
        <p className="mt-1 text-base text-steel">The job corpus is empty — seed roles first, then re-run.</p>
      </Card>
    );
  }

  const hint = (reasons.length ? KO_HINT[reasons[0].key] : undefined) ?? KO_HINT.other;
  return (
    <Card>
      <p className="text-base font-semibold text-ink">
        {early ? "No entry-eligible roles cleared the filters" : "No roles cleared the filters"}
      </p>
      <p className="mt-1 text-base text-steel">
        All {roleCount(evaluated)} were knocked out before scoring. Top blockers:
      </p>
      {reasons.length ? <KoReasonList reasons={reasons} /> : null}
      <p className="mt-3 max-w-sm text-sm text-steel">{hint}</p>
    </Card>
  );
}

// Thin-but-non-empty result: most of the corpus was filtered, so name the dominant
// blocker inline above the (short) list rather than leaving the gap unexplained.
export function KoReasonsNote({ koFiltered, reasons }: { koFiltered: number; reasons: KoReason[] }) {
  if (!koFiltered || !reasons.length) return null;
  return (
    <p className="mt-2 text-sm text-steel">
      <span className="font-semibold text-ink">{roleCount(koFiltered)}</span> didn&apos;t make the cut — mostly
      because they {reasons[0].label}.
    </p>
  );
}

// Shared dashed-card shell mirroring the app-wide EmptyState treatment (icon + copy).
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-stone-300 bg-paper/50 px-6 py-10 text-center">
      <SearchX className="h-8 w-8 text-steel" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function Chip({
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
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm ${toneClass}`}>
      <span className="uppercase tracking-wide text-steel">{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}
