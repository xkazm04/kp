// How the Broadsheet gets EVERY role, not the first page of them.
//
// GET /api/journeys pages by column and caps a page at 50 (JOURNEY_MAX_LIMIT in
// app/_lib/journey/project.ts, server-only). The board asked for 120, got 50, and
// never sent a role, so it drew only the roles whose journeys sort into the first
// 50: 6 of 19 in the live corpus (2026-09-25), and a descent from the cohort layer
// into any other role showed an empty board.
//
// So the unfiltered board reads page after page until `totals.columns` is covered
// (bounded by JOURNEY_MAX_PAGES), and merges the clusters by role. The pages are
// ordered by role, so a role can straddle a page boundary; its two halves carry
// rails derived from HALF the role each (a rail is computed per page), which is a
// wrong cohort statement. Those roles are re-read whole with `?role=` and replace
// the halves: the server derives their rail from all of their columns.
//
// Pure and JSX-free, so node:test reaches it.

import type { JourneyBoard, RoleCluster } from "@/app/_lib/journey/types";

/** The server's page ceiling. Asking for more returns this many. */
export const JOURNEY_SERVER_PAGE = 50;

/** At most this many pages (500 journeys): a board is a reading surface, and a
 *  bigger workspace says how much it shows (`capped`) rather than stalling. */
export const JOURNEY_MAX_PAGES = 10;

/** The offsets still to read after the first page, within the page budget. */
export function remainingOffsets(total: number, pageSize: number, maxPages = JOURNEY_MAX_PAGES): number[] {
  const out: number[] = [];
  if (pageSize <= 0) return out;
  for (let offset = pageSize; offset < total && out.length < maxPages - 1; offset += pageSize) out.push(offset);
  return out;
}

/** Merge pages into one board, in page order. `split` names the roles that
 *  appeared on more than one page and must be re-read whole. */
export function mergeBoardPages(pages: readonly JourneyBoard[]): { board: JourneyBoard; split: string[] } {
  const order: string[] = [];
  const byRole = new Map<string, RoleCluster>();
  const split = new Set<string>();
  for (const page of pages) {
    for (const cluster of page.clusters) {
      const seen = byRole.get(cluster.jobId);
      if (!seen) {
        order.push(cluster.jobId);
        byRole.set(cluster.jobId, cluster);
      } else {
        split.add(cluster.jobId);
        byRole.set(cluster.jobId, { ...seen, columns: [...seen.columns, ...cluster.columns] });
      }
    }
  }
  const first = pages[0];
  const clusters = order.map((id) => byRole.get(id) as RoleCluster);
  return {
    board: { clusters, totals: first?.totals ?? { roles: 0, columns: 0, events: 0 }, query: first?.query ?? { activeOnly: false, limit: 0, offset: 0 } },
    split: [...split],
  };
}

/** Swap in the whole-role clusters read for the split roles. */
export function replaceClusters(board: JourneyBoard, whole: readonly RoleCluster[]): JourneyBoard {
  const byRole = new Map(whole.map((c) => [c.jobId, c]));
  return { ...board, clusters: board.clusters.map((c) => byRole.get(c.jobId) ?? c) };
}

/** How many columns the merged board holds against the workspace's total. */
export function boardCoverage(board: JourneyBoard): { shown: number; total: number } {
  return { shown: board.clusters.reduce((n, c) => n + c.columns.length, 0), total: board.totals.columns };
}
