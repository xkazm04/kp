import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { getAcceptedGigPlan, setGigPlanProgress } from "../db/gigs-plans";
import { GIG_PLAN_STATUS_CONTRACT, GIG_PLAN_STATUS_FILE } from "./contract";
import { patchPersonasGoal, type PersonasOkResult } from "./personas-places";
import {
  GIG_GOAL_STATUSES,
  type GigAssignment,
  type GigGoalProgress,
  type GigGoalStatus,
  type GigPlanProgress,
  type GigPlanRow,
} from "./types";

// PLAN-STATUS: how a gig persona's progress on the operator-accepted plan becomes visible
// (docs/features/gigs/README.md "Pairing"). The accepted plan is the persona's Personas
// MILESTONE and each step one GOAL (pairing.ts creates them); the agent keeps
//
//   <workdir>/PLAN-STATUS.json = {goals: [{goalId, status: open|in-progress|blocked|done,
//                                          progress: 0..100, note?}]}
//
// current (the contract text is contract.ts gigPlanStatusContractMarkdown, in every gig
// folder's DELIVERABLE-CONTRACT.md), and every sync pass reads it: each goal whose reported
// state differs from the recorded one is patched in Personas (POST /api/dev/goals/{id}) and
// mirrored onto the accepted plan's `progress_json` (db/gigs-plans.ts setGigPlanProgress).
//
// Strict and one-way safe, stated once:
//   - a missing, oversized, unreadable or unparseable file is NO update (never a reset);
//   - an entry whose goalId is not one of this plan's is ignored, as is an entry whose
//     status is not a known word; progress is clamped to 0..100 and rounded;
//   - a reported `open` never regresses a goal that already moved (a stale or half-written
//     file must not undo recorded progress);
//   - a goal is recorded as changed only once Personas accepted the patch (or it has no
//     Personas goal to patch), so an unreachable Personas is retried on the next pass rather
//     than silently diverging.
// A goal whose milestone Personas could not create (pairing degraded) is reported under the
// key `step-<n>` instead of a goal id; it is tracked locally and never patched.

/** The file is read under this cap (a status file is a few hundred bytes). */
export const GIG_PLAN_STATUS_MAX_BYTES = 64 * 1024;
export const GIG_PLAN_NOTE_MAX = 500;

/** The id a goal is reported under: its Personas goal id, else `step-<n>` (1-based). */
export function planGoalKey(goal: Pick<GigGoalProgress, "stepIndex" | "goalId">): string {
  return goal.goalId ?? `step-${goal.stepIndex + 1}`;
}

// ---------------------------------------------------------------------------
// The plan as the assignment carries it
// ---------------------------------------------------------------------------

export type GigPlanAssignment = {
  summary: string;
  steps: { goalId: string; title: string; doneWhen: string }[];
  /** The operator's note at acceptance; null when none. */
  note: string | null;
  statusFile: typeof GIG_PLAN_STATUS_FILE;
  statusContract: typeof GIG_PLAN_STATUS_CONTRACT;
};

/** A gig persona's assignment: the ordinary `kp.gig.v1` input plus the accepted plan. */
export type GigPairedAssignment = GigAssignment & { plan: GigPlanAssignment };

/** The plan block of a paired assignment, or null when the plan has no readable body. Pure. */
export function buildGigPlanAssignment(plan: Pick<GigPlanRow, "plan" | "progress" | "note">): GigPlanAssignment | null {
  if (!plan.plan) return null;
  const goals = plan.progress?.goals ?? [];
  return {
    summary: plan.plan.summary,
    steps: plan.plan.steps.map((st, i) => {
      const goal = goals.find((g) => g.stepIndex === i);
      return { goalId: planGoalKey({ stepIndex: i, goalId: goal?.goalId ?? null }), title: st.title, doneWhen: st.doneWhen };
    }),
    note: plan.note,
    statusFile: GIG_PLAN_STATUS_FILE,
    statusContract: GIG_PLAN_STATUS_CONTRACT,
  };
}

/** The progress a fresh pairing records: every step `open` at 0, with the goal ids Personas
 *  answered (null where it did not), keeping whatever was already recorded per step. Pure. */
export function initialPlanProgress(
  stepCount: number,
  milestoneId: string | null,
  goalIds: readonly (string | null)[],
  previous: GigPlanProgress | null,
  now: string
): GigPlanProgress {
  const goals: GigGoalProgress[] = [];
  for (let i = 0; i < stepCount; i++) {
    const prev = previous?.goals.find((g) => g.stepIndex === i);
    goals.push({
      stepIndex: i,
      goalId: goalIds[i] ?? prev?.goalId ?? null,
      status: prev?.status ?? "open",
      progress: prev?.progress ?? 0,
      note: prev?.note ?? null,
    });
  }
  return { milestoneId: milestoneId ?? previous?.milestoneId ?? null, goals, updatedAt: now };
}

// ---------------------------------------------------------------------------
// Reading the file (strict)
// ---------------------------------------------------------------------------

export type PlanStatusEntry = { status: GigGoalStatus; progress: number; note: string | null };

function isGoalStatus(v: unknown): v is GigGoalStatus {
  return typeof v === "string" && (GIG_GOAL_STATUSES as readonly string[]).includes(v);
}

/** Parse PLAN-STATUS.json against the goal keys this plan knows. Null = the file says
 *  nothing usable (not JSON, not an object with a `goals` array) - no update. Entries with
 *  an unknown key or status are skipped; the first entry for a key wins. Pure. */
