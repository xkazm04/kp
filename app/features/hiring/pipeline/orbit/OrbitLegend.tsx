"use client";

import { useTranslations } from "next-intl";
import { ChipButton } from "@/app/_components/kit";
import type { StageDef } from "@/app/features/shared/pipelineTypes";
import { LegendBead, OrbitMark } from "./OrbitMarks";
import type { OrbitWords } from "./orbitWords";

type Props = {
  axis: readonly StageDef[];
  words: OrbitWords;
  /** The focused ring (axis index), or null. */
  ring: number | null;
  onRing: (i: number | null) => void;
  /** People per stage (axis order) and each ring's name, as the orbit draws them. */
  counts: readonly number[];
  ringLabels: readonly string[];
  people: number;
  closedEmpty: number;
  jobsMissing: boolean;
};

/**
 * Under the opened orbit: the ring key ("The Orbit, Lit": each stage and its count as a kit chip, a press focuses
 * that ring, pressed again or Esc shows every stage) and the legend of marks, with what is not drawn
 * and why.
 */
export function OrbitLegend({ axis, words, ring, onRing, counts, ringLabels, people, closedEmpty, jobsMissing }: Props) {
  const { t, n } = words;
  const tr = useTranslations("overviewLit.ringKey");
  return (
    <>
      <div className="ob-ringkey" role="group" aria-label={tr("lead")}>
        <span aria-hidden>{tr("lead")}</span>
        {axis.map((st, i) => (
          <ChipButton key={st.id} chip={{ id: st.id, label: tr("item", { stage: ringLabels[i], count: counts[i] ?? 0 }), pressed: ring === i, onPress: () => onRing(ring === i ? null : i) }} />
        ))}
      </div>
      <div className="ob-legend">
        <span><LegendBead kind="w" />{t("legendWaiting")}</span>
        <span><LegendBead kind="a" />{t("legendLate")}</span>
        <span><LegendBead kind="q" />{t("legendOnTime")}</span>
        <span><LegendBead kind="h" />{t("legendHired")}</span>
        <span><LegendBead kind="q" placed />{t("legendPlaced")}</span>
        <span><OrbitMark kind="vacant" /><OrbitMark kind="draft" />{t("legendRim")}</span>
        <span>{t("legendWidth")}</span>
        {closedEmpty ? <span>{t("legendClosed", { count: closedEmpty })}</span> : null}
        {jobsMissing ? <span className="ob-legend__warn">{t("legendNoJobs")}</span> : null}
        <span className="ob-legend__n">{t("legendTotal", { people: n(people) })}</span>
      </div>
    </>
  );
}
