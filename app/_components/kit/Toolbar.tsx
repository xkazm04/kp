"use client";

import type { ReactNode } from "react";
import { useLocale } from "next-intl";
import { KitIcon } from "./icons";
import { formatCount } from "./figure";
import { Measure } from "./Measure";
import "./kit.css";

export type Segment = { value: string; label: string; count?: number; mark?: ReactNode; disabled?: boolean; tip?: string };

/**
 * @catalog A segmented control: the pressed segment is raised (Studio Light) or an amber sticker (Spark Dark), with an optional mark and count per segment; disabled segments stay visible; an optional visible lead names the group.
 */
export function Segmented({ items, value, onChange, label, lead }: {
  items: Segment[];
  value: string;
  onChange: (v: string) => void;
  label: string;
  /** A visible quiet word before the group, e.g. a preset row's lead; `label` stays the group's accessible name. */
  lead?: string;
}) {
  const locale = useLocale();
  const group = (
    <div className="k-seg" role="group" aria-label={label} data-role="kit-seg">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          aria-pressed={it.value === value}
          disabled={it.disabled}
          data-tip={it.tip}
          onClick={() => onChange(it.value)}
        >
          {it.mark}
          {it.label}
          {it.count != null ? <span className="k-seg__n"> {formatCount(it.count, locale)}</span> : null}
        </button>
      ))}
    </div>
  );
  if (!lead) return group;
  return (
    <span className="k-seg-lead">
      <span className="k-seg-lead__word" aria-hidden>{lead}</span>
      {group}
    </span>
  );
}

/** @catalog The kit search field: 40px, a search glyph, the label as placeholder AND screen-reader name. */
export function SearchField({ label, value, onChange, disabled }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`k-field${disabled ? " is-disabled" : ""}`} data-role="kit-search">
      <KitIcon name="search" />
      <span className="sr-only">{label}</span>
      <input type="search" placeholder={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/**
 * @catalog The toolbar on the measure: segmented mark->fig, search fig->act, actions in act, filters on a second line from the name track (inline puts them on line one).
 */
export function Toolbar({ segmented, search, filters, actions, inline = false }: {
  segmented?: ReactNode;
  search?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
  inline?: boolean;
}) {
  return (
    <Measure className={`k-toolbar${inline ? " k-toolbar--inline" : ""}`} data-part="toolbar">
      <div className="k-toolbar__seg">{segmented}</div>
      {filters ? <div className="k-toolbar__filters">{filters}</div> : null}
      {search ? <div className="k-toolbar__search">{search}</div> : null}
      {actions ? <div className="k-toolbar__acts">{actions}</div> : null}
    </Measure>
  );
}
