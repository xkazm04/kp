"use client";

import { useTranslations } from "next-intl";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { BTN_SECONDARY, META_LABEL } from "@/app/_components/ui/recipes";
// `import type` only: calibration-outcomes.ts is pure, erased at compile.
import type { OutcomeScoreKey, RankRow, RateCell, ScoreOutcomeReport } from "@/app/_lib/calibration-outcomes";

// Score validation against what people decided: the outcome ladder, score bands with
// Wilson intervals, AUC per score, and the confidence >= 80 auto-advance band audit
// (calibration-outcomes.ts). One grid per question, the sentence before the numbers,
// and every absence stated where the number would be. Below a cell's floor it shows
// the count, never a percentage. Read-only: nothing here changes a threshold.

const SCORE_LABEL = {
  match: "scoreMatch",
  potential: "scorePotential",
  potentialDepth: "scorePotentialDepth",
  potentialVelocity: "scorePotentialVelocity",
  potentialFoundation: "scorePotentialFoundation",
  potentialInitiative: "scorePotentialInitiative",
} as const satisfies Record<OutcomeScoreKey, string>;

const pct = (v: number) => Math.round(v * 100);

function Cell({ cell }: { cell: RateCell }) {
  const t = useTranslations("analytics.calibration.outcomes");
  if (cell.state === "empty") return <span className="text-meta text-steel">{t("cellEmpty")}</span>;
  if (cell.state === "thin") {
    return (
      <span className="flex flex-col">
        <span className="text-body text-ink nums">{t("cellThin", { k: cell.k, n: cell.n })}</span>
        <span className="text-meta text-steel">{t("cellNeeded", { n: cell.n, floor: cell.floor })}</span>
      </span>
    );
  }
  return (
    <span className="flex flex-col">
      <span className="text-body font-semibold text-ink nums">{t("cellRate", { pct: pct(cell.rate as number) })}</span>
      <span className="text-meta text-steel nums">
        {t("cellInterval", { lo: pct(cell.lo as number), hi: pct(cell.hi as number) })} · {t("cellN", { n: cell.n })}
      </span>
    </span>
  );
}

function RankCell({ row }: { row: RankRow | undefined }) {
  const t = useTranslations("analytics.calibration.outcomes");
  if (!row) return <span className="text-meta text-steel">—</span>;
  if (row.state === "not-recorded") {
    return (
      <span className="text-meta text-steel">{t(row.key === "potential" || row.key === "match" ? "notRecordedPotential" : "notRecordedComponent")}</span>
    );
  }
  const basis = t("aucBasis", { pos: row.positives, neg: row.negatives });
  if (row.state === "thin") {
    return (
      <span className="flex flex-col">
        <span className="text-body text-ink nums">{basis}</span>
        <span className="text-meta text-steel">{t("rankNeeded", { floor: row.floor })}</span>
      </span>
    );
  }
  return (
    <span className="flex flex-col">
      <span className="text-body font-semibold text-ink nums">{t("aucValue", { auc: (row.auc as number).toFixed(2) })}</span>
      <span className="text-meta text-steel nums">{basis}</span>
    </span>
  );
}

const GRID_ROW = "grid items-start gap-3 border-t border-stone-200 py-2";

