"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { labelize } from "@/app/_lib/format";
import { Select } from "@/app/_components/Select";
import { buildUrl, clearedTabScopedParams } from "@/app/features/tabs";
// `import type` only — calibration.ts is pure (no server imports), erased at compile.
import type { CalibrationResult, CalibrationCohort, ThresholdRecommendation } from "@/app/_lib/calibration";

// Calibration Engine (moonshot A/C) — the "How accurate are we?" panel. Plots a
// reliability diagram (predicted probability vs. measured advance rate) against
// the perfect-calibration diagonal, plus the Brier score. The whole point is
// HONESTY: below the minimum-outcomes gate it shows an uncalibrated state, never
// a misleading curve drawn on a handful of points.
//
// Three loop-closing additions: drift cohorts (a good year can hide a bad
// quarter), clickable score bands (open the candidates behind any dot), and a
// deterministic threshold suggestion (calibration that recommends, not just
// reports) — all still honesty-gated, all in both themes.

const SIZE = 240;
const PAD = 30;
const PLOT = SIZE - PAD * 2;

type CalibrationPayload = CalibrationResult & {
  families?: string[];
  measures?: string;
  cohorts?: CalibrationCohort[];
  recommendation?: ThresholdRecommendation | null;
  currentThreshold?: number | null;
};

function px(prob: number): number {
  return PAD + Math.max(0, Math.min(1, prob)) * PLOT;
}
function py(prob: number): number {
  return PAD + (1 - Math.max(0, Math.min(1, prob))) * PLOT;
}

function ReliabilityDiagram({ result, labels }: { result: CalibrationResult; labels: { x: string; y: string; perfect: string } }) {
  const t = useTranslations("analytics.calibration");
  const filled = result.bins.filter((b) => b.count > 0);
  const maxCount = filled.reduce((m, b) => Math.max(m, b.count), 1);
  return (
    <>
      {/* The SVG is a pure visual encoding (the dots ARE the signal but have no text
          equivalent) — mark it decorative and expose the bins as a visually-hidden list
          so the calibration is actually readable by screen readers (WCAG 1.1.1). */}
      <ul className="sr-only">
        {filled.map((b, i) => (
          <li key={i}>
            {t("srBin", {
              x: labels.x,
              predicted: b.predicted.toFixed(2),
              y: labels.y,
              observed: b.observed.toFixed(2),
              count: b.count,
            })}
          </li>
        ))}
      </ul>
      {/* Fully tokenized: every stroke/fill resolves through a design-system token
          that remaps under [data-theme="dark"] — legible in Studio Light AND Spark
          Dark (the old hardcoded stone/ink/#fff hex went near-invisible on dark). */}
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-60 w-60 text-ink" aria-hidden="true">
      {/* plot frame */}
      <rect x={PAD} y={PAD} width={PLOT} height={PLOT} fill="none" className="stroke-stone-300" strokeWidth={1} />
      {/* 0 / .5 / 1 gridlines */}
      {[0.5].map((g) => (
        <g key={g}>
          <line x1={px(g)} y1={PAD} x2={px(g)} y2={PAD + PLOT} className="stroke-stone-200" strokeWidth={1} />
          <line x1={PAD} y1={py(g)} x2={PAD + PLOT} y2={py(g)} className="stroke-stone-200" strokeWidth={1} />
        </g>
      ))}
      {/* perfect-calibration diagonal */}
      <line x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} className="stroke-steel" strokeWidth={1.5} strokeDasharray="4 4" />
      {/* measured points: one dot per non-empty bin, radius ~ sample count */}
      {filled.map((b, i) => {
        const r = 3 + 6 * Math.sqrt(b.count / maxCount);
        return (
          <circle
            key={i}
            cx={px(b.predicted)}
            cy={py(b.observed)}
            r={r}
            className="fill-ink stroke-white"
            fillOpacity={0.75}
            strokeWidth={1}
          />
        );
      })}
      {/* axis ticks */}
      {[0, 0.5, 1].map((g) => (
        <text key={`xt${g}`} x={px(g)} y={SIZE - 8} textAnchor="middle" className="fill-stone-400" fontSize={9}>
          {g}
        </text>
      ))}
      {[0, 0.5, 1].map((g) => (
        <text key={`yt${g}`} x={10} y={py(g) + 3} textAnchor="start" className="fill-stone-400" fontSize={9}>
          {g}
        </text>
      ))}
      </svg>
    </>
  );
}

