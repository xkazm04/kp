import { listPipeline } from "./db/pipeline";
import { getDecisionConfig, type ScreeningRule } from "./decision-config-store";
import { effectiveFloor, screenBottomCount, tieSafeBottomCount } from "./decision-config-schema";
import { runScreenWave } from "./screen-wave";
import type { ScreenDecision, ScreenReasonCode } from "./screen-wave-contract";

// "Before Apply, who on today's board does the floor move pull into reach?"
//
// The calibration panel proposes moving the live auto-reject floor on historical
// evidence. This names the consequence on the CURRENT board before the click: per
// role, who comes into auto-reject reach, who leaves it, and how many the move would
// reach but the fairness shield (or the calibration holdout / a reinstatement) keeps.
//
// NO SECOND COPY OF THE REJECT RULE. Each role is run through the screening wave's own
// DRY RUN twice — under the saved rule, then under the saved rule with the suggested
// floor — and the two decision lists are diffed. A dry run ranks, applies the live
// archetype shield (readLiveArchetypes, the one `shieldsFromAutoReject` rule), the
// tie-break, the reinstatement shield and the holdout draw, and writes NOTHING: no
// status, event, seal, approval spend or email (every write in runScreenWave is gated
// on !dryRun). So this module adds no read->write and no persisted state.
//
// FAMILY SCOPE: runScreenWave's validated override REPLACES `familyFloors` wholesale,
// so a family preview passes the MERGED map (saved floors + the suggested one) —
// exactly the map apply-threshold writes. An unmerged override would drop every other
// family's floor from the "after" rule and show their candidates leaving reach.
//
// Workspace-scoped end to end: the board read and both wave runs take `workspaceId`.
// Counts only, never a rate: a board is often a handful of people per role.

export const FLOOR_PREVIEW_NAME_CAP = 5;

export type FloorMoveRow = { entryId: string; label: string; matchScore: number | null; jobId: string; href: string };
export type FloorMoveBucket = { rows: FloorMoveRow[]; more: number; total: number };
export type FloorMoveRole = {
  jobId: string;
  jobTitle: string | null;
  entering: FloorMoveBucket;
  leaving: FloorMoveBucket;
  /** Under the proposed floor and inside the bottom cut, but fairness-protected. */
  shielded: number;
  /** Newly reached by the move but kept by the calibration holdout or a reinstatement. */
  spared: number;
};
export type FloorMoveTotals = { entering: number; leaving: number; shielded: number; spared: number };
export type FloorMoveDiff = { roles: FloorMoveRole[]; totals: FloorMoveTotals };

export type FloorMovePreview = FloorMoveDiff & {
  /** The saved rule has auto-reject off: no floor acts on anyone, so nothing is counted. */
  autoRejectOff: boolean;
  roleFamily: string | null;
  currentThreshold: number;
  suggestedThreshold: number;
  /** Roles with an active Screened cohort in scope that were run. */
  rolesScanned: number;
};

type WaveSide = { decisions: readonly ScreenDecision[]; config: ScreeningRule };
export type FloorMoveRoleInput = {
  jobId: string;
  jobTitle: string | null;
  before: WaveSide;
  after: WaveSide;
  /** entry id -> role family, so a family override is read per candidate as the wave does. */
  familyOf?: ReadonlyMap<string, string | null>;
};

const SHIELD_CODES: ReadonlySet<ScreenReasonCode> = new Set(["earlyCareer", "unknownArchetype"]);
const SPARE_CODES: ReadonlySet<ScreenReasonCode> = new Set(["holdout", "reinstated"]);

/** The board deep link for one person: the house `?tab=pipeline&q=` search link
 *  (the board has no entry-id param; the tab is NAMED so the inbox adopts it). */
export function floorPreviewBoardHref(label: string): string {
  return `/?${new URLSearchParams({ tab: "pipeline", q: label }).toString()}`;
}

function bucket(rows: FloorMoveRow[], cap: number): FloorMoveBucket {
  const sorted = [...rows].sort((a, b) => (a.matchScore ?? -1) - (b.matchScore ?? -1) || a.label.localeCompare(b.label));
  return { rows: sorted.slice(0, cap), more: Math.max(0, sorted.length - cap), total: sorted.length };
}

/** Ids inside the tie-safe bottom cut of a wave, recomputed from its scored decisions
 *  with the SAME shared helpers the wave uses (decisions keep the wave's worst-first
 *  order; the unscored are appended after and never ranked). */
function inBottomCut(side: WaveSide): Set<string> {
  const scored = side.decisions.filter((d) => d.reasonCode !== "unscored" && typeof d.matchScore === "number");
  const cut = tieSafeBottomCount(
    scored.map((d) => d.matchScore as number),
    screenBottomCount(scored.length, side.config.rejectBottomPercent)
  );
  return new Set(scored.slice(0, cut).map((d) => d.entryId));
}

