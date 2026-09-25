"use client";

import { useTranslations } from "next-intl";
import { Section } from "@/app/_components/kit/Section";
import { StatStrip } from "@/app/_components/kit/StatStrip";
import type { Figure } from "@/app/_components/kit/types";
import type { JourneyCohortOutcome } from "@/app/_lib/journey/types";
import type { SpineModel } from "./spine";
import { HIRING_OUTCOMES } from "./hiringAdapter";
import { OUTCOME_TONE, pct } from "./cohortFormat";

/** The three numbers the layer exists for, set as the kit's StatStrip (the figures row every kit
 *  surface uses) before the path repeats them in detail. Same three figures, same order. */
export function CohortSummary({ model }: { model: SpineModel }) {
  const t = useTranslations("journey.cohort");
  const hired = model.outcomes.hired ?? 0;
  const worst = model.worst[0] != null ? model.stations[model.worst[0]] : undefined;
  const worstName = worst ? worst.keys.map((k) => t(`stage.${k}` as "stage.source")).join(" / ") : t("statWorstNone");
  const items: Figure[] = [
    { label: t("statHired"), value: `${pct(hired, model.n)}%`, unit: `${hired} / ${model.n}`, draw: model.n ? hired / model.n : 0 },
    { label: t("statWhole"), value: `${pct(model.walkedAll, model.n)}%`, unit: `${model.walkedAll} / ${model.n}`, draw: model.n ? model.walkedAll / model.n : 0 },
    // The stage losing the most journeys is the one figure that asks for attention: coral, "needs you".
    { label: t("statWorst"), value: worstName, unit: worst ? `${worst.exits} / ${worst.reached}` : undefined, tone: worst ? "needs" : "default" },
  ];
  return (
    <div className="jr-cohort-stats" data-testid="journey-cohort-summary">
      <StatStrip items={items} />
    </div>
  );
}

/** Where the river ends: every journey counted once, by how it ended. */
export function CohortOutcomes({ outcomes, total }: { outcomes: Record<string, number>; total: number }) {
  const t = useTranslations("journey.cohort");
  const rows = HIRING_OUTCOMES.map((o: JourneyCohortOutcome) => ({ o, n: outcomes[o] ?? 0 })).filter((r) => r.n > 0);
  return (
    <div className="jr-cohort-outcomes" data-testid="journey-cohort-outcomes">
      <Section title={t("outcomesTitle")}>
        <div className="jr-outcome-bar">
          {rows.map((r) => (
            <span key={r.o} className={OUTCOME_TONE[r.o]} style={{ width: `${(100 * r.n) / (total || 1)}%` }} />
          ))}
        </div>
        <ul className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
          {rows.map((r) => (
            <li key={r.o} className="flex items-center gap-2 text-body text-ink">
              <span className={`h-3 w-3 rounded-sm ${OUTCOME_TONE[r.o]}`} />
              {t(`outcome.${r.o}` as "outcome.hired")}
              <span className="nums font-semibold">{r.n}</span>
              <span className="text-micro nums text-steel">{pct(r.n, total)}%</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
