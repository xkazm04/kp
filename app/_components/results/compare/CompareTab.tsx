"use client";

import { ArrowDownRight, ArrowUpRight, Crown, Minus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Analysis } from "@/app/_lib/schemas";
import { dedupe } from "@/app/_lib/dedupe";

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

  // Fall back to the upload prompt when there is no comparison, or when a
  // malformed/partially-filtered persisted payload carries an empty variants
  // array — reading variants[0] as the baseline below would otherwise throw and
  // take down the whole Result view.
  if (!comparison || comparison.variants.length < 1) {
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
              <Crown className="inline h-3.5 w-3.5 text-coral" aria-hidden />.
              {comparison.variants.length > 1 ? (
                <>
                  {" "}Each ▲/▼ delta is measured against{" "}
                  <span className="font-medium text-ink" title={baseline.label}>
                    {baseline.label}
                  </span>{" "}
                  — the first variant you uploaded (the &ldquo;baseline&rdquo; column), not the winner.
                </>
              ) : null}
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
                  <ComponentRow key={row.key} row={row} variants={comparison.variants} winnerIndex={winnerIndex} />
                ))}
                <ExtraRow
                  label="Job-fit score"
                  values={comparison.variants.map((v) => v.jobFitScore)}
                  winnerIndex={winnerIndex}
                  baseline={baseline.jobFitScore}
                />
                <ExtraRow
                  label="Keyword coverage %"
                  values={comparison.variants.map((v) => v.keywordCoveragePercent)}
                  winnerIndex={winnerIndex}
                  baseline={baseline.keywordCoveragePercent}
                />
                <ExtraRow
                  label="Skills indexed"
                  values={comparison.variants.map((v) => v.skillsCount)}
                  winnerIndex={winnerIndex}
                  baseline={baseline.skillsCount}
                  integer
                />
                <ExtraRow
                  label="Years experience"
                  values={comparison.variants.map((v) => v.yearsExperience)}
                  winnerIndex={winnerIndex}
                  baseline={baseline.yearsExperience}
                  integer
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
          {comparison.driverInsights.length ? (
            <ul className="mt-3 space-y-2 text-base leading-6 text-ink">
              {dedupe(comparison.driverInsights).map((insight, i) => (
                <li key={`${insight}-${i}`} className="rounded-md bg-paper p-3">
                  {insight}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-base leading-6 text-steel">Variants score identically — no drivers to highlight.</p>
          )}
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
          {comparison.mergedRecommendation.bullets.length ? (
            <ul className="mt-3 space-y-2 text-base leading-6 text-ink">
              {dedupe(comparison.mergedRecommendation.bullets).map((bullet, i) => (
                <li key={`${bullet}-${i}`} className="rounded-md bg-paper p-3">
                  {bullet}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-base leading-6 text-steel">No rewrite bullets surfaced from any variant.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ComponentRow({
  row,
  variants,
  winnerIndex
}: {
  row: { key: keyof ComparisonVariant["score"]; label: string };
  variants: ComparisonVariant[];
  winnerIndex: number;
}) {
  const baseline = variants[0].score[row.key];
  return (
    <tr className="even:bg-paper/40">
      <td className="sticky left-0 bg-white px-3 py-2 text-left font-medium text-ink">{row.label}</td>
      {variants.map((variant, index) => {
        const value = variant.score[row.key];
        const delta = index === 0 ? 0 : value - baseline;
        return (
          <td
            key={variant.label}
            className={`px-3 py-2 ${index === winnerIndex ? "bg-limewash/40" : ""}`}
          >
            <div className="flex items-center gap-2">
              <span className="font-semibold nums text-ink">{value.toFixed(0)}</span>
              {index === 0 ? (
                <span className="text-sm text-steel" title="First uploaded variant — every other column's delta is measured against this one.">baseline</span>
              ) : (
                <DeltaPill delta={delta} />
              )}
            </div>
          </td>
        );
      })}
    </tr>
  );
}

function ExtraRow({
  label,
  values,
  winnerIndex,
  baseline,
  integer = false
}: {
  label: string;
  values: Array<number | null>;
  winnerIndex: number;
  baseline: number | null;
  integer?: boolean;
}) {
  const hasAny = values.some((v) => v != null);
  if (!hasAny) return null;
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
                <span className="font-semibold nums text-ink">{integer ? value.toFixed(0) : value.toFixed(0)}</span>
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
