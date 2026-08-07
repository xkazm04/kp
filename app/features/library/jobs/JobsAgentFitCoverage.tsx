"use client";

import { useTranslations } from "next-intl";
import type { AgentFitSpecRecord } from "@/app/_lib/db/agents";
import { coverageSkin, fitOf, isFallbackSource, VERDICT_SKIN } from "./jobsAgentFitModel";

// The assessment half of the Agent fit tab: the leading verdict banner (the
// app-wide eval-report convention — colored left bar + the shared ✓/–/✗ glyph on
// the theme-mapped score-* scale, see VerdictBanner.tsx) and the
// per-responsibility coverage list (automatable ✓ / assisted △ / human_only ✗).

export function JobsAgentFitCoverage({ record }: { record: AgentFitSpecRecord }) {
  const t = useTranslations("agentFit");
  const fit = fitOf(record.fit);
  const skin = VERDICT_SKIN[fit.verdict];
  const ratioPct = fit.coverageRatio != null ? Math.round(fit.coverageRatio * 100) : null;

  return (
    <div className="space-y-3">
      {isFallbackSource(record.source) ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {t("fallbackNote")}
        </p>
      ) : null}

      <div
        className={`rounded-lg border border-stone-200 border-l-4 ${skin.bar} bg-white p-4 shadow-panel`}
        role="img"
        aria-label={t("verdict.aria", { verdict: t(`verdict.${skin.key}` as Parameters<typeof t>[0]) })}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span aria-hidden className={`text-2xl font-bold leading-none ${skin.text}`}>
            {skin.glyph}
          </span>
          <p className="text-meta uppercase tracking-wide text-steel">{t("verdict.heading")}</p>
          <span className={`text-sm font-semibold uppercase tracking-wide ${skin.text}`}>
            {t(`verdict.${skin.key}` as Parameters<typeof t>[0])}
          </span>
          {ratioPct != null ? (
            <span className="ml-auto text-sm text-steel nums">{t("verdict.ratio", { percent: ratioPct })}</span>
          ) : null}
        </div>
        <p className="mt-1.5 text-sm leading-5 text-steel">
          {t(`verdict.framing${skin.key.charAt(0).toUpperCase()}${skin.key.slice(1)}` as Parameters<typeof t>[0])}
        </p>
      </div>

      {fit.coverage.length > 0 ? (
        <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
          <p className="text-meta uppercase text-steel">{t("coverage.heading")}</p>
          <ul className="mt-2 space-y-2">
            {fit.coverage.map((item, i) => {
              const c = coverageSkin(item.coverage);
              return (
                <li key={`${item.item}-${i}`} className="flex items-start gap-2.5">
                  <span aria-hidden className={`mt-0.5 w-4 shrink-0 text-center text-base font-bold leading-5 ${c.text}`}>
                    {c.glyph}
                  </span>
                  <div className="min-w-0">
                    <p className="text-base text-ink">
                      {item.item}{" "}
                      <span className={`text-sm font-semibold ${c.text}`}>
                        {t(`coverage.${c.key}` as Parameters<typeof t>[0])}
                      </span>
                    </p>
                    {item.rationale ? <p className="text-sm text-steel">{item.rationale}</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
