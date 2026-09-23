"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { BTN_SECONDARY, CHIP_QUIET, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import type { LlmConfigRow } from "@/app/_lib/db/llm";
import { labelize } from "@/app/_lib/format";
import {
  BENCH_OPS,
  NOISE_BAND,
  UNMEASURED_USE_CASES,
  cellComposite,
  modelRanking,
  recommendForUseCase,
  modelOnUseCase,
  type QualityCell,
  type QualityScores,
  type UseCaseRecommendation,
} from "@/app/_lib/llm-quality";
import { QUALITY_SCORES, hasQualityScores } from "@/app/_lib/llm-quality-scores";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useCapabilities } from "@/app/features/shell/useCapabilities";
import { pickRowState, pinPayload } from "./modelsQualityPick";
import { saveRoutingPin } from "./modelsRoutingActions";

// Models tab — measured quality scorecard. Turns the baked bench matrix into two
// operator-facing views: a per-model ranking (who's strongest overall + fastest)
// and a per-case "best model" board (which model proved useful for which case), so
// a BYOM operator can balance a package — pin the top model per use case, or the
// fastest that clears their bar. The Recommended routing section prices each pick and
// pins it (the one write, through the routing PUT). Renders nothing until
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
  const tUse = useTranslations("models.useCases");
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

      <RecommendedRouting />

      {UNMEASURED_USE_CASES.length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold text-ink">{t("unmeasuredTitle")}</h4>
          <p className="mt-1 max-w-3xl text-sm text-steel">{t("unmeasuredIntro")}</p>
          <ul className={`${PANEL} mt-2 divide-y divide-stone-100 p-0`}>
            {UNMEASURED_USE_CASES.map((row) => {
              const key = row.id as Parameters<typeof tUse>[0];
              const label = tUse.has(key) ? tUse(key) : labelize(row.id);
              return (
                <li
                  key={row.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-sm"
                >
                  <span className="font-medium text-ink">{label}</span>
                  <span className="text-steel">{t("unmeasured")}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

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

// The routing use cases the bench measures, in BENCH_OPS order (automation's five
// ops fold into one row).
const MEASURED_USE_CASES = [...new Set(BENCH_OPS.map((o) => o.useCase))];

type PinsPayload = { rows: LlmConfigRow[]; providers: string[] };

/** Recommended routing: per use case, the cheapest model whose score sits inside the
 *  noise band of the best (llm-quality.ts recommendForUseCase), next to what is pinned
 *  today, with a one-click Pin through the routing PUT (stale-write guard intact). */
function RecommendedRouting() {
  const t = useTranslations("models.quality.pick");
  const tUse = useTranslations("models.useCases");
  const format = useFormatter();
  const errMsg = useErrorMessage();
  const caps = useCapabilities();
  const canPin = caps === null ? null : caps.includes("org:manage");
  const [pins, setPins] = useState<PinsPayload | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ useCase: string; ok: boolean; text: string } | null>(null);

  // One read of the current pins when the section opens; state is only set in the
  // async callbacks.
  const load = useCallback(() => {
    fetch("/api/llm/config")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((p) => setPins(p as PinsPayload))
      .catch(() => setLoadFailed(true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const recs = MEASURED_USE_CASES.map((uc) => recommendForUseCase(QUALITY_SCORES, uc)).filter(
    (r): r is UseCaseRecommendation => r !== null
  );
  if (!recs.length) return null;

  const labelForUseCase = (uc: string) => {
    const key = uc as Parameters<typeof tUse>[0];
    return tUse.has(key) ? tUse(key) : labelize(uc);
  };
  const usd = (n: number | null) =>
    n === null ? t("unpriced") : format.number(n, { style: "currency", currency: "USD", maximumSignificantDigits: 2 });
  const secs = (ms: number | null) => (ms === null ? "" : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`);

  const pin = async (rec: UseCaseRecommendation) => {
    if (!pins || busy) return;
    const body = pinPayload(rec.useCase, rec, pins.rows);
    if (!body) return;
    setBusy(rec.useCase);
    setNote(null);
    const result = await saveRoutingPin(
      body.useCase,
      body.provider,
      body.model,
      body.params,
      body.expectedUpdatedAt,
      t("pinFailed"),
      errMsg
    );
    if (result.ok) {
      setPins({ ...pins, rows: result.rows });
      setNote({ useCase: rec.useCase, ok: true, text: t("pinnedNote", { model: body.model }) });
    } else {
      // A stale refusal carries the current table: apply it so the row re-derives
      // its state from what is actually pinned now.
      if (result.rows) setPins({ ...pins, rows: result.rows });
      setNote({ useCase: rec.useCase, ok: false, text: result.message });
    }
    setBusy(null);
  };

  return (
    <div>
      <h4 className="text-sm font-semibold text-ink">{t("title")}</h4>
      <p className="mt-1 max-w-3xl text-sm text-steel">
        {t("intro", {
          narrow: String(NOISE_BAND.narrow),
          wide: String(NOISE_BAND.wide),
          judges: String(NOISE_BAND.atJudges),
        })}
      </p>
      {loadFailed ? <p className="mt-1 text-sm text-coral">{t("loadFailed")}</p> : null}
      <div className={`${PANEL} mt-2 overflow-hidden p-0`}>
        <div className="hidden grid-cols-[1.1fr_1.3fr_1.8fr_0.9fr] gap-3 border-b border-stone-200 px-4 py-2.5 text-meta uppercase tracking-wide text-steel sm:grid">
          <span>{t("colUseCase")}</span>
          <span>{t("colPin")}</span>
          <span>{t("colPick")}</span>
          <span className="text-right">{t("colAction")}</span>
        </div>
        {recs.map((rec) => {
          const current =
            pins?.rows.find((r) => r.useCase === rec.useCase) ?? pins?.rows.find((r) => r.useCase === "*") ?? null;
          const currentAgg = current?.model ? modelOnUseCase(QUALITY_SCORES, rec.useCase, current.model) : null;
          const state = pins
            ? pickRowState(rec.useCase, rec, pins.rows, pins.providers, {
                measuredModels: QUALITY_SCORES.models,
                canPin,
              })
            : null;
          const cliLane = rec.pick.target?.provider === "claude_cli";
          return (
            <div
              key={rec.useCase}
              className="grid grid-cols-1 gap-1.5 border-b border-stone-100 px-4 py-3 last:border-0 sm:grid-cols-[1.1fr_1.3fr_1.8fr_0.9fr] sm:items-center sm:gap-3"
            >
              <span className="text-sm font-medium text-ink">{labelForUseCase(rec.useCase)}</span>
              <span className="text-sm text-steel">
                {!pins ? (
                  loadFailed ? t("na") : t("pinLoading")
                ) : current?.model ? (
                  <>
                    <span className="text-ink">{short(current.model)}</span>
                    <span className="ml-1.5 tabular-nums">
                      {currentAgg
                        ? `${currentAgg.composite.toFixed(1)} · ${usd(currentAgg.costPerTaskUsd)}`
                        : t("notMeasured")}
                    </span>
                  </>
                ) : (
                  t("pinDefault")
                )}
              </span>
              <span className="text-sm text-ink">
                <span className="font-medium">{short(rec.pick.model)}</span>
                <span className="ml-1.5 tabular-nums text-steel">
                  {rec.pick.composite.toFixed(1)} · {t("perTask", { cost: usd(rec.pick.costPerTaskUsd) })}
                  {rec.pick.p50Ms !== null ? ` · ${secs(rec.pick.p50Ms)}` : ""}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className={CHIP_QUIET}>{t(`reasons.${rec.reason}`)}</span>
                  {rec.pick.model !== rec.best.model ? (
                    <span className="text-meta text-steel">
                      {rec.costMultiple !== null
                        ? t("vsBest", {
                            model: short(rec.best.model),
                            score: rec.best.composite.toFixed(1),
                            multiple: String(rec.costMultiple),
                          })
                        : t("vsBestUnpriced", { model: short(rec.best.model), score: rec.best.composite.toFixed(1) })}
                    </span>
                  ) : null}
                  {cliLane && rec.pick.costPerTaskUsd !== null ? (
                    <span className="text-meta text-steel">{t("listPrice")}</span>
                  ) : null}
                </span>
              </span>
              <span className="text-sm sm:text-right">
                {state === "pin_available" || state === "unmeasured_pin" ? (
                  <button
                    type="button"
                    className={`${BTN_SECONDARY} h-8 px-3 text-sm`}
                    disabled={busy !== null}
                    onClick={() => void pin(rec)}
                  >
                    {busy === rec.useCase ? t("pinning") : t("pin")}
                  </button>
                ) : null}
                {state && state !== "pin_available" ? (
                  <span className="block text-meta text-steel">{t(`states.${state}`)}</span>
                ) : null}
                {note?.useCase === rec.useCase ? (
                  <span role="status" className={`mt-1 block text-meta ${note.ok ? "text-moss" : "text-coral"}`}>
                    {note.text}
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
