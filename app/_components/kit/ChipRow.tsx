"use client";

import type { ReactNode } from "react";
import { useLocale } from "next-intl";
import { formatCount } from "./figure";
import "./kit.css";

export type Chip = {
  id: string;
  label: string;
  count?: number;
  mark?: ReactNode;
  pressed?: boolean;
  /** A chip whose count is 0 stays visible and disabled. */
  disabled?: boolean;
  tip?: string;
  onPress: () => void;
};

/**
 * @catalog An actionable chip: a 30px pill with an optional mark and a plain-numeral count, pressed / disabled states.
 */
export function ChipButton({ chip }: { chip: Chip }) {
  const locale = useLocale();
  return (
    <button
      type="button"
      className="k-chip"
      aria-pressed={chip.pressed ?? false}
      disabled={chip.disabled}
      data-tip={chip.tip}
      onClick={chip.onPress}
      data-role="kit-chip"
    >
      {chip.mark}
      {chip.label}
      {chip.count != null ? <span className="k-chip__n"> {formatCount(chip.count, locale)}</span> : null}
    </button>
  );
}

/**
 * @catalog A row of actionable chips (filters); a non-actionable token is a Tag, never a chip.
 */
export function ChipRow({ chips }: { chips: Chip[] }) {
  return (
    <div className="k-chips" data-part="chips">
      {chips.map((c) => <ChipButton key={c.id} chip={c} />)}
    </div>
  );
}

/** @catalog An inert token (a language code, a kind): quiet plane in Studio Light, an outline pill in Spark Dark. */
export function Tag({ label }: { label: string }) {
  return <span className="k-tag">{label}</span>;
}
