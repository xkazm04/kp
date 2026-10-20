"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatCount } from "./figure";
import { Measure } from "./Measure";
import "./kit.css";

/**
 * @catalog A setting on the measure: name (+ sub) / one-line consequence / control / actions; changed = an amber edge, muted when a parent setting disables it, error = the field's border; an optional detail line opens under it from the name track.
 */
export function SettingRow({
  mark, name, sub, consequence, control, wide = false, actions, state = [], detail,
}: {
  mark?: ReactNode;
  name: ReactNode;
  sub?: ReactNode;
  consequence?: ReactNode;
  control?: ReactNode;
  /** A text control takes meta -> act instead of fig -> act. */
  wide?: boolean;
  actions?: ReactNode;
  state?: ("changed" | "muted" | "error")[];
  /** A second line under the row, from the name track to the end: the setting's expanded editor
   *  (a chip set, a longer list) when one line cannot hold it. Absent = the row stays one line. */
  detail?: ReactNode;
}) {
  return (
    <Measure className={["k-set", ...state.map((s) => `is-${s}`)].join(" ")} data-part="setting-row" data-role="kit-setting">
      <div className="k-row__mark">{mark}</div>
      <div className="k-set__name">
        {name}
        {sub ? <small>{sub}</small> : null}
      </div>
      {wide ? null : <div className="k-set__why">{consequence}</div>}
      <div className={`k-set__ctl${wide ? " is-wide" : ""}`}>{control}</div>
      <div className="k-set__acts">{actions}</div>
      {detail ? <div className="k-set__detail" data-role="kit-setting-detail">{detail}</div> : null}
    </Measure>
  );
}

/** @catalog The kit toggle: a 44x26 switch, moss when on. */
export function Toggle({ on, label, onChange, disabled }: {
  on: boolean;
  label: string;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" role="switch" className="k-toggle" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />
  );
}

/** @catalog The kit stepper: minus / value / plus in a 36px frame, tabular numerals. */
export function Stepper({ value, unit, label, onStep, disabled, min, max }: {
  value: number;
  unit?: string;
  label: string;
  onStep: (delta: 1 | -1) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
}) {
  const t = useTranslations("kit.stepper");
  const locale = useLocale();
  return (
    <span className={`k-stepper${disabled ? " is-disabled" : ""}`} role="group" aria-label={label}>
      <button type="button" aria-label={t("decrease")} disabled={disabled || (min != null && value <= min)} onClick={() => onStep(-1)}>
        {"−"}
      </button>
      <output>
        {formatCount(value, locale)}
        {unit ?? ""}
      </output>
      <button type="button" aria-label={t("increase")} disabled={disabled || (max != null && value >= max)} onClick={() => onStep(1)}>
        +
      </button>
    </span>
  );
}
