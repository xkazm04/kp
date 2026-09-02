"use client";

import { useRef } from "react";
import { ChevronDown, Loader2, Sparkles } from "lucide-react";
import type { useTranslations } from "next-intl";
import { useDialogA11y } from "@/app/_components/useDialogA11y";
import { BTN_PRIMARY, PANEL } from "@/app/_components/ui/recipes";

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
        className={`${BTN_PRIMARY} h-10 px-4 text-sm`}
      >
        {submitting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
        {t("generateJd")}
        <ChevronDown size={15} aria-hidden className={`transition-transform ${checklistOpen ? "rotate-180" : ""}`} />
      </button>
      {checklistOpen ? (
        <>
          {/* Click-away backdrop. A div, not a button: as a button it was a focusable
              phantom tab stop inside the trap (same fix the shared Modal's scrim got). */}
          <div aria-hidden onClick={() => setChecklistOpen(false)} className="fixed inset-0 z-40 cursor-default" />
          <ChecklistPopover onClose={() => setChecklistOpen(false)} label={t("checklistTitle")}>
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
              className={`${BTN_PRIMARY} mt-2 h-9 w-full justify-center gap-2 px-4 text-sm`}
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {t("startAnalysis")}
            </button>
          </ChecklistPopover>
        </>
      ) : null}
    </div>
  );
}

// The checklist popover itself. It declares role="dialog" — so it owes the dialog
// contract, and had none of it: no Escape, no focus trap, no focus return to the
// Generate button, on the surface that starts a paid AI run. Mounted only while
// open, so the shared useDialogA11y hook (the same one Modal and the drawers use,
// and the same stack) can be called unconditionally here. `lockScroll: false`: this
// is an anchored popover, not a modal layer — locking the page behind it would be a
// stronger claim than the surface makes.
function ChecklistPopover({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useDialogA11y(ref, onClose, { trap: true, lockScroll: false });
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className={`animate-fade-in absolute left-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] ${PANEL} p-3 focus:outline-none`}
    >
      {children}
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
