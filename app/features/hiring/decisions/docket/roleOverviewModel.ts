// CX S46 - "Everyone on this role": the pure half of the role level's side-by-side overview.
// Every ACTIVE candidate of one role (the role-view read, CX S45) as one row, sortable by any
// ONE column at a time, never by a blended total: the match, the work sample and the interview
// are different instruments and each is read on its own (ADR 0027 S3, the ladder's rule).
//
// HONEST ABSENCE: an unscored cell sorts LAST in both directions (compareCells pins a missing
// value below every real one), never as 0. A person never sent a work sample is not a person
// who scored 0 on it.
//
// The shortlist tick is page state only (no persistence: a kept shortlist needs a schema).
// With two or more ticked, the selection is handed to the existing Group evaluation as an
// explicit selection over the role's full active cohort (rosterGroups below).
import { compareCells, type SortCell, type SortDir, type SortState } from "@/app/_components/table/useTableSort";
import type { RoleViewCandidate, RoleViewInterview, RoleViewMatch, RoleViewWorkSample } from "@/app/_lib/role-decision-view";
import { isTerminalEntryStatus } from "@/app/_lib/pipeline-status";
import type { Entry } from "@/app/features/shared/decisionsTypes";
import { roleKeyOf, type Group } from "../decisionsQueueTypes";
import type { DocketProposal } from "./docketModel";

export type OverviewCol = "candidate" | "stage" | "match" | "workSample" | "interview" | "proposal";
/** The table's column order, left to right: who, where they are, then each instrument on its own
 *  (match, interview, work sample), then what the AI proposes. One line per person at desktop width. */
export const OVERVIEW_COLS: readonly OverviewCol[] = ["candidate", "stage", "match", "interview", "workSample", "proposal"];

export type OverviewRow = {
  entryId: string;
  label: string;
  stage: string;
  /** The stage's position on the workspace axis (null when the axis does not name it). */
  stageRank: number | null;
  match: RoleViewMatch;
  workSample: RoleViewWorkSample;
  interview: RoleViewInterview;
  /** What the AI proposes for this person, when a proposal waits in the queue; null = none waits. */
  proposal: DocketProposal | null;
};

/** One row per candidate the role view lists, in the view's order. */
export function overviewRows(
  candidates: readonly RoleViewCandidate[],
  proposals: ReadonlyMap<string, DocketProposal>,
  stageOrder: readonly string[],
): OverviewRow[] {
  return candidates.map((c) => {
    const rank = stageOrder.indexOf(c.stage);
    return {
      entryId: c.entryId,
      label: c.candidateLabel,
      stage: c.stage,
      stageRank: rank < 0 ? null : rank,
      match: c.match,
      workSample: c.workSample,
      interview: c.interview,
      proposal: proposals.get(c.entryId) ?? null,
    };
  });
}

/** What each column sorts by. A missing value is null and sorts last; nothing is ever 0 for "none". */
export const OVERVIEW_SORT: Record<OverviewCol, (r: OverviewRow) => SortCell> = {
  candidate: (r) => r.label,
  stage: (r) => r.stageRank,
  match: (r) => r.match.score,
  workSample: (r) => r.workSample.transferScore,
  // The interviewers' average; a role where only the AI interview ran sorts by nothing here.
  interview: (r) => r.interview.human.average,
  // A waiting proposal sorts first (descending), "none waits" last.
  proposal: (r) => (r.proposal ? 1 : null),
};

/** The direction a column opens in: numbers and the proposal flag highest first, names A-Z. */
export function initialOverviewDir(col: OverviewCol): SortDir {
  return col === "candidate" ? "asc" : "desc";
}

/** The next sort after a click on `col`: the same column flips, a new column opens in its own direction. */
export function nextOverviewSort(prev: SortState<OverviewCol>, col: OverviewCol): SortState<OverviewCol> {
  if (prev.col === col) return { col, dir: prev.dir === "asc" ? "desc" : "asc" };
  return { col, dir: initialOverviewDir(col) };
}

/** Sorted copy by ONE column. Stable: equal cells keep the view's order (Array.prototype.sort
 *  is stable, and the index tie-break states it rather than trusting it). */
export function sortOverview(rows: readonly OverviewRow[], sort: SortState<OverviewCol>, locale?: string): OverviewRow[] {
  const get = OVERVIEW_SORT[sort.col];
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => compareCells(get(a.r), get(b.r), sort.dir, locale) || a.i - b.i)
    .map((x) => x.r);
}

// ---- the shortlist (page state only) -------------------------------------------------

/** Tick or untick one person; a tick past the comparison's cap is ignored (the server re-enforces). */
export function toggleShortlist(set: ReadonlySet<string>, id: string, cap: number): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else if (next.size < cap) next.add(id);
  else return set;
  return next;
}

/** Drop ticks for people no longer on the role (they left between two reads). */
export function pruneShortlist(set: ReadonlySet<string>, present: readonly string[]): ReadonlySet<string> {
  const keep = new Set(present);
  let changed = false;
  const next = new Set<string>();
  for (const id of set) {
    if (keep.has(id)) next.add(id);
    else changed = true;
  }
  return changed ? next : set;
}

/** A comparison needs at least a head-to-head pair. */
export const canCompareShortlist = (set: ReadonlySet<string>): boolean => set.size >= 2;

/** The selection the comparison receives: ticked ids, in the order the table shows them. */
export function shortlistSelection(set: ReadonlySet<string>, rows: readonly OverviewRow[]): string[] {
  return rows.filter((r) => set.has(r.entryId)).map((r) => r.entryId);
}

// ---- every open role (the Decisions tab's way in when nothing waits) ---------------------

/** Every role with at least one ACTIVE candidate (status active, not on a terminal stage: the
 *  role view's own rule, activeForDecision), as a Group over those candidates. Roles whose
 *  people are all closed out (role_closed, rejected, hired) are not listed. Order: by title. */
export function rosterGroups(
  entries: readonly Entry[],
  terminalStages: ReadonlySet<string>,
  unassignedTitle: string,
  locale?: string,
): Group[] {
  const map = new Map<string, Group>();
  for (const e of entries) {
    if (isTerminalEntryStatus(e.status) || terminalStages.has(e.stage)) continue;
    const roleKey = roleKeyOf(e);
    let g = map.get(roleKey);
    if (!g) {
      g = { roleKey, roleTitle: e.jobTitle ?? unassignedTitle, jobId: e.jobId ?? null, entries: [] };
      map.set(roleKey, g);
    }
    g.entries.push(e);
  }
  return [...map.values()].sort((a, b) => compareCells(a.roleTitle, b.roleTitle, "asc", locale));
}
