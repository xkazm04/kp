import type { Gig, GigArena, GigAttempt, GigStatus } from "@/app/_lib/gigs/types";
import { deadlineView } from "./facts";
import { EXIT_STATUSES } from "./lanes";
import { matchesSearch } from "./line";
import { laneOfGig } from "./niches";

// ---------------------------------------------------------------------------
// The whole file: every gig, filtered and sorted
// ---------------------------------------------------------------------------

/** A status chip, or one of the two groups a lane cell opens: the judge's verdicts and
 *  the ways off the line. */
export type FileStatus = GigStatus | "all" | "verdict" | "exit";
export const FILE_SORTS = ["touched", "deadline", "fit", "reward"] as const;
export type FileSort = (typeof FILE_SORTS)[number];

export type FileFilter = {
  status: FileStatus;
  arena: GigArena | "all";
  /** A niche key (or NO_LANE) opened from Lanes; null = every lane. */
  lane: string | null;
  search: string;
  sort: FileSort;
  /** 1 = the sort's natural order, -1 reversed. */
  dir: 1 | -1;
};

export const EMPTY_FILE: FileFilter = { status: "all", arena: "all", lane: null, search: "", sort: "touched", dir: 1 };

export function statusMatches(filter: FileStatus, status: GigStatus): boolean {
  if (filter === "all") return true;
  if (filter === "verdict") return status === "accepted" || status === "rejected";
  if (filter === "exit") return (EXIT_STATUSES as readonly string[]).includes(status);
  return filter === status;
}

/** The file's rows. `touched` keeps the list's own order (most recently touched first).
 *  `deadline`: soonest open first, then the closed ones, then no deadline. `fit`: the scan's
 *  score, highest first, unscored last. `reward`: within ONE currency, largest first -
 *  currencies are grouped, never converted or compared, and an unstated reward sorts last.
 *  `dir` reverses the known part; absences stay at the end either way. */
export function fileRows(
  gigs: readonly Gig[],
  attemptsByGig: Readonly<Record<string, GigAttempt>>,
  filter: FileFilter,
  nicheBySpecialist: ReadonlyMap<string, string>,
  now: Date
): Gig[] {
  const rows = gigs.filter(
    (g) =>
      statusMatches(filter.status, g.status) &&
      (filter.arena === "all" || g.arena === filter.arena) &&
      (filter.lane === null || laneOfGig(g, attemptsByGig[g.id] ?? null, nicheBySpecialist) === filter.lane) &&
      matchesSearch(g, filter.search)
  );
  const dir = filter.dir;
  if (filter.sort === "deadline") {
    const key = (g: Gig) => {
      const d = deadlineView(g.deadlineAt, now);
      if (d.state === "none") return { band: 2, v: 0 };
      if (d.state === "passed") return { band: 1, v: -Date.parse(d.at) };
      return { band: 0, v: Date.parse(d.at) };
    };
    return rows
      .map((g) => ({ g, k: key(g) }))
      .sort((a, b) => a.k.band - b.k.band || (a.k.band === 0 ? (a.k.v - b.k.v) * dir : a.k.v - b.k.v))
      .map((x) => x.g);
  }
  if (filter.sort === "fit") {
    return [...rows].sort((a, b) => {
      const x = a.qualification?.score ?? null;
      const y = b.qualification?.score ?? null;
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      return (y - x) * dir;
    });
  }
  if (filter.sort === "reward") {
    return [...rows].sort((a, b) => {
      const x = a.reward?.amount ?? null;
      const y = b.reward?.amount ?? null;
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      const cx = a.reward?.currency ?? "";
      const cy = b.reward?.currency ?? "";
      if (cx !== cy) return cx < cy ? -1 : 1;
      return (y - x) * dir;
    });
  }
  return dir === 1 ? [...rows] : [...rows].reverse();
}
