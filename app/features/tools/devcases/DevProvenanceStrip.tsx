"use client";

import { useTranslations } from "next-intl";
import { describeSource, stepLabel } from "./DevHelpers";
import type { PerStepSources, SourceKind } from "./DevTypes";

function Chip({ label, source }: { label: string; source?: SourceKind }) {
  const t = useTranslations("devcase.provenance");
  // One visual language for "where did this come from", from the shared descriptor:
  // moss = real LLM, amber = degraded/mixed, muted stone = template/deterministic.
  const { dotClass, textClass, labelKey } = describeSource(source);
  return (
    <span
      title={t("chipTitle", { step: label, source: t(`source.${labelKey}`) })}
      className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-paper px-1.5 py-0.5 text-micro uppercase tracking-wide"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden />
      <span className={textClass}>{label}</span>
    </span>
  );
}

// Renders the uniform per-step provenance carried by every devcase CLI command
// ({step: "llm"|"deterministic"}) as a row of compact chips — one consistent
// strip across analyze, design and evaluate. When `perStepSources` is absent
// (bundles saved before the unified contract), it degrades to a single chip
// summarising the combined `source`.
//
// Every word here — the step names, the three provenance words, the sentence that
// IS the strip for a screen-reader user — used to be English no matter who was
// reading. The step names resolve through the catalog with a capitalised-raw
// fallback for a step a newer engine invents (the rule is `stepLabel` in
// DevHelpers, tested there); the provenance words resolve from the descriptor's
// `labelKey`.
export function ProvenanceStrip({
  perStepSources,
  source,
  className = "",
}: {
  perStepSources?: PerStepSources;
  source?: SourceKind;
  className?: string;
}) {
  const t = useTranslations("devcase.provenance");
  const label = (key: string) =>
    stepLabel(key, (k) => {
      const catalogKey = `step.${k}` as Parameters<typeof t>[0];
      return t.has(catalogKey) ? t(catalogKey) : null;
    });
  const sourceWord = (src?: SourceKind) => t(`source.${describeSource(src).labelKey}`);
  const steps = Object.entries(perStepSources ?? {});
  const ariaLabel = steps.length
    ? t("aria", { detail: steps.map(([k, v]) => t("ariaStep", { step: label(k), source: sourceWord(v) })).join(", ") })
    : t("aria", { detail: sourceWord(source) });
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 align-middle ${className}`} aria-label={ariaLabel}>
      {steps.length ? (
        steps.map(([key, src]) => <Chip key={key} label={label(key)} source={src} />)
      ) : (
        <Chip label={sourceWord(source)} source={source} />
      )}
    </span>
  );
}