/** Pure: two dry-run decision lists per role -> who enters / leaves auto-reject reach,
 *  grouped per role (most-moved first; an unmoved role is omitted), names capped. */
export function diffFloorMove(roles: readonly FloorMoveRoleInput[], cap: number = FLOOR_PREVIEW_NAME_CAP): FloorMoveDiff {
  const out: FloorMoveRole[] = [];
  const totals: FloorMoveTotals = { entering: 0, leaving: 0, shielded: 0, spared: 0 };
  for (const role of roles) {
    const beforeById = new Map(role.before.decisions.map((d) => [d.entryId, d]));
    const afterBottom = inBottomCut(role.after);
    const row = (d: ScreenDecision): FloorMoveRow => ({ entryId: d.entryId, label: d.label, matchScore: d.matchScore, jobId: role.jobId, href: floorPreviewBoardHref(d.label) });
    const entering: FloorMoveRow[] = [];
    const leaving: FloorMoveRow[] = [];
    let shielded = 0;
    let spared = 0;
    for (const a of role.after.decisions) {
      const b = beforeById.get(a.entryId);
      if (!b) continue;
      if (a.action === "reject" && b.action !== "reject") entering.push(row(a));
      else if (a.action !== "reject" && b.action === "reject") leaving.push(row(a));
      else if (a.action === "keep" && typeof a.matchScore === "number") {
        const family = role.familyOf?.get(a.entryId) ?? null;
        // Newly under the floor: below the proposed floor, at/above the saved one.
        const newlyUnder = a.matchScore < effectiveFloor(role.after.config, family) && a.matchScore >= effectiveFloor(role.before.config, family);
        if (!newlyUnder) continue;
        if (SHIELD_CODES.has(a.reasonCode) && afterBottom.has(a.entryId)) shielded += 1;
        else if (SPARE_CODES.has(a.reasonCode) && b.reasonCode !== a.reasonCode) spared += 1;
      }
    }
    if (entering.length + leaving.length + shielded + spared === 0) continue;
    totals.entering += entering.length;
    totals.leaving += leaving.length;
    totals.shielded += shielded;
    totals.spared += spared;
    out.push({ jobId: role.jobId, jobTitle: role.jobTitle, entering: bucket(entering, cap), leaving: bucket(leaving, cap), shielded, spared });
  }
  out.sort(
    (x, y) =>
      y.entering.total + y.leaving.total - (x.entering.total + x.leaving.total) ||
      (x.jobTitle ?? x.jobId).localeCompare(y.jobTitle ?? y.jobId)
  );
  return { roles: out, totals };
}

/** Run the preview on the workspace's board: every role with an active Screened
 *  cohort (in the family scope, a role with at least one entry of that family), each
 *  through two dry runs. Writes nothing. */
export async function previewFloorMove(
  workspaceId: string,
  move: { suggestedThreshold: number; roleFamily?: string | null }
): Promise<FloorMovePreview> {
  const roleFamily = move.roleFamily || null;
  const screening = getDecisionConfig<ScreeningRule>("screening", workspaceId);
  const base = {
    roleFamily,
    currentThreshold: effectiveFloor(screening, roleFamily),
    suggestedThreshold: move.suggestedThreshold,
  };
  if (screening.autoRejectEnabled !== true) {
    return { ...base, autoRejectOff: true, rolesScanned: 0, roles: [], totals: { entering: 0, leaving: 0, shielded: 0, spared: 0 } };
  }
  const override: Partial<ScreeningRule> = roleFamily
    ? { familyFloors: { ...(screening.familyFloors ?? {}), [roleFamily]: move.suggestedThreshold } }
    : { maxMatchToReject: move.suggestedThreshold };

  const screened = listPipeline(workspaceId).filter((e) => e.status === "active" && e.stage === "Screened" && e.jobId);
  const jobs = new Map<string, string | null>();
  for (const e of screened) {
    if (roleFamily && e.roleFamily !== roleFamily) continue;
    if (!jobs.has(e.jobId as string)) jobs.set(e.jobId as string, e.jobTitle);
  }
  const familyOf = new Map(screened.map((e) => [e.id, e.roleFamily] as const));
  const inputs: FloorMoveRoleInput[] = [];
  for (const [jobId, jobTitle] of jobs) {
    const before = await runScreenWave(jobId, undefined, { dryRun: true }, workspaceId);
    const after = await runScreenWave(jobId, override, { dryRun: true }, workspaceId);
    inputs.push({ jobId, jobTitle, before, after, familyOf });
  }
  return { ...base, autoRejectOff: false, rolesScanned: jobs.size, ...diffFloorMove(inputs) };
}
