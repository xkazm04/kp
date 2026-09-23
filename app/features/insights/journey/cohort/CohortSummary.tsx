"use client";

import { useTranslations } from "next-intl";
import { META_LABEL } from "@/app/_components/ui/recipes";
import type { JourneyCohortOutcome } from "@/app/_lib/journey/types";
import type { SpineModel } from "./spine";
import { HIRING_OUTCOMES } from "./hiringAdapter";
import { OUTCOME_TONE, pct } from "./cohortFormat";

/** The three numbers the layer exists for, drawn large before the path repeats them in detail. */
export function CohortSummary({ model }: { model: SpineModel }) {
  const t = useTranslations("journey.cohort");
  const hired = model.outcomes.hired ?? 0;
  const worst = model.worst[0] != null ? model.stations[model.worst[0]] : undefined;
  const worstName = worst ? worst.keys.map((k) => t(`stage.${k}` as "stage.source")).join(" / ") : t("statWorstNone");

  return (
    <dl className="grid grid-cols-3 gap-6 border-b border-stone-200 pb-8" data-testid="journey-cohort-summary">
      <Stat label={t("statHired")} figure={`${pct(hired, model.n)}%`} caption={`${hired} / ${model.n}`} />
      <Stat label={t("statWhole")} figure={`${pct(model.walkedAll, model.n)}%`} caption={`${model.walkedAll} / ${model.n}`} />
      <Stat label={t("statWorst")} figure={worstName} caption={worst ? `${worst.exits} / ${worst.reached}` : ""} tone={worst ? "text-red-700" : "text-ink"} />
    </dl>
  );
}

function Stat({ label, figure, caption, tone = "text-ink" }: { label: string; figure: string; caption: string; tone?: string }) {
  return (
    <div>
      <dt className={META_LABEL}>{label}</dt>
      <dd className="mt-1 flex items-baseline gap-3">
        <span className={`font-serif text-display leading-none nums ${tone}`}>{figure}</span>
        <span className="text-meta nums text-steel">{caption}</span>
      </dd>
    </div>
  );
}

/** Where the river ends: every journey counted once, by how it ended. */
export function CohortOutcomes({ outcomes, total }: { outcomes: Record<string, number>; total: number }) {
  const t = useTranslations("journey.cohort");
  const rows = HIRING_OUTCOMES.map((o: JourneyCohortOutcome) => ({ o, n: outcomes[o] ?? 0 })).filter((r) => r.n > 0);
  return (
    <section className="border-t border-stone-200 pt-8" data-testid="journey-cohort-outcomes">
      <h2 className="font-serif text-h2 text-ink">{t("outcomesTitle")}</h2>
      <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-stone-100">
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
            <span className="text-meta nums text-steel">{pct(r.n, total)}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