// Direction 1 — drift: the same reliability, bucketed by calendar quarter. Each
// cohort is gated independently, so a recent quarter that slipped below the
// outcome floor reads "not enough yet" instead of borrowing the good all-time
// number. Brier lower = better, so a rising bar across quarters is a warning.
function DriftStrip({ cohorts }: { cohorts: CalibrationCohort[] }) {
  const t = useTranslations("analytics.calibration");
  const rated = cohorts.filter((c) => c.brier != null);
  const maxBrier = rated.reduce((m, c) => Math.max(m, c.brier as number), 0.25);
  return (
    <div className="mt-5 border-t border-stone-200 pt-4">
      <p className="text-meta uppercase tracking-wide text-steel">{t("driftTitle")}</p>
      <p className="mt-0.5 text-sm text-steel">{t("driftBlurb")}</p>
      <ol className="mt-3 flex flex-wrap gap-2">
        {cohorts.map((c) => {
          const gated = c.brier == null;
          const heightPct = gated ? 0 : Math.round(((c.brier as number) / maxBrier) * 100);
          return (
            <li
              key={c.key}
              className="flex min-w-[4.5rem] flex-1 flex-col items-center gap-1 rounded-md border border-stone-200 bg-paper/60 px-2 py-2"
              title={gated ? t("driftCohortPending") : t("driftBrierTitle", { brier: (c.brier as number).toFixed(3), n: c.n })}
            >
              <div className="flex h-12 w-full items-end justify-center" aria-hidden>
                {gated ? (
                  <span className="mb-1 text-meta text-steel">—</span>
                ) : (
                  <span className="w-3 rounded-t-sm bg-steel/50" style={{ height: `${Math.max(6, heightPct)}%` }} />
                )}
              </div>
              <span className="text-meta font-semibold text-ink">{c.key}</span>
              {gated ? (
                <span className="text-center text-meta leading-tight text-steel">{t("driftCohortPending")}</span>
              ) : (
                <>
                  <span className="text-sm font-semibold text-ink">{(c.brier as number).toFixed(3)}</span>
                  <span className="text-meta text-steel">{t("driftCohortN", { n: c.n })}</span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

type BandCandidate = { label: string; score: number; outcome: 0 | 1; entryId: string | null; live: boolean };
type BandPayload = { bin: number; lo: number; hi: number; source: string; candidates: BandCandidate[] };

// Direction 2 — a bin opens the candidates behind it. Reuses the board deep-link
// idiom (buildUrl + cleared tab-scoped params, ?q=<label>) that the funnel and
// by-role table already use, so a candidate row lands on the board filtered to
// them. A live entry links; a terminal one (a rejected outcome-0) is listed but
// unlinked — records outlive the board.
function ScoreBands({
  result,
  source,
  roleFamily,
  boardHref,
}: {
  result: CalibrationResult;
  source: string;
  roleFamily: string;
  boardHref: (q: string) => string;
}) {
  const t = useTranslations("analytics.calibration");
  const [openBin, setOpenBin] = useState<number | null>(null);
  // Lazy per-bin fetch: only the opened band is loaded, and it stays unloaded
  // until its row is expanded (useJsonFetch always fetches). The reset happens in
  // the click handler — never a synchronous setState in the effect body — and the
  // parent remounts this component when source/family change (a key), so a stale
  // band can't leak across a source switch.
  const [data, setData] = useState<BandPayload | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (openBin == null) return;
    let alive = true;
    const url = `/api/analytics/calibration/band?source=${source}&bin=${openBin}${roleFamily ? `&roleFamily=${encodeURIComponent(roleFamily)}` : ""}`;
    fetch(url)
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as BandPayload | null;
        if (!alive) return;
        if (!r.ok || body == null) {
          setError(true);
          return;
        }
        setData(body);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [openBin, source, roleFamily]);
  const toggleBin = (bin: number) => {
    setData(null);
    setError(false);
    setOpenBin((cur) => (cur === bin ? null : bin));
  };
  // Bins carry a [lo,hi) score band (×100 from the probability bin edges).
  const bands = result.bins
    .map((b, i) => ({ i, lo: Math.round(b.lo * 100), hi: Math.round(b.hi * 100), count: b.count, observed: b.observed }))
    .filter((b) => b.count > 0);

  return (
    <div className="mt-5 border-t border-stone-200 pt-4">
      <p className="text-meta uppercase tracking-wide text-steel">{t("bandsTitle")}</p>
      <p className="mt-0.5 text-sm text-steel">{t("bandsBlurb")}</p>
      <ul className="mt-3 space-y-1.5">
        {bands.map((b) => {
          const isOpen = openBin === b.i;
          return (
            <li key={b.i} className="rounded-md border border-stone-200">
              <button
                type="button"
                onClick={() => toggleBin(b.i)}
                aria-expanded={isOpen}
                className="focus-ring flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-paper/70"
              >
                <span className="font-medium text-ink">{t("bandRange", { lo: b.lo, hi: b.hi })}</span>
                <span className="flex items-center gap-3 text-sm text-steel">
                  <span>{t("bandObserved", { pct: Math.round(b.observed * 100) })}</span>
                  <span className="rounded-full bg-paper px-2 py-0.5 text-meta font-semibold text-steel">
                    {t("bandCount", { n: b.count })}
                  </span>
                </span>
              </button>
              {isOpen ? (
                <div className="border-t border-stone-100 px-3 py-2">
                  {error ? (
                    <p className="text-sm text-coral" role="alert">
                      {t("bandError")}
                    </p>
                  ) : !data ? (
                    <p className="text-sm text-steel" role="status">
                      {t("bandLoading")}
                    </p>
                  ) : data.candidates.length === 0 ? (
                    <p className="text-sm text-steel">{t("bandEmpty")}</p>
                  ) : (
                    <ul className="divide-y divide-stone-100">
                      {data.candidates.map((c, i) => (
                        <li key={`${c.entryId ?? c.label}-${i}`} className="flex items-center justify-between gap-3 py-1.5">
                          <span className="min-w-0 flex-1 truncate">
                            {c.live ? (
                              <Link
                                href={boardHref(c.label)}
                                title={t("bandViewInBoard")}
                                className="focus-ring rounded text-ink underline-offset-2 hover:text-coral hover:underline"
                              >
                                {c.label}
                              </Link>
                            ) : (
                              <span className="text-ink">{c.label}</span>
                            )}
                          </span>
                          <span className="flex shrink-0 items-center gap-2 text-meta">
                            <span
                              className={`rounded-full px-1.5 py-0.5 font-semibold ${
                                c.outcome === 1 ? "bg-moss/10 text-moss" : "bg-coral/10 text-coral"
                              }`}
                            >
                              {c.outcome === 1 ? t("bandOutcomeAdvanced") : t("bandOutcomeRejected")}
                            </span>
                            <span className="text-steel">{t("bandCandidateScore", { score: c.score })}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Direction 3 — the recommendation. Deterministic, honesty-gated, display-only
// until an explicit click routes the write through the existing decision-config
// mechanism (and seals a reversible record). Never auto-applied.
function ThresholdSuggestion({ rec, onApplied }: { rec: ThresholdRecommendation; onApplied: () => void }) {
  const t = useTranslations("analytics.calibration");
  const [phase, setPhase] = useState<"idle" | "applying" | "done" | "error">("idle");
  const [applied, setApplied] = useState<{ previous: number; next: number } | null>(null);

  const apply = async () => {
    setPhase("applying");
    try {
      const r = await fetch("/api/analytics/calibration/apply-threshold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestedThreshold: rec.suggestedThreshold }),
      });
      if (!r.ok) throw new Error();
      const body = (await r.json()) as { previousThreshold: number; newThreshold: number };
      setApplied({ previous: body.previousThreshold, next: body.newThreshold });
      setPhase("done");
      onApplied();
    } catch {
      setPhase("error");
    }
  };

  const sentence = rec.direction === "lower" ? "recLower" : "recRaise";
  return (
    <div className="mt-5 rounded-md border border-dial-amber/40 bg-dial-amber/10 p-3">
      <div className="flex items-center gap-2">
        <span className="rounded bg-dial-amber/20 px-1.5 py-0.5 text-meta font-semibold uppercase tracking-wide text-ink">
          {t("recTag")}
        </span>
      </div>
      <p className="mt-1.5 text-base text-ink">
        {t(sentence, {
          lo: rec.band.lo,
          hi: rec.band.hi,
          pct: rec.advanceRatePct,
          n: rec.n,
          current: rec.currentThreshold,
          suggested: rec.suggestedThreshold,
        })}
      </p>
      <p className="mt-1 text-sm text-steel">{t("recBasis", { total: rec.totalOutcomes })}</p>
      {phase === "done" && applied ? (
        <p className="mt-2 text-sm font-medium text-moss" role="status">
          {t("recApplied", { suggested: applied.next, previous: applied.previous })}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={apply}
            disabled={phase === "applying"}
            className="focus-ring inline-flex h-8 items-center rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
          >
            {phase === "applying" ? t("recApplying") : t("recApply", { suggested: rec.suggestedThreshold })}
          </button>
          {phase === "error" ? (
            <span className="text-sm text-coral" role="alert">
              {t("recError")}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function CalibrationPanel() {
  const t = useTranslations("analytics.calibration");
  const search = useSearchParams();
  // Per-role-family reliability (the route's headline use case: "how accurate are you
  // for backend roles?") — was computed-capable (?roleFamily) but had no UI selector.
  const [family, setFamily] = useState("");
  // REC-02 — the curve names WHICH score it measures. Default: the pipeline
  // match score, i.e. the number screening auto-decisions actually act on
  // (see pipelineCalibrationPairs). The CV-analysis × disposition pairing —
  // a score that never gates pipeline decisions — stays available, labeled.
  const [source, setSource] = useState<"pipeline" | "analysis">("pipeline");
  const url = `/api/analytics/calibration?source=${source}${family ? `&roleFamily=${encodeURIComponent(family)}` : ""}`;
  const { data, error, reload } = useJsonFetch<CalibrationPayload>(url);
  const families = data?.families ?? [];

  // Direction 2 — reuse the board deep-link idiom (buildUrl + cleared tab-scoped
  // params) the funnel and by-role table use: open the board filtered to this
  // candidate via the free-text ?q filter.
  const boardHref = (q: string) => buildUrl({ ...clearedTabScopedParams(), tab: "pipeline", q }, search.toString());

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-serif text-h2 text-ink">{t("title")}</h3>
          <p className="mt-1 max-w-prose text-sm text-stone-500">{t("blurb")}</p>
          {/* What this curve measures — the score + the outcome, explicit. */}
          <p className="mt-1 max-w-prose text-sm font-medium text-stone-600">
            {source === "analysis" ? t("measuresAnalysis") : t("measuresPipeline")}
          </p>
          {/* Direction 1 — the label-exclusion note: what counts as an outcome and
              what is silently excluded, so the curve never over-claims its base. */}
          <p className="mt-1 max-w-prose text-sm text-steel">
            <span className="font-medium text-steel">{t("exclusionTitle")}</span>{" "}
            {source === "analysis" ? t("exclusionAnalysis") : t("exclusionPipeline")}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Select
            value={source}
            onChange={(v) => {
              setSource(v === "analysis" ? "analysis" : "pipeline");
              setFamily(""); // families differ per source — a stale filter would silently empty the curve
            }}
            ariaLabel={t("sourceLabel")}
            size="sm"
            className="shrink-0"
            options={[
              { value: "pipeline", label: t("sourcePipeline") },
              { value: "analysis", label: t("sourceAnalysis") },
            ]}
          />
          {families.length > 1 ? (
            <Select
              value={family}
              onChange={setFamily}
              ariaLabel={t("familyLabel")}
              size="sm"
              className="shrink-0"
              options={[{ value: "", label: t("familyAll") }, ...families.map((f) => ({ value: f, label: labelize(f) }))]}
            />
          ) : null}
        </div>
      </div>

      {error ? (
        // bug-ui-scan-2026-07-09 (analytics-calibration-dashboards #4): a transient fetch
        // failure is recoverable — offer the same retry the sibling panels use, and
        // announce it assertively (role="alert", not the polite role="status").
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-stone-500" role="alert">
          <span>{t("error")}</span>
          <button
            type="button"
            onClick={reload}
            className="focus-ring inline-flex h-8 items-center rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40"
          >
            {t("retry")}
          </button>
        </div>
      ) : !data ? (
        <p className="mt-4 text-sm text-stone-400" role="status">
          {t("loading")}
        </p>
      ) : !data.calibrated ? (
        // Honest uncalibrated state — the moonshot's whole point. Never draw a
        // curve on too few outcomes; say exactly how many more are needed.
        <div className="mt-4 rounded-md border border-dashed border-stone-300 bg-stone-50 p-4">
          <p className="text-sm font-medium text-ink">{t("uncalibratedTitle")}</p>
          <p className="mt-1 text-sm text-stone-500">
            {t("uncalibratedBody", { n: data.n, min: data.minOutcomes })}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center">
            <ReliabilityDiagram
              result={data}
              labels={{ x: t("axisPredicted"), y: t("axisObserved"), perfect: t("perfect") }}
            />
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-3xl font-semibold text-ink">{data.brier!.toFixed(3)}</div>
                <div className="text-stone-500">{t("brier")}</div>
                <div className="mt-1 text-xs text-stone-400">{t("brierHint")}</div>
              </div>
              <ul className="space-y-1 text-stone-600">
                <li className="flex items-center gap-2">
                  {/* Tokenized legend swatches — resolve through the same theme vars
                      as the SVG, so the legend can't drift from the plot. */}
                  <span className="inline-block h-0 w-4 shrink-0 border-t-2 border-dashed border-steel align-middle" />
                  {t("perfect")}
                </li>
                <li className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-ink align-middle" />
                  {t("dotLegend")}
                </li>
                <li className="text-stone-400">{t("samples", { n: data.n })}</li>
              </ul>
            </div>
          </div>

          {/* Direction 3 — the recommendation (pipeline source only; null → no UI). */}
          {data.recommendation ? <ThresholdSuggestion rec={data.recommendation} onApplied={reload} /> : null}

          {/* Direction 1 — drift cohorts. */}
          {data.cohorts && data.cohorts.length > 0 ? <DriftStrip cohorts={data.cohorts} /> : null}

          {/* Direction 2 — clickable score bands. Keyed on source|family so a
              source switch remounts it fresh (no stale open band). */}
          <ScoreBands key={`${source}|${family}`} result={data} source={source} roleFamily={family} boardHref={boardHref} />
        </>
      )}
    </section>
  );
}