export function ScoreOutcomes() {
  const t = useTranslations("analytics.calibration.outcomes");
  const tc = useTranslations("analytics.calibration");
  const { data, error, reload } = useJsonFetch<ScoreOutcomeReport>("/api/analytics/calibration/outcomes");

  if (error) {
    return (
      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-stone-200 pt-4 text-body text-steel" role="alert">
        <span>{t("error")}</span>
        <button type="button" onClick={reload} className={`${BTN_SECONDARY} h-9 px-4`}>
          {tc("retry")}
        </button>
      </div>
    );
  }
  if (!data) return <LoadingGap className="mt-6 min-h-[12rem]" />;

  const { population: p, ladder: l, audit } = data;
  const bandCols = `minmax(6rem,1fr) repeat(${data.stages.length}, minmax(7rem,1fr)) minmax(6rem,1fr)`;
  const lowerBar = audit.bar - 10;
  return (
    <section className="mt-6 space-y-6 border-t border-stone-200 pt-5" aria-labelledby="score-outcomes-title">
      <div className="max-w-prose space-y-2">
        <h3 id="score-outcomes-title" className="font-serif text-h3 text-ink">
          {t("title")}
        </h3>
        <p className="text-body text-steel">{t("intro")}</p>
        <p className="text-body text-ink nums">
          {t("population", { scored: p.scored, live: p.live, seeded: p.seeded, simulation: p.simulation, untracked: p.untracked })}
        </p>
        <p className="text-body text-ink nums">
          {t("ladder", { live: p.live, person: l.decidedByPerson, auto: l.automationOnly, open: l.undecided })}
        </p>
      </div>

      <div>
        <p className={META_LABEL}>{t("bandsTitle")}</p>
        <p className="mt-1 max-w-prose text-body text-steel">{t("bandsBlurb", { floor: data.floors.rate })}</p>
        <div className="mt-3 overflow-x-auto" role="table" aria-label={t("bandsTitle")}>
          <div className={`${GRID_ROW} border-t-0`} role="row" style={{ gridTemplateColumns: bandCols }}>
            <span className="text-meta text-steel" role="columnheader">{t("colBand")}</span>
            {data.stages.map((s) => (
              <span key={s} className="text-meta text-steel" role="columnheader">{s}</span>
            ))}
            <span className="text-meta text-steel" role="columnheader">{t("colAutomationOnly")}</span>
          </div>
          {data.bands.map((b) => (
            <div key={b.lo} className={GRID_ROW} role="row" style={{ gridTemplateColumns: bandCols }}>
              <span className="text-body font-semibold text-ink nums" role="rowheader">{t("bandRange", { lo: b.lo, hi: b.hi })}</span>
              {b.cells.map((c) => (
                <span key={c.stage} role="cell">
                  <Cell cell={c.cell} />
                </span>
              ))}
              <span className="text-body text-ink nums" role="cell">{b.automationOnly}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className={META_LABEL}>{t("rankTitle")}</p>
        <p className="mt-1 max-w-prose text-body text-steel">{t("rankBlurb", { floor: data.floors.rank })}</p>
        <div className="mt-3 overflow-x-auto" role="table" aria-label={t("rankTitle")}>
          <div className={`${GRID_ROW} grid-cols-[minmax(12rem,1.4fr)_minmax(9rem,1fr)_minmax(9rem,1fr)] border-t-0`} role="row">
            <span className="text-meta text-steel" role="columnheader">{t("colScore")}</span>
            <span className="text-meta text-steel" role="columnheader">{t("colAdvance", { stage: data.advanceStage ?? "—" })}</span>
            <span className="text-meta text-steel" role="columnheader">{t("colHired", { stage: data.terminalStage ?? "—" })}</span>
          </div>
          {(Object.keys(SCORE_LABEL) as OutcomeScoreKey[]).map((key) => (
            <div key={key} className={`${GRID_ROW} grid-cols-[minmax(12rem,1.4fr)_minmax(9rem,1fr)_minmax(9rem,1fr)]`} role="row">
              <span className="text-body text-ink" role="rowheader">{t(SCORE_LABEL[key])}</span>
              <span role="cell">
                <RankCell row={data.rank.find((r) => r.key === key && r.target === "advance")} />
              </span>
              <span role="cell">
                <RankCell row={data.rank.find((r) => r.key === key && r.target === "hired")} />
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className={META_LABEL}>{t("auditTitle", { bar: audit.bar })}</p>
        <p className="mt-1 max-w-prose text-body text-steel">{t("auditBlurb", { bar: audit.bar, lo: lowerBar, hi: audit.bar - 1 })}</p>
        <p className="mt-2 max-w-prose text-body text-ink nums">
          {audit.withConfidence === 0 && audit.automatedAdvances > 0
            ? t("auditNoConfidence")
            : t("auditCoverage", { with: audit.withConfidence, total: audit.automatedAdvances })}
        </p>
        <div className="mt-3 overflow-x-auto" role="table" aria-label={t("auditTitle", { bar: audit.bar })}>
          <div className={`${GRID_ROW} grid-cols-[minmax(14rem,1.6fr)_minmax(10rem,1fr)] border-t-0`} role="row">
            <span className="text-meta text-steel" role="columnheader">{t("colGroup")}</span>
            <span className="text-meta text-steel" role="columnheader">{t("colOverturned")}</span>
          </div>
          <div className={`${GRID_ROW} grid-cols-[minmax(14rem,1.6fr)_minmax(10rem,1fr)]`} role="row">
            <span className="text-body text-ink" role="rowheader">{t("auditAbove", { bar: audit.bar })}</span>
            <span role="cell">
              <Cell cell={audit.above} />
            </span>
          </div>
          <div className={`${GRID_ROW} grid-cols-[minmax(14rem,1.6fr)_minmax(10rem,1fr)]`} role="row">
            <span className="text-body text-ink" role="rowheader">{t("auditBelow", { lo: lowerBar, hi: audit.bar - 1 })}</span>
            <span role="cell">
              <Cell cell={audit.below} />
            </span>
          </div>
        </div>
        {audit.support === "raise-bar" ? <p className="mt-3 max-w-prose text-body text-ink">{t("auditSupport", { bar: audit.bar })}</p> : null}
      </div>

      <p className="text-meta text-steel">{t("measureOnly")}</p>
    </section>
  );
}
