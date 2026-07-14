"use client";

import { AnimatePresence, motion } from "framer-motion";
import { SearchX } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Meter } from "@/app/_components/Meter";
import { Skeleton } from "@/app/_components/Skeleton";
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
  const t = useTranslations("match.shared");
  const reduced = useReducedMotion();

  const content = state.loading ? (
    <motion.div key="loading" initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0.1 : 0.15 }}>
      <ReasoningSkeleton />
      <span className="sr-only">{t("generatingReasoning")}</span>
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
      <ResolvedReasoning r={state.data} source={state.source} cached={state.cached} narrativeLang={state.narrativeLang} />
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

function ResolvedReasoning({ r, source, cached, narrativeLang }: { r: Reasoning; source?: string; cached?: boolean; narrativeLang?: string }) {
  const t = useTranslations("match.shared");
  const locale = useLocale();
  // Honest fallback note: the engine writes the narrative only in en/cs, so a de/fr
  // reader gets English (or Czech) text. When the actual narrative language differs
  // from the reader's locale, say so plainly rather than passing the text off as
  // localized. Intl.DisplayNames names the language IN the reader's own locale.
  const showLangNote = Boolean(narrativeLang) && narrativeLang !== locale;
  const narrativeLangName = showLangNote
    ? new Intl.DisplayNames([locale], { type: "language" }).of(narrativeLang as string) ?? narrativeLang
    : null;
  return (
    <div className="rounded-md border border-stone-200 bg-paper/50 p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold uppercase tracking-wide text-coral">{t("reasoning")}</span>
        <span className="rounded bg-white px-1.5 py-0.5 text-sm text-steel">
          {source === "llm" ? t("sourceLlm") : t("sourceRuleBased")}
          {cached ? t("cachedSuffix") : ""}
        </span>
      </div>
      {showLangNote ? (
        <p className="mt-1 text-sm text-steel italic">{t("narrativeInLanguage", { language: narrativeLangName as string })}</p>
      ) : null}
      <p className="mt-1 text-base text-ink">{r.verdict}</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <ReasonList title={t("strengths")} items={r.strengths} tone="green" />
        <ReasonList title={t("gaps")} items={r.gaps} tone="red" />
        <ReasonList title={t("interviewProbes")} items={r.interviewProbes} tone="neutral" />
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
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-20" />
      </div>
      <Skeleton className="mt-2 h-4 w-3/4" />
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((c) => (
          <div key={c}>
            <Skeleton className="h-3.5 w-20" />
            <div className="mt-2 space-y-1.5">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
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
  const t = useTranslations("match.shared");
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
      <Meter value={pct} tone={tone} className="mt-0.5" aria-label={t("barAria", { label, score: pct })} />
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
  const t = useTranslations("match.shared");
  const remainder = Math.max(0, 100 - total);
  const detail = dims
    .map((d) => t("dimContribution", { label: d.label, contribution: Math.round(d.contribution), weight: d.weight }))
    .join(", ");
  return (
    <div className="mt-2 max-w-md">
      <div
        className="flex h-2 gap-px overflow-hidden rounded-full bg-stone-100"
        role="img"
        aria-label={t("scoreBreakdownAria", { total, detail })}
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
            <span className="tabular-nums tracking-tight">{t("weightPercent", { weight: d.weight })}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// The KO reasons match() now rolls into meta.koReasons (matching.aggregate_ko_reasons):
// one "{n} roles {clause}" line per blocker, counts first so the worst gate reads first.
function KoReasonList({ reasons }: { reasons: KoReason[] }) {
  const t = useTranslations("match.shared");
  return (
    <ul className="mt-2 space-y-1 text-left">
      {reasons.map((r) => (
        <li key={r.key} className="flex gap-2 text-sm text-steel">
          <span className="shrink-0 font-semibold tabular-nums text-ink">{t("roleCount", { count: r.count })}</span>
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
  const t = useTranslations("match.shared");
  const evaluated = meta.evaluated ?? 0;
  const reasons = meta.koReasons ?? [];
  const early = isEarlyCareer(archetype);

  if (evaluated === 0) {
    return (
      <Card>
        <p className="text-base font-semibold text-ink">{t("noJobsTitle")}</p>
        <p className="mt-1 text-base text-steel">{t("noJobsBody")}</p>
      </Card>
    );
  }

  // Next-action hint keyed off the dominant KO category (catalog: match.shared.koHint.*).
  const hintKey = reasons.length ? reasons[0].key : "other";
  const hintPath = `koHint.${hintKey}` as Parameters<typeof t>[0];
  const hint = t.has(hintPath) ? t(hintPath) : t("koHint.other");
  return (
    <Card>
      <p className="text-base font-semibold text-ink">
        {early ? t("noEntryRoles") : t("noRoles")}
      </p>
      <p className="mt-1 text-base text-steel">{t("allKnockedOut", { count: evaluated })}</p>
      {reasons.length ? <KoReasonList reasons={reasons} /> : null}
      <p className="mt-3 max-w-sm text-sm text-steel">{hint}</p>
    </Card>
  );
}

// Thin-but-non-empty result: most of the corpus was filtered, so name the dominant
// blocker inline above the (short) list rather than leaving the gap unexplained.
export function KoReasonsNote({ koFiltered, reasons }: { koFiltered: number; reasons: KoReason[] }) {
  const t = useTranslations("match.shared");
  if (!koFiltered || !reasons.length) return null;
  return (
    <p className="mt-2 text-sm text-steel">
      {t.rich("koReasonsNote", {
        count: koFiltered,
        reason: reasons[0].label,
        b: (chunks) => <span className="font-semibold text-ink">{chunks}</span>,
      })}
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
