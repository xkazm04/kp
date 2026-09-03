"use client";

import { useTranslations } from "next-intl";
import { PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { labelize } from "@/app/_lib/format";
import {
  BENCH_OPS,
  cellComposite,
  modelRanking,
  type QualityCell,
  type QualityScores,
} from "@/app/_lib/llm-quality";
import { QUALITY_SCORES, hasQualityScores } from "@/app/_lib/llm-quality-scores";

// Models tab — measured quality scorecard. Turns the baked bench matrix into two
// operator-facing views: a per-model ranking (who's strongest overall + fastest)
// and a per-case "best model" board (which model proved useful for which case), so
// a BYOM operator can balance a package — pin the top model per use case, or the
// fastest that clears their bar. Pure read of the baked data; renders nothing until
// a matrix run has been baked in.

const short = (slug: string) => slug.split("/").pop() ?? slug;
const WARN = "⚠"; // decorative reliability marker (not translatable copy)

// Composite 0–10 → the app's semantic tones (moss good / amber ok / coral weak).
const barTone = (s: number) => (s >= 7.5 ? "bg-moss" : s >= 5.5 ? "bg-amber-400" : "bg-coral");

// A weak reliability signal — below this, flag the cell/model as often-failing.
const LOW_RELIABILITY = 0.9;
const pct = (n: number) => `${Math.round(n * 100)}%`;

interface OpRank {
  model: string;
  composite: number;
  cell: QualityCell;
}

/** Models ranked for one case, best composite first (only measured cells). */
function rankOp(scores: QualityScores, op: string): OpRank[] {
  return scores.models
    .map((model) => {
      const cell = scores.cells[op]?.[model];
      const composite = cellComposite(scores, op, model);
      return cell && composite !== null ? { model, composite, cell } : null;
    })
    .filter((r): r is OpRank => r !== null)
    .sort((a, b) => b.composite - a.composite);
}

export function QualityOverview() {
  const t = useTranslations("models.quality");
  const tOp = useTranslations("models.benchOps");
  // With no baked matrix this used to render NOTHING, which was fine while it was
  // one panel among several. It is a whole switchable section now, so silence
  // would read as a broken tab: say the deployment has no measurements instead.
  if (!hasQualityScores()) {
    return (
      <div>
        <h3 className="font-serif text-h3 text-ink">{t("title")}</h3>
        <p className={`${PANEL_SUNKEN} mt-3 p-4 text-base text-steel`}>{t("empty")}</p>
      </div>
    );
  }

  const ranking = modelRanking(QUALITY_SCORES);
  const totalOps = Object.keys(QUALITY_SCORES.cells).length;
  const date = QUALITY_SCORES.measuredAt.slice(0, 10);
  // Canonical case order (the ops that are actually measured), not object order.
  const ops = BENCH_OPS.map((o) => o.id).filter((id) => QUALITY_SCORES.cells[id]);
  const opLabel = (op: string) => {
    const key = op as Parameters<typeof tOp>[0];
    return tOp.has(key) ? tOp(key) : labelize(op);
  };
  const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;

  return (
    <section className="space-y-6">
      <div>
        <h3 className="font-serif text-h3 text-ink">{t("title")}</h3>
        <p className="mt-1 max-w-3xl text-sm text-steel">{t("intro")}</p>
      </div>

      {/* Per-model ranking */}
      <div className={`${PANEL} overflow-hidden p-0`}>
        <div className="hidden grid-cols-[1.5fr_1.8fr_0.8fr_0.9fr_0.7fr] gap-3 border-b border-stone-200 px-4 py-2.5 text-meta uppercase tracking-wide text-steel sm:grid">
          <span>{t("colModel")}</span>
          <span>{t("colScore")}</span>
          <span className="text-right">{t("colWins")}</span>
          <span className="text-right">{t("colCoverage")}</span>
          <span className="text-right">{t("colSpeed")}</span>
        </div>
        {ranking.map((m) => (
          <div
            key={m.model}
            className="grid grid-cols-1 gap-2 border-b border-stone-100 px-4 py-3 last:border-0 sm:grid-cols-[1.5fr_1.8fr_0.8fr_0.9fr_0.7fr] sm:items-center sm:gap-3"
          >
            <span className="text-sm font-medium text-ink" title={m.model}>
              {short(m.model)}
              {m.reliability !== null && m.reliability < LOW_RELIABILITY ? (
                <span className="ml-1.5 font-normal text-coral" title={t("relTitle")}>
                  {WARN} {pct(m.reliability)}
                </span>
              ) : null}
            </span>
            <div className="flex items-center gap-2">
              <span className="w-8 text-sm font-semibold tabular-nums text-ink">
                {m.overall === null ? t("na") : m.overall.toFixed(1)}
              </span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100" aria-hidden>
                {m.overall !== null && (
                  <span
                    className={`block h-full rounded-full ${barTone(m.overall)}`}
                    style={{ width: `${Math.round((m.overall / 10) * 100)}%` }}
                  />
                )}
              </span>
            </div>
            <span className="text-sm tabular-nums text-steel sm:text-right">
              {m.wins}/{totalOps}
            </span>
            <span className="text-sm tabular-nums text-steel sm:text-right">
              {m.measured}/{m.total} {t("ops")}
            </span>
            <span className="text-sm tabular-nums text-steel sm:text-right">
              {m.p50Ms === null ? t("na") : secs(m.p50Ms)}
            </span>
          </div>
        ))}
      </div>

      {/* Per-case best model */}
      <div>
        <h4 className="text-sm font-semibold text-ink">{t("opScorecard")}</h4>
        <div className={`${PANEL} mt-2 overflow-hidden p-0`}>
          <div className="hidden grid-cols-[1.4fr_1.3fr_1.3fr] gap-3 border-b border-stone-200 px-4 py-2.5 text-meta uppercase tracking-wide text-steel sm:grid">
            <span>{t("colCase")}</span>
            <span>{t("colBest")}</span>
            <span>{t("colRunnerUp")}</span>
          </div>
          {ops.map((op) => {
            const ranked = rankOp(QUALITY_SCORES, op);
            const best = ranked[0];
            const runner = ranked[1];
            return (
              <div
                key={op}
                className="grid grid-cols-1 gap-1 border-b border-stone-100 px-4 py-2.5 last:border-0 sm:grid-cols-[1.4fr_1.3fr_1.3fr] sm:items-center sm:gap-3"
              >
                <span className="text-sm font-medium text-ink">{opLabel(op)}</span>
                <span className="text-sm text-ink">
                  {best ? (
                    <>
                      <span className="font-medium">{short(best.model)}</span>
                      <span className="ml-1.5 tabular-nums text-steel">{best.composite.toFixed(1)}</span>
                      {best.cell.llmRate < LOW_RELIABILITY ? (
                        <span className="ml-1.5 tabular-nums text-coral" title={t("relTitle")}>
                          {WARN} {pct(best.cell.llmRate)}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    t("na")
                  )}
                </span>
                <span className="text-sm text-steel">
                  {runner ? (
                    <>
                      {short(runner.model)}
                      <span className="ml-1.5 tabular-nums">{runner.composite.toFixed(1)}</span>
                    </>
                  ) : (
                    t("na")
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* The method footnote sits on the type scale (text-meta), not on a raw
          text-xs that undercuts the 14px floor the design system sets. */}
      <p className="text-meta leading-relaxed text-steel">
        {t("method", {
          date,
          judge: QUALITY_SCORES.judge,
          n: String(totalOps),
          limit: String(QUALITY_SCORES.limit),
        })}
      </p>
    </section>
  );
}
