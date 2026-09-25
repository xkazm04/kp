/*
 * The pure half of the kit's form parts (Field.tsx, SaveBar.tsx, SettingRow's detail line): the class
 * a text or select control wears, and what a save bar's state draws. No DOM, no CSS import, so
 * node:test pins it. Added at Gate 1 (Settings > Hiring), the first settings surface built on the kit:
 * the variant drew `input.k-input` and a sticky save bar as raw markup, and the kit had no part for either.
 */
import type { MarkKind } from "./types.ts";

/** md = 40px (a form's field); sm = 32px (a control inside a setting row, the height of a sm Button). */
export type FieldSize = "sm" | "md";

/** The class list of a kit text or select control (kit.css `input.k-input`, `select.k-input`). */
export function inputClass(size: FieldSize = "md", className?: string): string {
  return ["k-input", size === "sm" ? "k-input--sm" : "", className ?? ""].filter(Boolean).join(" ");
}

/** A save bar's state: nothing to save, a draft to save, a draft that cannot be saved, a save in flight. */
export type SaveTone = "clean" | "dirty" | "blocked" | "saving";

/** The mark a save bar hangs in the mark track: its SHAPE says the state; the words sit beside it. */
export const SAVE_MARK: Record<SaveTone, MarkKind> = { clean: "ok", dirty: "caution", blocked: "fail", saving: "wait" };

/** The save bar's class list (kit.css `.k-savebar`, `.is-dirty` / `.is-blocked` / `.is-saving`). */
export function saveBarClass(tone: SaveTone): string {
  return tone === "clean" ? "k-savebar" : `k-savebar is-${tone}`;
}

/** Which tone a draft is in. Blocked wins over dirty: a draft that cannot be saved must say so first. */
export function saveTone(s: { dirty: boolean; blocked: boolean; saving: boolean }): SaveTone {
  if (s.saving) return "saving";
  if (s.blocked) return "blocked";
  return s.dirty ? "dirty" : "clean";
}
