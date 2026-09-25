/*
 * FlowTable's pure half: the class list a row wears and the grid variables its head and rows share.
 * No DOM, no CSS import, so node:test pins it. Added at Gate 1 (Settings > Hiring): a settings matrix
 * is a short table whose rows are EDITED, so it needs a table's head and tracks without DataTable's
 * windowing, pager and fixed row height, plus the draft states a settings row carries.
 */
import type { RowState } from "./types.ts";
import { foldedExtras, foldedTracks } from "./windowing.ts";

/** A flow row's states: the list row's, plus a draft's changed (amber edge) and error (red edge). */
export type FlowRowState = RowState | "changed" | "error";

export function flowRowClass(states: readonly FlowRowState[], detail: boolean): string {
  return ["k-table__row", "k-row", "k-flow__row", detail ? "has-detail" : "", ...states.map((s) => `is-${s}`)]
    .filter(Boolean)
    .join(" ");
}

/** The CSS variables the head and every row set: the meta split, its two fold steps, and an optional
 *  name track (a settings matrix gives its controls the room a long name would otherwise take). */
export function flowVars(metaSplit?: string, nameTrack?: string): Record<string, string> {
  const meta = metaSplit ?? "minmax(0,1fr)";
  return {
    "--t-meta": meta,
    "--t-meta1": foldedExtras(meta),
    "--t-meta0": foldedTracks(meta),
    ...(nameTrack ? { "--t-name": nameTrack } : {}),
  };
}
