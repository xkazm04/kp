// The board's filters, as a pure function over the payload.
//
// Every filter here narrows what is DRAWN; none of them changes what a row says.
// That matters for one of them in particular: "Observed rows only" removes rows
// the ledger cannot vouch for, and a band left empty by it must still say so
// (journeyLayout's `never-recorded` / `allGenerated` states) rather than quietly
// reading as "nothing happened".
//
// Pure and JSX-free so `node --test` can load it.

import type { JourneyBoard, JourneyColumn, RoleCluster } from "@/app/_lib/journey/types";

export type JourneyFilterState = {
  /** Selected role ids. Empty = every role. */
  roles: string[];
  activeOnly: boolean;
  observedOnly: boolean;
  /** Include columns whose `origin` is a test run. Off by default: a /uat L2 run
   *  produces genuine columns against a real database and they must never be
   *  read as live traffic. */
  testRuns: boolean;
  /** Free text over the candidate label. Narrows the board rather than only
   *  jumping to a hit, so a search with no match says so instead of silently
   *  leaving the reader where they were. */
  find: string;
};

export const EMPTY_JOURNEY_FILTERS: JourneyFilterState = {
  roles: [],
  activeOnly: false,
  observedOnly: false,
  testRuns: false,
  find: "",
};

/**
 * Fold case and strip combining marks so "Veselá" is found by typing "vesela".
 * Candidate names in this corpus are Czech more often than not, and a find box
 * that needs the right diacritic is a find box that does not work.
 */
export function foldForSearch(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();
}

export function columnMatchesFind(column: Pick<JourneyColumn, "candidateLabel" | "stage">, needle: string): boolean {
  if (needle === "") return true;
  const folded = foldForSearch(needle);
  return (
    foldForSearch(column.candidateLabel).includes(folded) || foldForSearch(column.stage).includes(folded)
  );
}

function keepColumn(column: JourneyColumn, filters: JourneyFilterState): boolean {
  if (filters.activeOnly && !column.active) return false;
  if (!filters.testRuns && column.origin.kind === "test-run") return false;
  if (!columnMatchesFind(column, filters.find)) return false;
  return true;
}

/**
 * Narrow the board. Clusters that lose every column are dropped — an empty role
 * cluster with a shared band and a rail but no columns tells the reader nothing
 * and costs a screenful of vertical travel.
 *
 * `totalColumns` is left as the SERVER reported it: it counts the whole role,
 * including the page the client never received, and overwriting it with a
 * filtered count would turn an honest "45 in this role" into a lie about the
 * cohort the rail's "38 of 45" is measured against.
 */
export function filterBoard(board: JourneyBoard, filters: JourneyFilterState): JourneyBoard {
  const roleSet = new Set(filters.roles);
  const clusters: RoleCluster[] = [];
  for (const cluster of board.clusters) {
    if (roleSet.size > 0 && !roleSet.has(cluster.jobId)) continue;
    const columns = cluster.columns.filter((column) => keepColumn(column, filters));
    if (columns.length === 0) continue;
    clusters.push({ ...cluster, columns });
  }
  return { ...board, clusters };
}

/** Is anything narrowing the board right now? Drives the "no matches" copy. */
export function isFiltering(filters: JourneyFilterState): boolean {
  return (
    filters.roles.length > 0 ||
    filters.activeOnly ||
    filters.observedOnly ||
    filters.testRuns ||
    filters.find.trim() !== ""
  );
}

/** Toggle one role in the selection. */
export function toggleRole(filters: JourneyFilterState, jobId: string): JourneyFilterState {
  const roles = filters.roles.includes(jobId)
    ? filters.roles.filter((id) => id !== jobId)
    : [...filters.roles, jobId];
  return { ...filters, roles };
}
