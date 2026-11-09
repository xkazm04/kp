// /one's SEEN-RECORD (round 5, docs/design/one-interface.md "Motion orchestration") — what
// the surface has already shown, consulted before ANY entrance so an entrance is a
// first-arrival gesture and never replays on a refresh, a remount or a re-render.
//
//   views  by VIEW IDENTITY (`viewKey`: look + kind + params — never the session's panel id,
//          which is new on every answer): a region swapping to a view it has shown before
//          crossfades instead of arriving.
//   rows   by stable row key, SURFACE-wide (a candidate is the same row in the list, a slice
//          and a queue): a row the surface has shown stays still wherever it appears again.
//          A row it has not shown cascades in on its view's FIRST arrival (never-seen →
//          ready; the list orchestrates), or — in a view already shown — plays the small
//          "new member" gesture once on its own.
//
// Module-level on purpose: the record outlives a remount (a workspace tab switch remounts One,
// and coming back is not an arrival). Pure apart from that, so seen.test.ts pins it.
import type { PanelInstance } from "../types";

/** A view's identity: look + kind + its params in a stable order. */
export function viewKey(panel: Pick<PanelInstance, "kind" | "params">, look = ""): string {
  const params = Object.keys(panel.params)
    .sort()
    .map((k) => `${k}=${panel.params[k]}`)
    .join("&");
  return `${look}|${panel.kind}|${params}`;
}

/** How a row arrives: `cascade` (unseen, on its view's first arrival — the list
 *  orchestrates it), `member` (unseen, joining a view already shown — plays once on its
 *  own), `still` (the surface has shown it). */
export type RowArrival = "cascade" | "member" | "still";

export function createSeenRecord() {
  const views = new Set<string>();
  const rows = new Set<string>();
  return {
    /** Has this view been shown (ready) before? */
    seen: (view: string): boolean => views.has(view),
    row(view: string, rowKey: string): RowArrival {
      if (rows.has(rowKey)) return "still";
      return views.has(view) ? "member" : "cascade";
    },
    /** Record that `view` is on screen with these rows (after the commit that drew them). */
    mark(view: string, rowKeys: readonly string[] = []): void {
      views.add(view);
      for (const k of rowKeys) rows.add(k);
    },
  };
}

export type SeenRecord = ReturnType<typeof createSeenRecord>;

/** The record /one draws against (one surface per page). */
export const oneSeen: SeenRecord = createSeenRecord();
