"use client";

import { useTranslations } from "next-intl";
import type { ShapeKind, StageTone } from "../types";
import { cellReached } from "./railModel";
import { ShapeMark } from "./ShapeMark";
import "./graphic.css";

/** One step of a single journey, as a reading pane lists it. */
export type ColumnStep = {
  id: string;
  label: string;
  shape: ShapeKind;
  tone?: StageTone;
  /** The shape's meaning ("Screened: 2 recorded"). */
  tip: string;
  /** Recorded events at this step (shown when the step was reached). */
  count?: number;
  /** Why an unreached step reads as it does ("here now, no event records the arrival"). */
  reason?: string;
  /** The first event's date, already formatted by the caller. */
  time?: string;
};

/**
 * StageRail's column form (the winner's .k-vrail): one line per step with its provenance shape, the
 * label (ink once reached), how many events prove it or why nothing does, and when it first happened.
 * A step nobody recorded stays in place as a gap; it is never dropped from the rail.
 */
export function StageRailColumn({ steps, label }: { steps: readonly ColumnStep[]; label?: string }) {
  const t = useTranslations("kit.graphic.rail");
  return (
    <div className="k-vrail" data-part="stage-rail" data-role="kit-vrail" role="list" aria-label={label ?? t("label")}>
      {steps.map((s) => {
        const reached = cellReached(s.shape);
        return (
          <div key={s.id} className={`k-vrail__step${reached ? " is-reached" : ""}`} role="listitem">
            <ShapeMark shape={s.shape} tone={s.tone} tip={s.tip} />
            <span className="k-vrail__label">{s.label}</span>
            <span className="k-vrail__n">
              {reached ? (
                t("events", { count: s.count ?? 0 })
              ) : (
                <span className="k-absent">{s.reason ?? t("notReached")}</span>
              )}
            </span>
            <span className="k-vrail__t">{reached ? s.time ?? "" : ""}</span>
          </div>
        );
      })}
    </div>
  );
}
