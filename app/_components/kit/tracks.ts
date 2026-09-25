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

/** The fold class a cell or head wears so the collapse order can hide it (kit.css). */
export function foldClass(track: TableTrack): string {
  return track === "act" ? " in-act" : isMetaTrack(track) ? " in-meta" : "";
}
