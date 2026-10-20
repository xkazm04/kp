"use client";

import type { KeyboardEvent, ReactNode } from "react";
import type { Provenance, RowState } from "./types";
import { Measure } from "./Measure";
import "./kit.css";

/**
 * @catalog One row on the measure: mark, the ONE weight-600 name (+ a quiet sub line), meta, nowrap figure and time, actions revealed on hover/focus/selection. States selected / hover / muted / needs; generated = italic, name-only = "≈" wavy.
 */
export function ListRow({
  mark, name, sub, meta, fig, time, actions, state = [], provenance = "observed", onSelect, rowKey,
}: {
  mark?: ReactNode;
  name: ReactNode;
  sub?: ReactNode;
  meta?: ReactNode;
  fig?: ReactNode;
  time?: ReactNode;
  actions?: ReactNode;
  state?: RowState[];
  provenance?: Provenance;
  onSelect?: () => void;
  rowKey?: string;
}) {
  const cls = ["k-row", sub ? "is-two" : "", ...state.map((s) => `is-${s}`)].filter(Boolean).join(" ");
  const nameCls = `k-row__name${provenance === "generated" ? " k-gen" : provenance === "name-only" ? " k-approx" : ""}`;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (onSelect && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onSelect();
    }
  };
  return (
    <Measure
      className={cls}
      data-part="list-row"
      data-role="kit-row"
      data-select={onSelect ? rowKey ?? "" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      role={onSelect ? "button" : undefined}
      aria-pressed={onSelect ? state.includes("selected") : undefined}
      onClick={onSelect}
      onKeyDown={onSelect ? onKeyDown : undefined}
    >
      <div className="k-row__mark">{mark}</div>
      <div className={nameCls}>
        {provenance === "name-only" ? "≈ " : null}
        {name}
        {sub ? <small>{sub}</small> : null}
      </div>
      <div className="k-row__meta">{meta}</div>
      <div className="k-row__fig">{fig}</div>
      <div className="k-row__time">{time}</div>
      <div className="k-row__acts" onClick={(e) => e.stopPropagation()}>{actions}</div>
    </Measure>
  );
}
