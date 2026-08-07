"use client";

import { ChevronDown, Loader2, Sparkles } from "lucide-react";
import type { useTranslations } from "next-intl";

// The Generate button + its checklist popover (description / market research /
// case design) — extracted verbatim from JdsBuilder.tsx so that file stays
// under the 200-line split threshold.
export function JdsBuilderChecklist({
  t,
  checklistOpen,
  setChecklistOpen,
  submitting,
  options,
  setOptions,
  anyOption,
  inputOk,
  canStart,
  runGenerate,
}: {
  t: ReturnType<typeof useTranslations<"library.builder">>;
  checklistOpen: boolean;
  setChecklistOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  submitting: boolean;
  options: { description: boolean; marketResearch: boolean; caseDesign: boolean };
  setOptions: (updater: (o: { description: boolean; marketResearch: boolean; caseDesign: boolean }) => { description: boolean; marketResearch: boolean; caseDesign: boolean }) => void;
  anyOption: boolean;
  inputOk: boolean;
  canStart: boolean;
  runGenerate: () => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setChecklistOpen((v) => !v)}
        aria-expanded={checklistOpen}
        aria-haspopup="dialog"
        disabled={submitting}
        className="focus-ring inline-flex h-10 items-center gap-2 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
        {t("generateJd")}
        <ChevronDown size={15} aria-hidden className={`transition-transform ${checklistOpen ? "rotate-180" : ""}`} />
      </button>
      {checklistOpen ? (
        <>
          {/* Click-away backdrop. */}
          <button type="button" aria-hidden tabIndex={-1} onClick={() => setChecklistOpen(false)} className="fixed inset-0 z-40 cursor-default" />
          <div
            role="dialog"
            aria-label={t("checklistTitle")}
            className="animate-fade-in absolute left-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-stone-200 bg-white p-3 shadow-panel"
          >
            <p className="text-meta uppercase tracking-wide text-steel">{t("checklistTitle")}</p>
            <div className="mt-2 space-y-0.5">
              <OptionRow checked={options.description} onChange={(v) => setOptions((o) => ({ ...o, description: v }))} label={t("optDescription")} hint={t("optDescriptionHint")} />
              <OptionRow checked={options.marketResearch} onChange={(v) => setOptions((o) => ({ ...o, marketResearch: v }))} label={t("optMarket")} hint={t("optMarketHint")} />
              <OptionRow checked={options.caseDesign} onChange={(v) => setOptions((o) => ({ ...o, caseDesign: v }))} label={t("optCase")} hint={t("optCaseHint")} />
            </div>
            <p className="mt-2 border-t border-stone-200 pt-2 text-sm text-steel">{t("checklistHint")}</p>
            {!anyOption ? (
              <p className="mt-1.5 text-sm text-coral">{t("pickAtLeastOne")}</p>
            ) : !inputOk ? (
              <p className="mt-1.5 text-sm text-coral">{t("needMoreInput")}</p>
            ) : null}
            <button
              type="button"
              onClick={runGenerate}
              disabled={!canStart}
              className="focus-ring mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {t("startAnalysis")}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

// One checklist row: a checkbox + a bold label and a one-line explanation of what
// that step produces.
function OptionRow({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 hover:bg-stone-50">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="focus-ring mt-0.5 h-4 w-4 shrink-0 accent-coral"
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        <span className="block text-sm text-steel">{hint}</span>
      </span>
    </label>
  );
}
