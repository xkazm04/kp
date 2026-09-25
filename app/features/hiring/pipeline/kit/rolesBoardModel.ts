/*
 * The roles board (level 1 of the Hiring pipeline): one row per role, one cell per stage, pure. The
 * owner's brief (2026-09-25): "bring back pipeline with row per role, current view is not practical for
 * large companies with dozens role open and thousands of candidates". The LOGIC is the retired Subway
 * board's (b7fde0c32 map/subway: a row per lane keyed like groupPositions, a cell per axis column,
 * beads capped at 5 with "+N"); the presentation is the kit's (PipelineKitRoles + StageCells).
 *
 * Every figure is read from the board payload the tab already holds:
 *   row           <- entryLaneKey(entry) (job id, else title): the lane key every board surface shares
 *   cell count    <- entries on that axis column; an off-axis entry counts in the total, never in a cell
 *                    (the "Off the board" section names it)
 *   bead shape    <- provenance(entry) (walked / placed / nothing on record), the Sieve's own shapes
 *   waiting       <- ctx.needs (a human decision pending), the head figure's population
 *   with the AI   <- ctx.ai (lineAttention.waitingOn: the hiring plan's executor for that step)
 *   last move     <- max(stageChangedAt ?? createdAt)
 * The first row, "All roles", is the same columns summed: the funnel at a glance.
 */
import { capBeads, type Bead } from "../../../../_components/kit/graphic/scaleModel.ts";
import { entryLaneKey, type Entry, type StageDef } from "@/app/features/shared/pipelineTypes";
import { provenance, roleTone, type Ctx } from "./pipelineKitModel.ts";

/** The level-2 scope that is every role at once (the URL spells it `?role=all`). */
export const ALL = "__all";
export const ALL_PARAM = "all";
/** Beads per cell, the retired board's BEAD_LIMIT. */
export const BEAD_CAP = 5;
/** GET /api/pipeline reads at most this many active rows (PIPELINE_BOARD_CAP in app/_lib/db/pipeline.ts,
 *  a server module the client cannot import; rolesBoard.test.ts pins the two equal). Its ORDER BY is
 *  job_title, so a board at the cap is missing the roles past it: the board says so rather than
 *  presenting a partial count as the whole. */
export const BOARD_READ_CAP = 2000;

/** Whether the payload may have been cut at the read cap (the route carries no `truncated` flag). */
export function atReadCap(count: number): boolean {
  return count >= BOARD_READ_CAP;
}

export type RoleCellModel = { stage: string; count: number; waiting: number; beads: Bead[]; more: number };
export type RoleRow = {
  id: string;
  all: boolean;
  title: string | null;
  family: string | null;
  jobId: string | null;
  cells: RoleCellModel[];
  total: number;
  waiting: number;
  ai: number;
  lastMove: string | null;
};

export type BoardCtx = Pick<Ctx, "needs"> & { ai?: (e: Entry) => boolean };

type Acc = Omit<RoleRow, "cells"> & { lists: Entry[][] };

/** "All roles" first, then every role: waiting on you first, then the latest move, then by title. */
export function roleRows(entries: readonly Entry[], axis: readonly StageDef[], ctx: BoardCtx, rankOf: ReadonlyMap<string, number>, cap = BEAD_CAP): RoleRow[] {
  const at = new Map(axis.map((s, i) => [s.id, i]));
  const tone = axis.map((s) => roleTone(s.role));
  const make = (id: string, e: Entry | null): Acc => ({
    id, all: e == null, title: e?.jobTitle ?? null, family: e?.roleFamily ?? null, jobId: e?.jobId ?? null,
    total: 0, waiting: 0, ai: 0, lastMove: null, lists: axis.map(() => []),
  });
  const all = make(ALL, null);
  const lanes = new Map<string, Acc>();
  for (const e of entries) {
    const key = entryLaneKey(e);
    let lane = lanes.get(key);
    if (!lane) lanes.set(key, (lane = make(key, e)));
    const needs = ctx.needs(e);
    const ai = ctx.ai?.(e) ?? false;
    const moved = e.stageChangedAt ?? e.createdAt;
    const col = at.get(e.stage);
    for (const acc of [all, lane]) {
      acc.total += 1;
      if (needs) acc.waiting += 1;
      if (ai) acc.ai += 1;
      if (moved && (!acc.lastMove || moved > acc.lastMove)) acc.lastMove = moved;
      if (col != null) acc.lists[col].push(e);
    }
  }
  const rank = (e: Entry) => rankOf.get(e.id) ?? Number.MAX_SAFE_INTEGER;
  const finish = ({ lists, ...acc }: Acc): RoleRow => ({
    ...acc,
    cells: lists.map((list, ci) => {
      const ordered = list.slice().sort((a, b) => rank(a) - rank(b));
      const { beads, more } = capBeads(ordered.map((e) => ({ id: e.id, shape: provenance(e), tone: tone[ci], needs: ctx.needs(e) })), cap);
      return { stage: axis[ci].id, count: list.length, waiting: list.filter(ctx.needs).length, beads, more };
    }),
  });
  const rows = [...lanes.values()].sort(
    (a, b) => b.waiting - a.waiting || (b.lastMove ?? "").localeCompare(a.lastMove ?? "") || (a.title ?? "").localeCompare(b.title ?? "")
  );
  return [finish(all), ...rows.map(finish)];
}

/** The `?role=` value as the scope it names: a lane key, a role TITLE (resolved to its lane), or "all". */
export function resolveRole(param: string | null, entries: readonly Entry[]): string | null {
  if (!param) return null;
  if (param === ALL || param === ALL_PARAM) return ALL;
  if (entries.some((e) => entryLaneKey(e) === param)) return param;
  const byTitle = entries.find((e) => (e.jobTitle ?? "") === param);
  return byTitle ? entryLaneKey(byTitle) : param;
}

/** The deep-link params that name CANDIDATES rather than a view: landing with one opens level 2 over
 *  every role, so the link shows the people it names without a click (`?sort=` alone does not). */
export const CANDIDATE_PARAMS = ["q", "quick", "score", "source", "stage"] as const;

/** The scope a landing opens: `?role=` when it names one, else every role when the link names
 *  candidates, else the roles board (null). */
export function initialScope(get: (key: string) => string | null): string | null {
  const role = (get("role") ?? "").trim();
  if (role) return role === ALL_PARAM ? ALL : role;
  return CANDIDATE_PARAMS.some((k) => (get(k) ?? "").trim()) ? ALL : null;
}

/** The scope as the URL spells it. */
export function roleParam(scope: string | null): string | null {
  return scope === ALL ? ALL_PARAM : scope;
}
