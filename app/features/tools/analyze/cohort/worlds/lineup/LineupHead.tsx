"use client";

import { Segmented } from "@/app/_components/kit";
import type { CohortView } from "../../cohortTypes";
import { CrownGlyph, FloorGlyph, HazeGlyph } from "./art/LineupGlyphs";
import { hazeOf, siteCounts, type StreetOrder } from "./lineupModel";
import type { LineupWords } from "./useLineupWords";

/**
 * The street's headline: the overall claim in the honesty vocabulary, never a crown it has not earned.
 * `clears` names the leader (with a flag); `insideNoise` says nobody stands clear and how many towers
 * share the haze; `belowFloor` makes no comparative claim at all. Then robustness in plain words, the
 * construction line while the cohort runs, and the street order toggle (fit rank / neutral).
 */
export function LineupHead({ view, words, order, onOrder }: { view: CohortView; words: LineupWords; order: StreetOrder; onOrder: (o: StreetOrder) => void }) {
  const { t } = words;
  const o = view.claims.overall;
  const haze = hazeOf(view);
  const rated = view.members.filter((m) => m.cells.fit.rating != null).length;
  const headline =
    o.separation === "clears"
      ? t("head.clears", { name: words.nameOf(o.leader) })
      : o.separation === "insideNoise"
        ? t("head.insideNoise", { count: haze?.memberIds.length ?? 2 })
        : t("head.belowFloor", { rated });
  const robust =
    o.robustness === "undetermined" || o.separation === "belowFloor"
      ? t("robust.undetermined")
      : t(o.separation === "clears" ? (o.robustness === "stable" ? "robust.clearsStable" : "robust.clearsSensitive") : o.robustness === "stable" ? "robust.noiseStable" : "robust.noiseSensitive");
  const site = siteCounts(view);
  const running = view.status === "running" || view.status === "queued";

  return (
    <div className="lu-head" data-claim={o.separation}>
      <div className="lu-head__titles">
        <p className="lu-head__kicker">
          <span>{t("kicker", { title: view.jdTitle })}</span>
          <span>{t("count", { count: view.members.length })}</span>
          {view.blind ? <span className="lu-head__chip">{t("blind")}</span> : null}
        </p>
        <h2 className="lu-head__title" tabIndex={-1} data-level-heading="">
          <span className="lu-head__mark" aria-hidden="true">
            {o.separation === "clears" ? <CrownGlyph /> : o.separation === "insideNoise" ? <HazeGlyph /> : <FloorGlyph />}
          </span>
          {headline}
        </h2>
        <p className="lu-head__lead">{robust}</p>
        {running ? <p className="lu-head__site">{t("site", site)}</p> : null}
      </div>
      <div className="lu-head__order">
        <Segmented
          label={t("order.label")}
          lead={t("order.label")}
          value={order}
          onChange={(v) => onOrder(v === "neutral" ? "neutral" : "fit")}
          items={[
            { value: "fit", label: t("order.fit") },
            { value: "neutral", label: t("order.neutral") },
          ]}
        />
        <p className="lu-head__note">{t(order === "fit" ? "order.noteFit" : "order.noteNeutral")}</p>
      </div>
    </div>
  );
}
