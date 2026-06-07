"use client";

import { ArrowDownRight, ArrowUpRight, Crown, Minus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Analysis } from "@/app/_lib/schemas";
import { hasRenderableComparison } from "@/app/_lib/comparison";
import { reconcileScoreTotal } from "@/app/_lib/format";
import { BulletList } from "../shared";

type ComparisonPayload = NonNullable<Analysis["comparison"]>;
type ComparisonVariant = ComparisonPayload["variants"][number];

const COMPONENT_ROWS: Array<{ key: keyof ComparisonVariant["score"]; label: string }> = [
  { key: "total", label: "Overall" },
  { key: "experience", label: "Experience" },
  { key: "skills", label: "Skills" },
  { key: "roleSeniority", label: "Role seniority" },
  { key: "education", label: "Education" },
  { key: "traits", label: "Traits" }
];

export function CompareTab({ analysis }: { analysis: Analysis }) {
  const comparison = analysis.comparison;
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
        <h3 className="font-serif text-h3 text-ink">CV Variants</h3>
        <p className="mt-3 text-base leading-6 text-steel">
          Upload 2-3 CV variants to score each against the same job in one run, see the score delta per component, and
          get a merged best variant recommendation.
        </p>
      </div>
    );
  }

  const winnerIndex = comparison.variants.findIndex((variant) => variant.label === comparison.bestLabel);
  const baseline = comparison.variants[0];

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-serif text-h3 text-ink">CV Variant Comparison</h3>
            <p className="mt-1 text-base leading-6 text-steel">
              {comparison.variants.length} variants scored against the same job. Winner highlighted with{" "}
              <Crown className="inline h-3.5 w-3.5 text-coral" aria-hidden />. Each ▲/▼ delta is measured against{" "}
              <span className="font-medium text-ink" title={baseline.label}>
                {baseline.label}
              </span>{" "}
              — the first variant you uploaded (the &ldquo;baseline&rdquo; column), not the winner.
            </p>
          </div>
          <div className="rounded-md bg-limewash px-3 py-2 text-base text-ink">
            Recommended: <span className="font-semibold">{comparison.bestLabel}</span>
          </div>
        </div>

        <div className="relative mt-4">
          <div ref={scrollRef} className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-0 text-base">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 w-44 bg-white px-3 py-2 text-left text-sm font-semibold uppercase tracking-wide text-steel">
                    Component
                  </th>
                  {comparison.variants.map((variant, index) => (
                    <th
                      key={variant.label}
                      className={`px-3 py-2 text-left text-sm font-semibold uppercase tracking-wide ${
                        index === winnerIndex ? "text-coral" : "text-steel"
                      }`}
                    >
                      <div className="flex items-center gap-1">
                        {index === winnerIndex ? <Crown className="h-3.5 w-3.5" aria-hidden /> : null}
                        <span className="truncate" title={variant.label}>
                          {variant.label}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPONENT_ROWS.map((row) => (
                  <DeltaRow
                    key={row.key}
                    label={row.label}
                    variants={comparison.variants}
                    // The Overall row reads the component sum, not the raw
                    // pipeline total, so it always equals the component rows
                    // beneath it (the score-breakdown invariant; see
                    // reconcileScoreTotal).
                    extract={(v) => (row.key === "total" ? reconcileScoreTotal(v.score) : v.score[row.key])}
                    winnerIndex={winnerIndex}
                  />
                ))}
                <DeltaRow
                  label="Job-fit score"
                  variants={comparison.variants}
                  extract={(v) => v.jobFitScore}
                  winnerIndex={winnerIndex}
                />
                <DeltaRow
                  label="Keyword coverage %"
                  variants={comparison.variants}
                  extract={(v) => v.keywordCoveragePercent}
                  winnerIndex={winnerIndex}
                />
                <DeltaRow
                  label="Skills indexed"
                  variants={comparison.variants}
                  extract={(v) => v.skillsCount}
                  winnerIndex={winnerIndex}
                />
                <DeltaRow
                  label="Years experience"
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
          <h3 className="font-serif text-h3 text-ink">Score Delta Drivers</h3>
          <BulletList
            items={comparison.driverInsights}
            listClassName="mt-3 space-y-2 text-base leading-6 text-ink"
            itemClassName="rounded-md bg-paper p-3"
            empty={<p className="mt-3 text-base leading-6 text-steel">Variants score identically — no drivers to highlight.</p>}
          />
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <h3 className="font-serif text-h3 text-ink">Merged Best Variant</h3>
          <p className="mt-3 text-base leading-6 text-ink">{comparison.mergedRecommendation.summary}</p>
          <ul className="mt-3 space-y-2 text-base leading-6 text-ink">
            {comparison.mergedRecommendation.sectionPicks.map((pick) => (
              <li key={pick.section} className="rounded-md bg-paper p-3">
                <span className="font-semibold text-ink">{pick.section}</span>{" "}
                <span className="text-steel">— from</span>{" "}
                <span className="font-medium text-coral">{pick.sourceLabel}</span>
                <p className="mt-1 text-sm text-steel">{pick.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <h3 className="font-serif text-h3 text-ink">Suggested Headline & Skills</h3>
          {comparison.mergedRecommendation.headline ? (
            <div className="mt-3 rounded-md bg-paper p-3">
              <p className="text-sm font-semibold uppercase tracking-wide text-steel">Headline</p>
              <p className="mt-1 text-base leading-6 text-ink">{comparison.mergedRecommendation.headline}</p>
            </div>
          ) : null}
          {comparison.mergedRecommendation.skillsLine ? (
            <div className="mt-3 rounded-md bg-paper p-3">
              <p className="text-sm font-semibold uppercase tracking-wide text-steel">Skills line</p>
              <p className="mt-1 text-base leading-6 text-ink">{comparison.mergedRecommendation.skillsLine}</p>
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <h3 className="font-serif text-h3 text-ink">Top Bullets (merged)</h3>
          <BulletList
            items={comparison.mergedRecommendation.bullets}
            listClassName="mt-3 space-y-2 text-base leading-6 text-ink"
            itemClassName="rounded-md bg-paper p-3"
            empty={<p className="mt-3 text-base leading-6 text-steel">No rewrite bullets surfaced from any variant.</p>}
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
  const values = variants.map(extract);
  if (!values.some((v) => v != null)) return null;
  const baseline = values[0];
  return (
    <tr className="even:bg-paper/40">
      <td className="sticky left-0 bg-white px-3 py-2 text-left font-medium text-ink">{label}</td>
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
                  <span className="text-sm text-steel" title="First uploaded variant — every other column's delta is measured against this one.">baseline</span>
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
