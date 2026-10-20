import { gigTypeOf } from "@/app/_lib/gigs/gig-type";
import type { Gig, GigArena, GigReward, GigRewardUsd, GigStatus } from "@/app/_lib/gigs/types";
import { deadlineView } from "./facts";
import { EXIT_STATUSES } from "./lanes";
import { matchesSearch } from "./line";

// ---------------------------------------------------------------------------
// The whole file: every gig, filtered and sorted
// ---------------------------------------------------------------------------

/** Where a gig stands in the file: its status, or "overdue" for a gig still unsent whose
 *  deadline has gone (it can no longer be sent, whatever its status says). Every gig has
 *  exactly one, so the status dropdown's counts add up to "all". */
export type FileState = GigStatus | "overdue";
/** The states the file hides until asked (EMPTY_FILE's "active" leaves them out): the ways a
 *  gig ends without a win. "suspect" is NOT one: a quarantined gig waits for the operator. */
export const NEGATIVE_STATES = ["declined", "withdrawn", "expired", "rejected", "overdue"] as const satisfies readonly FileState[];
/** The status dropdown's value: one state; "active" (every state but the negative ones, the
 *  default); "all"; or one of the two groups a lane cell opens (the judge's verdicts, the
 *  ways off the line). */
export type FileStatus = FileState | "active" | "all" | "verdict" | "exit";
export const FILE_SORTS = ["touched", "deadline", "fit", "reward"] as const;
export type FileSort = (typeof FILE_SORTS)[number];

export type FileFilter = {
  status: FileStatus;
  arena: GigArena | "all";
  /** A gig type opened from Lanes (gig-type.ts); null = every lane. */
  lane: string | null;
  search: string;
  sort: FileSort;
  /** 1 = the sort's natural order, -1 reversed. */
  dir: 1 | -1;
};

/** Amounts that already ARE US dollars (the stablecoins are pegged 1:1). */
const USD_LIKE: ReadonlySet<string> = new Set(["USD", "USDC", "USDT"]);
/** Currencies the operator reads as they are: no dollar estimate beside them. */
const READ_AS_IS: ReadonlySet<string> = new Set([...USD_LIKE, "EUR"]);

/** A reward's value in US dollars, for sorting across currencies: the amount itself for
 *  dollars and their stablecoins, else the scan's conversion (`reward.usd`, at the rate of
 *  the scan day); null when there is no amount or no rate - it sorts last. */
export function rewardUsd(r: GigReward | null): number | null {
  if (!r || r.amount === null) return null;
  if (USD_LIKE.has(r.currency?.toUpperCase() ?? "")) return r.amount;
  return r.usd?.amount ?? null;
}

/** The dollar estimate shown BESIDE the listing's own figure (never in place of it): only
 *  for currencies other than the dollar and the euro, and only when the scan had a rate. */
export function rewardEstimate(r: GigReward | null): GigRewardUsd | null {
  if (!r?.usd || READ_AS_IS.has(r.currency?.toUpperCase() ?? "")) return null;
  return r.usd;
}

export const EMPTY_FILE: FileFilter = { status: "active", arena: "all", lane: null, search: "", sort: "touched", dir: 1 };

const UNSENT: ReadonlySet<GigStatus> = new Set(["new", "suspect", "qualified", "dispatched", "drafted", "in_review"]);

/** A gig's one state (FileState). A sent or judged gig keeps its status whatever its
 *  deadline says; an unsent one whose deadline passed is "overdue". */
export function fileStateOf(g: Gig, now: Date): FileState {
  return UNSENT.has(g.status) && deadlineView(g.deadlineAt, now).state === "passed" ? "overdue" : g.status;
}

export function isNegative(state: FileState): boolean {
  return (NEGATIVE_STATES as readonly string[]).includes(state);
}

/** "verdict" and "exit" read the raw status, as the Lanes cells that open them count it. */
export function statusMatches(filter: FileStatus, g: Gig, now: Date): boolean {
  if (filter === "all") return true;
  if (filter === "verdict") return g.status === "accepted" || g.status === "rejected";
  if (filter === "exit") return (EXIT_STATUSES as readonly string[]).includes(g.status);
  const state = fileStateOf(g, now);
  return filter === "active" ? !isNegative(state) : filter === state;
}

/** The filter's dimensions; a facet counts with its own dimension skipped. */
export type FileDim = "status" | "arena" | "lane";

/** Does the gig pass every filter (search included) except `skip`? */
export function matchesFile(g: Gig, f: FileFilter, now: Date, skip: FileDim | null = null): boolean {
  return (
    (skip === "status" || statusMatches(f.status, g, now)) &&
    (skip === "arena" || f.arena === "all" || g.arena === f.arena) &&
    (skip === "lane" || f.lane === null || gigTypeOf(g) === f.lane) &&
    matchesSearch(g, f.search)
  );
}

/** The file's rows. `touched` keeps the list's own order (most recently touched first).
 *  `deadline`: soonest open first, then the closed ones, then no deadline. `fit`: the scan's
 *  score, highest first, unscored last. `reward`: within ONE currency, largest first -
 *  currencies are grouped, never converted or compared, and an unstated reward sorts last.
 *  `dir` reverses the known part; absences stay at the end either way. */
export function fileRows(
  gigs: readonly Gig[],
  filter: FileFilter,
  now: Date
): Gig[] {
  const rows = gigs.filter((g) => matchesFile(g, filter, now));
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
      const x = rewardUsd(a.reward);
      const y = rewardUsd(b.reward);
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      return (y - x) * dir;
    });
  }
  return dir === 1 ? [...rows] : [...rows].reverse();
}