export function parsePlanStatus(text: string, keys: ReadonlySet<string>): Map<string, PlanStatusEntry> | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // A half-written or hand-broken file: no update this pass, never a reset.
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const goals = (value as { goals?: unknown }).goals;
  if (!Array.isArray(goals)) return null;
  const out = new Map<string, PlanStatusEntry>();
  for (const raw of goals) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const key = typeof e.goalId === "string" ? e.goalId.trim() : "";
    if (!keys.has(key) || out.has(key) || !isGoalStatus(e.status)) continue;
    const p = typeof e.progress === "number" && Number.isFinite(e.progress) ? Math.round(Math.max(0, Math.min(100, e.progress))) : e.status === "done" ? 100 : 0;
    const note = typeof e.note === "string" && e.note.trim() ? e.note.replace(/\s+/g, " ").trim().slice(0, GIG_PLAN_NOTE_MAX) : null;
    out.set(key, { status: e.status, progress: p, note });
  }
  return out;
}

/** The file's text, or null when absent, not a regular file (never a link out of the
 *  folder), over the cap, or unreadable. */
export function readPlanStatusFile(workdir: string): string | null {
  const file = path.join(workdir, GIG_PLAN_STATUS_FILE);
  try {
    const st = lstatSync(file);
    if (!st.isFile() || st.size > GIG_PLAN_STATUS_MAX_BYTES) return null;
    return readFileSync(file, "utf8");
  } catch {
    // absent (the agent has not written it yet) or unreadable: no update this pass
    return null;
  }
}

/** Merge a report into the recorded progress. `changed` lists the goals (new state) whose
 *  status, progress or note moved; a reported `open` never regresses a goal that moved. Pure. */
export function applyPlanStatus(
  current: GigPlanProgress,
  report: ReadonlyMap<string, PlanStatusEntry>,
  now: string
): { next: GigPlanProgress; changed: GigGoalProgress[] } {
  const changed: GigGoalProgress[] = [];
  const goals = current.goals.map((g) => {
    const r = report.get(planGoalKey(g));
    if (!r) return g;
    if (r.status === "open" && g.status !== "open") return g;
    if (r.status === g.status && r.progress === g.progress && r.note === g.note) return g;
    const moved: GigGoalProgress = { ...g, status: r.status, progress: r.progress, note: r.note };
    changed.push(moved);
    return moved;
  });
  return { next: changed.length > 0 ? { ...current, goals, updatedAt: now } : current, changed };
}

// ---------------------------------------------------------------------------
// One gig's pass (the sync calls this for every gig with an active gig persona)
// ---------------------------------------------------------------------------

export type GigPlanStatusDeps = {
  readFile?: (workdir: string) => string | null;
  patchGoal?: (goalId: string, patch: { status: GigGoalStatus; progress: number }) => Promise<PersonasOkResult>;
  now?: () => Date;
};

export type GigPlanStatusOutcome =
  | { kind: "no_plan" | "no_file" | "unparseable" | "unchanged" }
  | { kind: "updated"; changed: number; patched: number; failed: number };

/** Read the gig's PLAN-STATUS.json, patch each changed goal in Personas, and record what
 *  landed. Never throws. */
export async function syncGigPlanStatus(workspaceId: string, gigId: string, workdir: string | null, deps: GigPlanStatusDeps = {}): Promise<GigPlanStatusOutcome> {
  const plan = getAcceptedGigPlan(workspaceId, gigId);
  if (!plan?.progress || !workdir) return { kind: "no_plan" };
  const text = (deps.readFile ?? readPlanStatusFile)(workdir);
  if (text === null) return { kind: "no_file" };
  const report = parsePlanStatus(text, new Set(plan.progress.goals.map(planGoalKey)));
  if (!report) return { kind: "unparseable" };
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const { changed } = applyPlanStatus(plan.progress, report, now);
  if (changed.length === 0) return { kind: "unchanged" };

  const patch = deps.patchGoal ?? ((id: string, p: { status: GigGoalStatus; progress: number }) => patchPersonasGoal(id, p));
  const landed = new Map<number, GigGoalProgress>();
  let patched = 0;
  let failed = 0;
  for (const goal of changed) {
    const before = plan.progress.goals.find((g) => g.stepIndex === goal.stepIndex);
    const needsPatch = goal.goalId !== null && (before?.status !== goal.status || before?.progress !== goal.progress);
    if (!needsPatch) {
      landed.set(goal.stepIndex, goal);
      continue;
    }
    let res: PersonasOkResult;
    try {
      res = await patch(goal.goalId!, { status: goal.status, progress: goal.progress });
    } catch {
      // The default transport never throws; an injected one might - retried next pass.
      res = { ok: false, reason: "personas_unreachable" };
    }
    if (res.ok) {
      patched += 1;
      landed.set(goal.stepIndex, goal);
    } else failed += 1;
  }
  if (landed.size > 0) {
    // Re-read the row: the pairing may have written goal ids meanwhile (the only other writer).
    const fresh = getAcceptedGigPlan(workspaceId, gigId)?.progress ?? plan.progress;
    setGigPlanProgress(workspaceId, plan.id, {
      ...fresh,
      goals: fresh.goals.map((g) => {
        const l = landed.get(g.stepIndex);
        return l ? { ...g, status: l.status, progress: l.progress, note: l.note } : g;
      }),
      updatedAt: now,
    });
  }
  return { kind: "updated", changed: changed.length, patched, failed };
}
