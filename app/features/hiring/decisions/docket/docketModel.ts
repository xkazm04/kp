// The Docket's pure model (Hiring > Decisions, contest decisions-queue B/1): how the waiting
// recommendations fold into the head's headline, the spine of tiles and the role groups the board
// packs into columns. No React and no copy: the view maps the returned facts through the catalog.
//
// Honest absence is the point of the shapes here: a row whose AI recorded NO proposal is `none`
// (never "hold"), an unscored row has `score: null` (never 0), and a headline fact the data cannot
// give (the longest wait: the queue carries no arrival time) is simply not computed.
import type { LedgerGroup, LedgerRow } from "../ledger/decisionsLedgerModel";
import { groupLedgerRows } from "../ledger/decisionsLedgerModel";
import { roleKeyOf } from "../decisionsQueueTypes";
import type { Entry } from "@/app/features/shared/decisionsTypes";

/** What a row's tile and proposal mark say. `offer` rows propose money, `none` is "no proposal recorded". */
export type DocketProposal = "advance" | "hold" | "reject" | "offer" | "none";

export function proposalOf(row: LedgerRow): DocketProposal {
  if (row.kind === "offer") return "offer";
  const rec = row.recommendation;
  return rec === "advance" || rec === "hold" || rec === "reject" ? rec : "none";
}

export type DocketGroup = LedgerGroup & {
  /** How many of this role's rows the AI proposes to reject (each is a person's call). */
  rejects: number;
  /** How many rows carry a score that predates a JD edit. */
  stale: number;
};

/** Rows folded by role (the pending order inside a role: best fit first, unscored last). */
export function docketGroups(rows: readonly LedgerRow[], locale: string): DocketGroup[] {
  const sorted = [...rows].sort((a, b) => {
    const role = (a.entry.jobTitle ?? "").localeCompare(b.entry.jobTitle ?? "", locale);
    if (role !== 0) return role;
    if (a.score == null && b.score == null) return a.entry.candidateLabel.localeCompare(b.entry.candidateLabel, locale);
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    return b.score - a.score;
  });
  return groupLedgerRows(sorted).map((g) => ({
    ...g,
    rejects: g.rows.filter((r) => proposalOf(r) === "reject").length,
    stale: g.rows.filter((r) => r.staleSince != null).length,
  }));
}

/** The role's key as every other place in the tab reads it (jobId, else the title). */
export const groupRoleKey = (g: LedgerGroup): string => g.key;

export type DocketHeadline = {
  waiting: number;
  roles: number;
  /** With an AI proposal on record / without one. */
  proposed: number;
  unproposed: number;
  rejects: number;
  /** The role holding the most waiting decisions (ties: the first in role order), null when empty. */
  biggest: { title: string; count: number } | null;
};

/** The head's facts. `waiting` counts EVERY pending entry (key decisions included), the rows only
 *  the AI-reviewed part: the numerals agree with the header count the tab always showed. */
export function docketHeadline(rows: readonly LedgerRow[], pending: readonly Entry[]): DocketHeadline {
  const byRole = new Map<string, { title: string; count: number }>();
  for (const e of pending) {
    const key = roleKeyOf(e);
    const cur = byRole.get(key) ?? { title: e.jobTitle ?? "", count: 0 };
    cur.count += 1;
    byRole.set(key, cur);
  }
  let biggest: DocketHeadline["biggest"] = null;
  for (const v of byRole.values()) if (!biggest || v.count > biggest.count) biggest = v;
  const props = rows.map(proposalOf);
  return {
    waiting: pending.length,
    roles: byRole.size,
    proposed: props.filter((p) => p !== "none").length,
    unproposed: props.filter((p) => p === "none").length,
    rejects: props.filter((p) => p === "reject").length,
    biggest,
  };
}
