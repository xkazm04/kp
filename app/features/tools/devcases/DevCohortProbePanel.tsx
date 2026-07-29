"use client";

import { Radar } from "lucide-react";
import { useTranslations } from "next-intl";
import { probeMissHeatmap } from "@/app/_lib/devcase-cohort";
import type { CoverProbe, Submission } from "./DevTypes";

// fec3e23a — cohort probe-miss heatmap. Aggregates every submission's per-probe
// outcomes for THIS case and shows which covert probes the field collectively
// misses. A probe the whole cohort walks past (high miss rate over several
// evaluated submissions) is usually a miscalibrated case — the seam is too
// hidden — not a run of weak candidates. Internal reviewer material (it names the
// probes), so it lives inside the locked section.

// Miss rate → heat band. A probe most of the cohort detects is healthy (moss); one
// most of them miss is the miscalibration flag (coral). The `band` id is the non-color
// cue (WCAG 1.4.1) so severity reads for low-vision / colorblind reviewers too — it is
// a catalog KEY (`devcase.band.*`), rendered in the reviewer's language by the caller.
type HeatBand = "high" | "some" | "low";
function heatBand(rate: number): { cls: string; band: HeatBand } {
  if (rate >= 0.75) return { cls: "bg-coral/20 text-coral", band: "high" };
  if (rate >= 0.4) return { cls: "bg-amber-100 text-amber-700", band: "some" };
  return { cls: "bg-moss/15 text-moss", band: "low" };
}

export function CohortProbePanel({ probes, submissions }: { probes: CoverProbe[]; submissions: Submission[] }) {
  const t = useTranslations("devcase");
  const { cells, evaluatedCount } = probeMissHeatmap(probes, submissions);
  // Nothing to say until at least one submission has been scored against the probes.
  if (evaluatedCount === 0 || cells.length === 0) return null;

  // A probe the whole evaluated cohort missed (and there's more than one of them)
  // is the headline miscalibration signal worth calling out.
  const blindSpots = cells.filter((c) => c.evaluated > 1 && c.missRate === 1);

  return (
    <div className="mt-3 border-t border-amber-200/60 pt-3">
      <h4 className="flex items-center gap-1.5 text-meta font-semibold uppercase tracking-wide text-amber-700">
        <Radar size={12} /> {t("cohort.title")}
        <span className="text-steel">{t("cohort.evaluated", { count: evaluatedCount })}</span>
      </h4>
      <ul className="mt-2 space-y-1.5">
        {cells.map((c) => (
          <li key={c.probeId} className="flex items-center gap-2 text-micro">
            <span className="rounded bg-amber-100 px-1 py-0.5 font-semibold uppercase text-amber-700">
              {c.kind.replace(/_/g, " ")}
            </span>
            <span className="min-w-0 flex-1 truncate text-steel" title={c.reveals}>
              @ {c.where || "—"}
            </span>
            {c.missRate == null ? (
              <span className="shrink-0 text-steel">{t("cohort.notScored")}</span>
            ) : (
              <>
                {(() => {
                  const heat = heatBand(c.missRate);
                  const pct = Math.round(c.missRate * 100);
                  const band = t(`band.${heat.band}` as Parameters<typeof t>[0]);
                  return (
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 font-semibold ${heat.cls}`}
                      aria-label={t("cohort.missedAria", { pct, band })}
                    >
                      {t("cohort.missed", { pct, band })}
                    </span>
                  );
                })()}
                <span className="shrink-0 text-steel" title={t("cohort.weakTitle")}>
                  {t("cohort.weak", { pct: Math.round((c.weakRate ?? 0) * 100) })}
                </span>
                <span className="shrink-0 text-steel">{t("cohort.sample", { count: c.evaluated })}</span>
              </>
            )}
          </li>
        ))}
      </ul>
      {blindSpots.length > 0 ? (
        <p className="mt-2 rounded-md border border-coral/30 bg-coral/5 px-2.5 py-1.5 text-micro text-ink">
          <span className="font-semibold text-coral">{t("cohort.miscalibrationLabel")}</span>{" "}
          {t("cohort.miscalibration", { count: blindSpots.length })}
        </p>
      ) : null}
    </div>
  );
}
