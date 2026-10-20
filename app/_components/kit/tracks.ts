/*
 * Where a DataTable column sits on the measure. A column names a TRACK, never a width:
 * mark | name | meta | meta+N | fig | time | act. `meta+N` addresses the N-th extra track of a
 * subdivided meta (DataTable `metaSplit`), counted from the meta line - the variant's bare "4"
 * was meta+1. Pure, so the mapping is pinned by node:test.
 */
import type { Track } from "./types.ts";

export type TableTrack = Track | `meta+${number}`;

/** Grid lines of the measure: [mark]=1 [name]=2 [meta]=3; meta+N starts at line 3+N. */
const META_LINE = 3;

export function columnTrack(track: TableTrack): string {
  const m = /^meta\+(\d+)$/.exec(track);
  return m ? String(META_LINE + Number(m[1])) : track;
}

/** Tracks that fold to 0 with the meta track in the collapse order. */
export function isMetaTrack(track: TableTrack): boolean {
  return track === "meta" || track.startsWith("meta+");
}

/**
 * The measure's collapse order (kit.css container queries on the sheet): at <= 1000px the
 * extra meta tracks (meta+N) fold, at <= 860px meta itself and then act. mark, name, fig and
 * time never fold; name takes the room each step frees.
 */
export const FOLD_ORDER = ["meta+N", "meta", "act"] as const;
export const FOLD_AT = { "meta+N": 1000, meta: 860, act: 860 } as const;

/** Which fold step hides a track (0-based in FOLD_ORDER), or null when it never folds. */
export function foldStep(track: TableTrack): number | null {
  if (track.startsWith("meta+")) return 0;
  if (track === "meta") return 1;
  if (track === "act") return 2;
  return null;
}

/** The fold class a cell or head wears so the collapse order can hide it (kit.css). A meta+N
 *  cell wears both: it folds at the first step and stays folded with meta. */
export function foldClass(track: TableTrack): string {
  const step = foldStep(track);
  return step === 0 ? " in-meta in-meta-x" : step === 1 ? " in-meta" : step === 2 ? " in-act" : "";
}
