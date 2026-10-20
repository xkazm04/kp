"use client";

import { useRef, type CSSProperties } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatCount } from "../figure";
import { stepFigure, stepFill, type RailStep } from "./railModel";
import { StageRailColumn, type ColumnStep } from "./StageRailColumn";
import { usePlayOnce } from "./usePlayOnce";
import "./graphic.css";

export type { RailStep } from "./railModel";
export type { ColumnStep } from "./StageRailColumn";

type RowProps = {
  orientation?: "row";
  id: string;
  steps: readonly RailStep[];
  /** The group's accessible name (default "Steps"). */
  label?: string;
  selected?: string | null;
  onStep?: (id: string) => void;
  replayKey: string;
};
type ColumnProps = { orientation: "column"; steps: readonly ColumnStep[]; label?: string };

/**
 * @catalog Steps that fill as progress bars ("N of M", "N stop here", absent = hatched with its reason); a row of toggle buttons, or a column for a reading pane.
 *
 * Row: equal columns inside whatever track holds it (a table head's meta track, a full-width strip);
 * each step is a toggle button (aria-pressed) and the bars fill once per `replayKey`. Column: one step
 * per line (shape, label, count, first date), the document form a reading pane shows.
 */
export function StageRail(props: RowProps | ColumnProps) {
  if (props.orientation === "column") return <StageRailColumn steps={props.steps} label={props.label} />;
  return <StageRailRow {...props} />;
}

function StageRailRow({ id, steps, label, selected, onStep, replayKey }: RowProps) {
  const t = useTranslations("kit.graphic.rail");
  const locale = useLocale();
  const root = useRef<HTMLDivElement>(null);
  usePlayOnce(`rail:${id}`, replayKey, root);
  const n = (v: number) => formatCount(v, locale);

  const tipOf = (s: RailStep): string => {
    if (s.absent) return t("tipAbsent", { label: s.label, reason: s.absent });
    if (s.reached == null) return t("tipUnknown", { label: s.label });
    const base = t("tipReached", { label: s.label, reached: n(s.reached), of: n(s.of ?? s.reached), stopped: s.stopped ?? 0 });
    return `${base}${s.tip ? `. ${s.tip}` : ""}${onStep ? ` ${t("tipPress")}` : ""}`;
  };

  return (
    <div
      ref={root}
      className="k-rail"
      data-part="stage-rail"
      data-role="kit-rail"
      style={{ "--n": steps.length } as CSSProperties}
      role="group"
      aria-label={label ?? t("label")}
    >
      {steps.map((s, i) => {
        const sel = selected === s.id;
        const fig = stepFigure(s);
        const tip = tipOf(s);
        return (
          <button
            key={s.id}
            type="button"
            className={`k-rail__step${s.absent ? " is-absent" : ""}${sel ? " is-selected" : ""}`}
            style={{ "--i": i, "--p": stepFill(s).toFixed(3) } as CSSProperties}
            aria-pressed={sel}
            aria-label={tip}
            data-tip={tip}
            disabled={Boolean(s.absent) || !onStep}
            onClick={onStep ? () => onStep(s.id) : undefined}
            data-role="kit-rail-step"
          >
            <span className="k-rail__label">{s.label}</span>
            <span className="k-rail__bar" aria-hidden="true"><i /></span>
            <span className="k-rail__fig">
              {fig.kind === "unknown" ? (
                <span className="k-absent">—</span>
              ) : fig.kind === "none" ? (
                <span className="k-absent">{t("none")}</span>
              ) : (
                <>
                  <b className="k-nums">{n(fig.reached)}</b>
                  <span className="k-fig__of"> {t("of", { of: n(fig.of) })}</span>
                </>
              )}
            </span>
            <span className="k-rail__stop">{s.stopped ? t("stop", { count: s.stopped }) : ""}</span>
          </button>
        );
      })}
    </div>
  );
}
