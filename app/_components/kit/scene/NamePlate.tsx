import type { ReactNode } from "react";
import { ConditionMark } from "./ConditionMark";
import type { Condition } from "./conditions";
import "./scene.css";

/**
 * @catalog A thing's name plate: its name (the one emphasis), its condition in shape and words, and ONE fact; the border says the condition a third way (dashed = not set up or not read, coral = failing or the loudest fact on the page, solid = lit).
 *
 * Presentational: the caller owns the button (a plate is the face of a thing you open). A plate
 * without a `condition` is a static label (a place that is always there, e.g. the studio);
 * `align="centre"` centres it under a drawing.
 */
export function NamePlate({ title, condition, chip, fact, alert = false, align = "start" }: {
  title: string;
  condition?: Condition;
  /** The condition's words; required with a condition. */
  chip?: string;
  fact?: ReactNode;
  alert?: boolean;
  align?: "start" | "centre";
}) {
  return (
    <span className={align === "centre" ? "k-plate k-plate--centre" : "k-plate"} data-cond={condition} data-alert={alert ? "1" : undefined}>
      <span className="k-plate__title">{title}</span>
      {condition ? <ConditionMark condition={condition} label={chip ?? ""} loud={alert} /> : null}
      {fact ? <span className="k-plate__fact">{fact}</span> : null}
    </span>
  );
}
