"use client";

import { useTranslations } from "next-intl";
import { ArrowDownRight, ArrowUpRight, Crown, Minus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Analysis } from "@/app/_lib/schemas";
import { hasRenderableComparison, primaryScore } from "@/app/_lib/comparison";
import { reconcileScoreTotal, SCORE_COMPONENT_KEYS } from "@/app/_lib/format";
import { BulletList } from "../shared";

type ComparisonPayload = NonNullable<Analysis["comparison"]>;
type ComparisonVariant = ComparisonPayload["variants"][number];

// The "Overall" row reads the component sum (reconcileScoreTotal); the five component
// rows map to the canonical score taxonomy. Labels resolve through the shared report
// catalog (literal keys — next-intl rejects template keys) so the table stays in
// lockstep with the dial/breakdown AND localizes with the rest of the report.
const COMPONENT_ROW_KEYS = ["total", ...SCORE_COMPONENT_KEYS] as const;
const COMPONENT_LABEL_KEY = {
  total: "compare.overall",
  experience: "factorExperience",
  skills: "factorSkills",
  roleSeniority: "factorRole",
  education: "factorEducation",
  traits: "factorTraits",
} as const;

export function CompareTab({ analysis }: { analysis: Analysis }) {
  const comparison = analysis.comparison;
  const t = useTranslations("report");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Show a right-edge fade only while more variant columns sit off-screen.
  const variantCount = comparison?.variants.length ?? 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      // 1px tolerance for sub-pixel rounding at the scroll end.
      setCanScrollRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 1);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [variantCount]);

  // Fall back to the upload prompt unless the comparison meets the minimum-variant
  // contract (>= MIN_COMPARISON_VARIANTS). This is the SAME gate ResultPanel uses to
  // show/default the Compare tab, so the two can't disagree — and it also guards the
  // table below, where a 0- or 1-variant payload would make the baseline/delta math
  // (variants[0], the comparison narrative) meaningless or throw.
  if (!hasRenderableComparison(comparison)) {
    return (
      <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <h3 className="font-serif text-h3 text-ink">{t("compare.emptyTitle")}</h3>
        <p className="mt-3 text-base leading-6 text-steel">{t("compare.emptyBody")}</p>
      </div>
    );
  }

  // Resolve the winner by INDEX via max primary score, not by `findIndex(label === bestLabel)`.
  // Variant labels aren't unique (two CV variants can share a filename / "CV"), so a label
  // match returns the FIRST same-named column and could crown the wrong one. primaryScore is
  // the SAME rule buildComparison ranks by (imported, not re-derived); strict `>` keeps the
  // earliest on a tie — matching its stable sort.
  let winnerIndex = 0;
  for (let i = 1; i < comparison.variants.length; i++) {
    if (primaryScore(comparison.variants[i]) > primaryScore(comparison.variants[winnerIndex])) winnerIndex = i;
  }
  const baseline = comparison.variants[0];

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-serif text-h3 text-ink">{t("compare.title")}</h3>
            <p className="mt-1 text-base leading-6 text-steel">
              {t("compare.subtitle", { count: comparison.variants.length, baseline: baseline.label })}
            </p>
          </div>
          <div className="rounded-md bg-limewash px-3 py-2 text-base text-ink">
            {t("compare.recommended")} <span className="font-semibold">{comparison.bestLabel}</span>
          </div>
        </div>

        <div className="relative mt-4">
          <div ref={scrollRef} className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-0 text-base">
              {/* bug-ui-scan-2026-07-09 (analysis-result-panels #5): sr-only caption
                  names the table (WCAG 1.3.1); scope attrs + <th scope="row"> below
                  associate every cell with its header for screen readers. */}
              <caption className="sr-only">{t("compare.tableCaption")}</caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-10 w-44 bg-white px-3 py-2 text-left text-sm font-semibold uppercase tracking-wide text-steel">
                    {t("compare.componentHeader")}
                  </th>
                  {comparison.variants.map((variant, index) => (
                    <th
                      key={index}
                      scope="col"
                      className={`px-3 py-2 text-left text-sm font-semibold uppercase tracking-wide ${
                        index === winnerIndex ? "text-coral" : "text-steel"
                      }`}
                    >
                      <div className="flex items-center gap-1">
                        {index === winnerIndex ? <Crown className="h-3.5 w-3.5" aria-hidden /> : null}
                        <span className="truncate" title={variant.label}>
                          {variant.label}
                        </span>
                        {/* #5: convey "winner" beyond color-only (text-coral +
                            bg) — WCAG 1.4.1 — so SR/color-blind users get it too. */}
                        {index === winnerIndex ? <span className="sr-only">{t("compare.winnerLabel")}</span> : null}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPONENT_ROW_KEYS.map((key) => (
                  <DeltaRow
                    key={key}
                    label={t(COMPONENT_LABEL_KEY[key])}
                    variants={comparison.variants}
                    // The Overall row reads the component sum, not the raw
                    // pipeline total, so it always equals the component rows
                    // beneath it (the score-breakdown invariant; see
                    // reconcileScoreTotal).
                    extract={(v) => (key === "total" ? reconcileScoreTotal(v.score) : v.score[key])}
                    winnerIndex={winnerIndex}
                  />
                ))}
                <DeltaRow
                  label={t("compare.metricJobFit")}
                  variants={comparison.variants}
                  extract={(v) => v.jobFitScore}
                  winnerIndex={winnerIndex}
                />
                <DeltaRow
                  label={t("compare.metricKeyword")}
                  variants={comparison.variants}
                  extract={(v) => v.keywordCoveragePercent}
                  winnerIndex={winnerIndex}
                />
                <DeltaRow
                  label={t("compare.metricSkills")}
                  variants={comparison.variants}
                  extract={(v) => v.skillsCount}
                  winnerIndex={winnerIndex}
                />
                <DeltaRow
                  label={t("compare.metricYears")}
                  variants={comparison.variants}
                  extract={(v) => v.yearsExperience}
                  winnerIndex={winnerIndex}
                />
              </tbody>
            </table>
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-white to-transparent transition-opacity duration-200"
            style={{ opacity: canScrollRight ? 1 : 0 }}
          />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <h3 className="font-serif text-h3 text-ink">{t("compare.driversTitle")}</h3>
          <BulletList
            items={comparison.driverInsights}
            listClassName="mt-3 space-y-2 text-base leading-6 text-ink"
            itemClassName="rounded-md bg-paper p-3"
            empty={<p className="mt-3 text-base leading-6 text-steel">{t("compare.driversEmpty")}</p>}
          />
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <h3 className="font-serif text-h3 text-ink">{t("compare.mergedTitle")}</h3>
          <p className="mt-3 text-base leading-6 text-ink">{comparison.mergedRecommendation.summary}</p>
          <ul className="mt-3 space-y-2 text-base leading-6 text-ink">
            {comparison.mergedRecommendation.sectionPicks.map((pick) => (
              <li key={pick.section} className="rounded-md bg-paper p-3">
                <span className="font-semibold text-ink">{pick.section}</span>{" "}
                <span className="text-steel">{t("compare.fromLabel")}</span>{" "}
                <span className="font-medium text-coral">{pick.sourceLabel}</span>
                <p className="mt-1 text-sm text-steel">{pick.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <h3 className="font-serif text-h3 text-ink">{t("compare.headlineSkillsTitle")}</h3>
          {comparison.mergedRecommendation.headline ? (
            <div className="mt-3 rounded-md bg-paper p-3">
              <p className="text-sm font-semibold uppercase tracking-wide text-steel">{t("compare.headlineLabel")}</p>
              <p className="mt-1 text-base leading-6 text-ink">{comparison.mergedRecommendation.headline}</p>
            </div>
          ) : null}
          {comparison.mergedRecommendation.skillsLine ? (
            <div className="mt-3 rounded-md bg-paper p-3">
              <p className="text-sm font-semibold uppercase tracking-wide text-steel">{t("compare.skillsLineLabel")}</p>
              <p className="mt-1 text-base leading-6 text-ink">{comparison.mergedRecommendation.skillsLine}</p>
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <h3 className="font-serif text-h3 text-ink">{t("compare.bulletsTitle")}</h3>
          <BulletList
            items={comparison.mergedRecommendation.bullets}
            listClassName="mt-3 space-y-2 text-base leading-6 text-ink"
            itemClassName="rounded-md bg-paper p-3"
            empty={<p className="mt-3 text-base leading-6 text-steel">{t("compare.bulletsEmpty")}</p>}
          />
        </div>
      </div>
    </div>
  );
}

// One row of the compare table. Every column is measured against the first
// variant (values[0], the baseline); a value extractor pulls the metric off
// each variant and an optional formatter controls how it renders. Columns whose
// extracted value is null show an em-dash and contribute no delta, so the same
// component serves both always-present score components and the optional
// job-fit/keyword metrics. The whole row is dropped when no variant has a value.
function DeltaRow({
  label,
  variants,
  extract,
  winnerIndex,
  format = (value) => value.toFixed(0)
}: {
  label: string;
  variants: ComparisonVariant[];
  extract: (variant: ComparisonVariant) => number | null;
  winnerIndex: number;
  format?: (value: number) => string;
}) {
  const t = useTranslations("report");
  const values = variants.map(extract);
  if (!values.some((v) => v != null)) return null;
  const baseline = values[0];
  return (
    <tr className="even:bg-paper/40">
      {/* bug-ui-scan-2026-07-09 (analysis-result-panels #5): each metric row's
          label is its row header (scope="row"), not a plain cell. */}
      <th scope="row" className="sticky left-0 bg-white px-3 py-2 text-left font-medium text-ink">{label}</th>
      {values.map((value, index) => {
        const delta = value != null && baseline != null ? value - baseline : null;
        return (
          <td
            key={index}
            className={`px-3 py-2 ${index === winnerIndex ? "bg-limewash/40" : ""}`}
          >
            {value == null ? (
              <span className="text-steel">—</span>
            ) : (
              <div className="flex items-center gap-2">
                <span className="font-semibold nums text-ink">{format(value)}</span>
                {index === 0 ? (
                  <span className="text-sm text-steel" title={t("compare.baselineTitle")}>{t("compare.baselineTag")}</span>
                ) : delta != null ? (
                  <DeltaPill delta={delta} />
                ) : null}
              </div>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function DeltaPill({ delta }: { delta: number }) {
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-stone-100 px-1.5 py-0.5 text-sm font-medium nums text-steel">
        <Minus className="h-3 w-3" aria-hidden />
        0
      </span>
    );
  }
  const positive = delta > 0;
  const className = positive
    ? "inline-flex items-center gap-0.5 rounded-full bg-limewash px-1.5 py-0.5 text-sm font-medium nums text-ink"
    : "inline-flex items-center gap-0.5 rounded-full bg-red-50 px-1.5 py-0.5 text-sm font-medium nums text-red-700";
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={className}>
      <Icon className="h-3 w-3" aria-hidden />
      {positive ? "+" : ""}
      {delta.toFixed(0)}
    </span>
  );
}
