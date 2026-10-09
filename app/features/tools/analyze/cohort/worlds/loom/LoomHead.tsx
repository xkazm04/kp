"use client";

import { Segmented } from "@/app/_components/kit";
import { COHORT_DIMENSIONS, type CohortView } from "../../cohortTypes";
import { landedCount, rowReading, type LoomOrder } from "./loomModel";
import type { LoomWords } from "./useLoomWords";

/**
 * The loom's head: what is on it (threads x rows), the overall claim as the heading (the studio
 * above names the role) in the loom's vocabulary (a clearing lead names its leader; inside the noise it names who shares first and says
 * there is no lead; below the floor it names nothing), how robust the order is, how much of the run
 * has landed, and how the threads hang (neutral by default: an order is not a verdict).
 */
export function LoomHead({ view, words, order, onOrder }: {
  view: CohortView;
  words: LoomWords;
  order: LoomOrder;
  onOrder: (o: LoomOrder) => void;
}) {
  const { t, name, names } = words;
  const overall = view.claims.overall;
  const fit = rowReading(view, "fit");
  const claim =
    overall.separation === "clears" && overall.leader
      ? t("overall.clears", { name: name(overall.leader) })
      : overall.separation === "insideNoise" && fit.kind === "insideNoise"
        ? t("overall.insideNoise", { names: names(fit.noise) })
        : t("overall.belowFloor");
  const kind = overall.separation === "clears" && overall.leader ? "clears" : fit.kind === "insideNoise" ? "insideNoise" : "belowFloor";
  const failed = view.members.filter((m) => m.runState === "failed").length;
  const total = view.members.length;
  const landed = landedCount(view);
  return (
    <div className="lm-head">
      <div className="lm-head__titles">
        <p className="lm-head__kicker">{t("kicker", { threads: total, rows: COHORT_DIMENSIONS.length })}</p>
        <h2 className="lm-head__claim" data-kind={kind} tabIndex={-1} data-level-heading="">
          <span className="lm-head__mark" aria-hidden />
          {claim}
        </h2>
        <p className="lm-head__facts">
          <span>{t(`robustness.${overall.robustness}`)}</span>
          <span>{view.status === "done" ? t("run.done", { landed, total }) : t("run.running", { landed, total })}</span>
          {failed > 0 ? <span>{t("run.failed", { n: failed })}</span> : null}
        </p>
      </div>
      <div className="lm-head__order">
        <Segmented
          label={t("order.label")}
          value={order}
          onChange={(v) => onOrder(v === "fit" ? "fit" : "neutral")}
          items={[
            { value: "neutral", label: t("order.neutral") },
            { value: "fit", label: t("order.fit") },
          ]}
        />
        <p className="lm-head__note">{order === "neutral" ? t("order.neutralNote") : t("order.fitNote")}</p>
      </div>
    </div>
  );
}
