"use client";

import { AlertOctagon, Check, ClipboardCopy, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Analysis } from "@/app/_lib/schemas";
import { copyText } from "@/app/_lib/export-utils";
import { PANEL } from "@/app/_components/ui/recipes";
import { useCopyFeedback } from "@/app/_components/ui/useCopyFeedback";

// The engine's soft-signal panel (SCOR1): antipattern / hidden-strength
// HYPOTHESES — overclaim risk, tenure instability, transferable strengths —
// each with a source, a confidence and a suggested interview probe. The module
// (pipeline/jobfit/soft_signals.py) was built and tested with zero production
// callers; this section is its first surface. Stance preserved from the engine:
// these are hypotheses to confirm in the interview / work sample, not verdicts.
// Signal text is deterministic engine English (shown verbatim); chrome is i18n'd.

type Panel = NonNullable<Analysis["softSignals"]>;
type Signal = Panel["antipatterns"][number];

// Mirrors SoftSignalPanel.to_interview_checklist (models.py) so the copied
// list and the Python-side checklist can't drift in shape.
function checklistLines(panel: Panel): string[] {
  return [...panel.antipatterns, ...panel.strengths]
    .filter((s) => s.needsConfirmation && s.suggestedProbe)
    .map((s) => {
      // Mirrors models.py: every row is an unconfirmed hypothesis, so the export
      // is tagged TO CONFIRM (not "RED FLAG") and carries `detail` — the benign
      // alternative the panel below renders — rather than dropping it.
      const tag = s.kind === "antipattern" ? "TO CONFIRM" : "STRENGTH";
      return `[${tag}] ` + [s.label, s.detail, s.suggestedProbe].filter(Boolean).join(" — ");
    });
}

export function SoftSignalsSection({ panel }: { panel: Analysis["softSignals"] }) {
  const t = useTranslations("results.softSignals");
  const { copied, mark } = useCopyFeedback();
  if (!panel || (panel.antipatterns.length === 0 && panel.strengths.length === 0)) return null;

  const copy = async () => {
    mark(await copyText(checklistLines(panel).join("\n")));
  };

  const copyable = checklistLines(panel).length > 0;

  return (
    <div className={`${PANEL} p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <AlertOctagon className="h-5 w-5 text-coral" aria-hidden />
            <h3 className="font-serif text-h3 text-ink">{t("title")}</h3>
          </div>
          <p className="mt-1 text-sm text-steel">{t("stance")}</p>
        </div>
        {copyable ? (
          <button
            type="button"
            onClick={copy}
            className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-3 py-1.5 text-sm font-semibold text-steel hover:bg-paper hover:text-ink"
          >
            {copied ? <Check size={14} className="text-moss" aria-hidden /> : <ClipboardCopy size={14} aria-hidden />}
            {copied ? t("copied") : t("copyChecklist")}
          </button>
        ) : null}
      </div>

      {/* The engine's one-line read across all signals (softSignals.summary) — dead
          payload until now. Deterministic engine English, shown verbatim like the
          signal text below it. */}
      {panel.summary ? <p className="mt-3 text-base leading-6 text-ink">{panel.summary}</p> : null}

      {panel.antipatterns.length > 0 ? (
        <SignalGroup
          heading={t("antipatterns", { count: panel.antipatterns.length })}
          signals={panel.antipatterns}
          tone="risk"
        />
      ) : null}
      {panel.strengths.length > 0 ? (
        <SignalGroup
          heading={t("strengths", { count: panel.strengths.length })}
          signals={panel.strengths}
          tone="strength"
        />
      ) : null}
    </div>
  );
}

function SignalGroup({ heading, signals, tone }: { heading: string; signals: Signal[]; tone: "risk" | "strength" }) {
  const t = useTranslations("results.softSignals");
  const toneClasses =
    tone === "risk" ? "border-coral/30 bg-coral/5" : "border-moss/30 bg-moss/5";
  const icon =
    tone === "risk" ? (
      <AlertOctagon size={14} className="text-coral" aria-hidden />
    ) : (
      <Sparkles size={14} className="text-moss" aria-hidden />
    );
  return (
    <div className="mt-4">
      <p className={`flex items-center gap-1.5 text-meta uppercase tracking-wide ${tone === "risk" ? "text-coral" : "text-moss"}`}>
        {icon}
        {heading}
      </p>
      <ul className="mt-2 space-y-2">
        {signals.map((s) => (
          <li key={s.key + s.label} className={`rounded-md border p-3 ${toneClasses}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-ink">{s.label}</span>
              <span className="rounded-full bg-stone-100 px-2 py-0.5 font-mono text-micro text-steel" title={t("sourceTitle")}>
                {sourceLabel(s.source, t)}
              </span>
              <span className="text-micro text-steel">{t("confidence", { pct: Math.round(s.confidence * 100) })}</span>
              {s.needsConfirmation ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-micro font-semibold text-amber-800">
                  {t("needsConfirmation")}
                </span>
              ) : null}
            </div>
            {s.detail ? <p className="mt-1.5 text-sm text-steel">{s.detail}</p> : null}
            {s.suggestedProbe ? (
              <p className="mt-1.5 text-sm text-ink">
                <span className="font-semibold text-steel">{t("probe")}</span> {s.suggestedProbe}
              </p>
            ) : null}
            {/* Per-signal evidence (dead payload until now) behind a disclosure, so
                the compact card stays scannable but the CV snippets that grounded
                each hypothesis are one click away. */}
            {s.evidence.length > 0 ? (
              <details className="mt-1.5">
                <summary className="focus-ring cursor-pointer text-micro font-semibold text-steel">{t("evidence")}</summary>
                <ul className="mt-1 space-y-1">
                  {s.evidence.map((e, i) => (
                    <li key={`${e}-${i}`} className="text-sm leading-5 text-steel">
                      {e}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function sourceLabel(source: string, t: ReturnType<typeof useTranslations<"results.softSignals">>): string {
  const key = `sources.${source}` as Parameters<typeof t>[0];
  return t.has(key) ? t(key) : source;
}
