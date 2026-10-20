import { Mark } from "../Mark";
import { CONDITION_MARK, type Condition } from "./conditions";
import "./scene.css";

/**
 * @catalog A condition in shape AND words (never colour alone): the kit Mark, hidden from assistive tech because the words beside it already say it, then the words at 14px or more.
 *
 * `loud` is the ONE condition on a surface that must be read first (a coral fill in both registers).
 * The element carries `data-cond`, so a drawing beside it can take its state from the nearest
 * `[data-cond]` (the Night Post's art does).
 */
export function ConditionMark({ condition, label, loud = false }: { condition: Condition; label: string; loud?: boolean }) {
  return (
    <span className="k-cond" data-cond={condition} data-loud={loud ? "1" : undefined}>
      <span className="k-cond__mark" aria-hidden="true">
        <Mark kind={CONDITION_MARK[condition]} />
      </span>
      <span className="k-cond__words">{label}</span>
    </span>
  );
}
