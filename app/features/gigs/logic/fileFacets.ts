import { gigTypeOf, GIG_TYPES } from "@/app/_lib/gigs/gig-type";
import { GIG_ARENAS, GIG_STATUSES, type Gig, type GigArena } from "@/app/_lib/gigs/types";
import { type FileDim, type FileFilter, type FileState, type FileStatus, fileStateOf, matchesFile, statusMatches } from "./file";

// ---------------------------------------------------------------------------
// The whole file's dropdowns, faceted: each dimension's counts are taken over the gigs that
// pass EVERY OTHER active filter and the search, so picking an arena recounts the status and
// type options and the other way round. The aggregate options ("All", then "Active" for the
// status) lead; the rest follow by count, largest first. An option that holds nothing under
// the current combination sorts last and is `off` (disabled), unless it is the value picked:
// the picked value is never dropped and never disabled.
// ---------------------------------------------------------------------------

export type FacetOption<V> = { value: V; count: number; off: boolean };
export type FileFacets = {
  status: FacetOption<FileStatus>[];
  arena: FacetOption<GigArena | "all">[];
  /** A gig type (gig-type.ts); null = every lane. */
  lane: FacetOption<string | null>[];
};

/** Every state in the order of the line, "overdue" last: the tie-break under equal counts. */
const STATE_ORDER: readonly FileState[] = [...GIG_STATUSES, "overdue"];

function facet<V>(lead: readonly V[], rest: readonly V[], picked: V, count: (v: V) => number): FacetOption<V>[] {
  const tail = rest
    .map((value, i) => ({ value, count: count(value), i }))
    .sort((a, b) => b.count - a.count || a.i - b.i)
    .map(({ value, count: n }) => ({ value, count: n, off: n === 0 && value !== picked }));
  return [...lead.map((value) => ({ value, count: count(value), off: false })), ...tail];
}

/** The three dropdowns' options with their counts, for `gigs` under `filter` at `now`.
 *  A state or a lane is listed when any gig in the file holds it (or it is the value picked);
 *  an arena always is. */
export function fileFacets(gigs: readonly Gig[], filter: FileFilter, now: Date): FileFacets {
  const pool = (skip: FileDim) => gigs.filter((g) => matchesFile(g, filter, now, skip));

  const byStatus = pool("status");
  const held = new Set<FileStatus>(gigs.map((g) => fileStateOf(g, now)));
  const states: FileStatus[] = STATE_ORDER.filter((s) => held.has(s) || s === filter.status);
  if (filter.status === "verdict" || filter.status === "exit") states.push(filter.status);
  const status = facet<FileStatus>(["all", "active"], states, filter.status, (s) => byStatus.filter((g) => statusMatches(s, g, now)).length);

  const byArena = pool("arena");
  const arena = facet<GigArena | "all">(["all"], GIG_ARENAS, filter.arena, (a) => (a === "all" ? byArena.length : byArena.filter((g) => g.arena === a).length));

  const byLane = pool("lane");
  const types = new Set<string>(gigs.map((g) => gigTypeOf(g)));
  const lanes: string[] = GIG_TYPES.filter((l) => types.has(l) || l === filter.lane);
  if (filter.lane !== null && !lanes.includes(filter.lane)) lanes.push(filter.lane);
  const lane = facet<string | null>([null], lanes, filter.lane, (l) => (l === null ? byLane.length : byLane.filter((g) => gigTypeOf(g) === l).length));

  return { status, arena, lane };
}

/** Hidden by the status default: the gigs the other filters let through that "active" leaves out. */
export function hiddenByStatus(facets: FileFacets): number {
  const n = (v: FileStatus) => facets.status.find((o) => o.value === v)?.count ?? 0;
  return n("all") - n("active");
}
