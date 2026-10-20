/*
 * The ONE way the kit sets a number (kit.js fig()): a value, an optional "of N", a unit and a
 * signed delta. A null value is an ABSENCE, rendered as an em dash with its reason in a tip,
 * never as 0. Pure, so formatting is pinned by node:test.
 */
import type { Figure } from "./types.ts";

export const ABSENT = "—";

export function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** The printed value: a number in the reader's locale, a string as given, null as "—". */
export function figureValue(value: Figure["value"], locale: string): string {
  if (value == null) return ABSENT;
  return typeof value === "number" ? formatCount(value, locale) : value;
}

/** "+3" / "−2" (a real minus sign), or null for no delta. Down is good (moss), up needs you. */
export function figureDelta(delta: number | undefined, locale: string): { text: string; dir: "up" | "down" } | null {
  if (!delta) return null;
  return { text: `${delta > 0 ? "+" : "−"}${formatCount(Math.abs(delta), locale)}`, dir: delta < 0 ? "down" : "up" };
}

/** The bar under a figure, as a clamped CSS percentage, or null when the figure draws nothing. */
export function figureDraw(draw: number | undefined): string | null {
  if (draw == null || Number.isNaN(draw)) return null;
  return `${Math.max(0, Math.min(100, draw * 100)).toFixed(1)}%`;
}

/** The figure's class list (kit.css .k-fig--needs / --absent). */
export function figureClass(f: Pick<Figure, "value" | "tone">, rolling = false): string {
  return [
    "k-fig",
    f.tone === "needs" ? "k-fig--needs" : "",
    f.value == null ? "k-fig--absent" : "",
    rolling ? "is-rolling" : "",
  ].filter(Boolean).join(" ");
}
