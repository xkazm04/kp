"use client";

/*
 * The "Explain fit" reasoning panel and its three async faces (pending, error,
 * resolved). Split out of MatchPresentation.tsx — it is the only part of that
 * module that owns motion + async state, and it is mounted per card.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import type { Reasoning, ReasoningState } from "@/app/features/shared/matchTypes";

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

// The gap while an explanation is being generated. Reserves roughly the height
// ResolvedReasoning will take (header + verdict line + three bullet columns) so
// the swap barely nudges the card, and stays invisible for its first 150ms so a
// cached answer never flashes it (docs/LOADING_CHOREOGRAPHY.md).
//
// Was a nine-bar pulsing skeleton drawing a reasoning card nobody was getting
// yet. aria-hidden: the sibling sr-only line already voices the wait.
function ReasoningSkeleton() {
  return <div className="reveal-quiet min-h-[9rem] rounded-md border border-stone-200 bg-paper/50" aria-hidden />;
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
