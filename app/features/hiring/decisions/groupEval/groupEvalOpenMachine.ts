// The group-eval OPEN lifecycle as one pure machine: which comparison the modal is
// showing, how it got there, and how it failed.
//
// It used to be ~180 lines of loose useState inside useDecisionsQueue plus an
// un-ticketed async `openGroupEval`: the cache probe and `startTask` were awaited
// and then written unconditionally, so a probe that resolved after the recruiter
// closed the modal (or opened another role) painted role A's comparison under role
// B's title — and re-synced the governance control from A's payload. The task watch
// read only `{ status, full }`: a succeeded run whose result fetch gave up
// (`resultUnavailable`, whose contract says "resolve your busy state") spun forever,
// and a failed / canceled / interrupted run cleared the task with no error, so a
// failed PAID run rendered as "No evaluation yet".
//
//   idle ─open─▶ probing ─hit─▶ ready
//                  │ └─miss (selection)─▶ starting ─▶ running ─▶ ready | failed
//                  └─fail / miss (top-N)─▶ failed{code}
//
// Every open takes a monotonic ticket (the decisionsLatestWins shape); a probe or
// start that resolves under a superseded ticket is dropped. The reducer performs
// nothing: it returns EFFECTS (probe, start, applyMode, markEvaluated) and the thin
// hook (useGroupEvalOpen.ts) performs them. React-free so node:test can drive it.
import { syncGovernanceOnCacheHit, type GovernanceCacheMismatch } from "./governanceCacheSync";
import { selectionCacheKey } from "./cache-key";
import type { GroupEvalPayload } from "@/app/features/shared/groupEvalTypes";
import type { GovernanceMode } from "@/app/_lib/group-eval-governance";
import type { Group } from "../decisionsQueueTypes";

export type GroupEvalRole = { roleKey: string; roleTitle: string };

/** Why the modal has no comparison to show. Each maps to one catalog sentence
 *  (FAILURE_MESSAGE_KEY) — never to the "No evaluation yet" empty state. */
export type GroupEvalFailure =
  | "probe_failed" // the cache read itself failed: offline, a 500, an unparseable body
  | "load_failed" // the role is marked evaluated but its saved payload is missing/unreadable
  | "start_failed" // startTask refused or never reached the server
  | "run_failed" // the task ended failed / canceled / interrupted
  | "result_unavailable"; // the task succeeded but its result could not be fetched

/** decisions.* catalog key per failure. probe_failed / load_failed reuse the two
 *  sentences the inline code already had; the three run-side ones are new. */
export const FAILURE_MESSAGE_KEY = {
  probe_failed: "evalCacheProbeFailed",
  load_failed: "evalLoadFailed",
  start_failed: "evalStartFailed",
  run_failed: "evalRunFailed",
  result_unavailable: "evalResultUnavailable",
} as const satisfies Record<GroupEvalFailure, string>;

export type GroupEvalPhase =
  | { kind: "idle" }
  | { kind: "probing" }
  | { kind: "starting" }
  | { kind: "running"; taskId: string }
  | { kind: "ready"; payload: GroupEvalPayload; createdAt: string | null; mismatch: GovernanceCacheMismatch | null }
  | { kind: "failed"; code: GroupEvalFailure };

/** What an open asks for, fixed at the click: the cache key it probes and the task
 *  params it would spawn with. Built by planOpen. */
export type GroupEvalOpenPlan = {
  role: GroupEvalRole;
  /** An explicit selection run: its result lives under its own cache key, so it
   *  never marks the ROLE evaluated, and a cache miss spawns instead of failing. */
  isSelection: boolean;
  /** The selection's entry ids (null for a top-N open) — what Re-run replays when
   *  there is no payload to read them from (a failed selection run). */
  selectionIds: string[] | null;
  tryCache: boolean;
  cacheKey: string;
  params: Record<string, unknown>;
};

export type GroupEvalOpenState = {
  /** Monotonic, never reset: the only ticket allowed to write. */
  ticket: number;
  plan: GroupEvalOpenPlan | null;
  phase: GroupEvalPhase;
};

/** The cache probe's answer: null when the read itself failed. */
export type ProbeAnswer = { evaluation: { payload?: GroupEvalPayload | null; createdAt?: string | null } | null } | null;

/** One reading of useTaskResult for the watched task. */
export type TaskWatch = {
  taskId: string | null;
  status: string | null;
  full: { result?: unknown } | null;
  resultUnavailable: boolean;
};

export type GovernanceInputs = { selected: GovernanceMode; userChose: boolean };

export type GroupEvalEvent =
  | { type: "open"; plan: GroupEvalOpenPlan }
  | { type: "probeResolved"; ticket: number; probe: ProbeAnswer; governance: GovernanceInputs }
  | { type: "startResolved"; ticket: number; started: { id: string } | null }
  | { type: "taskWatch"; watch: TaskWatch }
  | { type: "close" };

export type GroupEvalEffect =
  | { type: "probe"; ticket: number; cacheKey: string }
  | { type: "start"; ticket: number; params: Record<string, unknown> }
  | { type: "applyMode"; mode: GovernanceMode }
  | { type: "markEvaluated"; roleKey: string };

export type GroupEvalStep = { state: GroupEvalOpenState; effects: GroupEvalEffect[] };

export const initialGroupEvalOpenState = (): GroupEvalOpenState => ({ ticket: 0, plan: null, phase: { kind: "idle" } });

const same = (state: GroupEvalOpenState): GroupEvalStep => ({ state, effects: [] });

/** Build an open's plan from the role group, the click's arguments and the current
 *  governance control. Selection: send the chosen subset as `candidates` and the FULL
 *  cohort as `cohort` (the server validates membership + cap and anchors coverage and
 *  drift to the full cohort). No selection: the full cohort as `candidates`, no
 *  `cohort`. A top-N open reads the cache only when the role is KNOWN evaluated; a
 *  selection open always probes its own key, since nothing lists selection rows. */
export function planOpen(
  g: Group,
  opts: { rerun: boolean; selection?: string[] | null; roleEvaluated: boolean; governanceMode: GovernanceMode }
): GroupEvalOpenPlan {
  const hasSelection = Array.isArray(opts.selection) && opts.selection.length > 0;
  const cohortCands = g.entries.map((e) => ({ entryId: e.id, candidateId: e.candidateId, label: e.candidateLabel, matchScore: e.matchScore }));
  const selectedSet = hasSelection ? new Set(opts.selection) : null;
  const candidates = selectedSet ? cohortCands.filter((c) => selectedSet.has(c.entryId)) : cohortCands;
  // selection-rerun-cache: the key for THAT exact field (roleKey + a hash of its sorted
  // member ids), derived from the same ids the server hashes when it persists the run.
  const cacheKey = selectedSet ? selectionCacheKey(g.roleKey, candidates.map((c) => c.entryId)) : g.roleKey;
  const params: Record<string, unknown> = {
    roleKey: g.roleKey,
    roleTitle: g.roleTitle,
    jobId: g.jobId,
    candidates,
    governanceMode: opts.governanceMode,
  };
  if (selectedSet) params.cohort = cohortCands;
  return {
    role: { roleKey: g.roleKey, roleTitle: g.roleTitle },
    isSelection: Boolean(selectedSet),
    selectionIds: selectedSet ? candidates.map((c) => c.entryId) : null,
    tryCache: !opts.rerun && (selectedSet ? true : opts.roleEvaluated),
    cacheKey,
    params,
  };
}

export function stepGroupEvalOpen(state: GroupEvalOpenState, event: GroupEvalEvent): GroupEvalStep {
  switch (event.type) {
    case "open": {
      const ticket = state.ticket + 1;
      const { plan } = event;
      if (plan.tryCache) {
        return { state: { ticket, plan, phase: { kind: "probing" } }, effects: [{ type: "probe", ticket, cacheKey: plan.cacheKey }] };
      }
      return { state: { ticket, plan, phase: { kind: "starting" } }, effects: [{ type: "start", ticket, params: plan.params }] };
    }
    case "close":
      // Invalidate every outstanding ticket: a probe or start still in flight lands
      // on nothing, so the next open can never inherit its payload or its task.
      return { state: { ticket: state.ticket + 1, plan: null, phase: { kind: "idle" } }, effects: [] };
    case "probeResolved": {
      if (event.ticket !== state.ticket || state.phase.kind !== "probing" || !state.plan) return same(state);
      const { plan } = state;
      if (!event.probe) return { state: { ...state, phase: { kind: "failed", code: "probe_failed" } }, effects: [] };
      const payload = event.probe.evaluation?.payload ?? null;
      if (!payload) {
        // A top-N open was PROMISED a saved run by the role's own button; a selection
        // was never promised one, so its miss simply spawns the run.
        if (!plan.isSelection) return { state: { ...state, phase: { kind: "failed", code: "load_failed" } }, effects: [] };
        return {
          state: { ...state, phase: { kind: "starting" } },
          effects: [{ type: "start", ticket: state.ticket, params: plan.params }],
        };
      }
      // Governance: the SERVER's asymmetric ordering arbitrates (governanceCacheSync.ts)
      // — never a governed->recommendation downgrade of a mode the recruiter chose.
      const sync = syncGovernanceOnCacheHit(payload.governanceMode, event.governance.selected, event.governance.userChose);
      return {
        state: {
          ...state,
          phase: { kind: "ready", payload, createdAt: event.probe.evaluation?.createdAt ?? null, mismatch: sync.mismatch },
        },
        effects: [{ type: "applyMode", mode: sync.mode }],
      };
    }
    case "startResolved": {
      if (event.ticket !== state.ticket || state.phase.kind !== "starting") return same(state);
      if (!event.started) return { state: { ...state, phase: { kind: "failed", code: "start_failed" } }, effects: [] };
      return { state: { ...state, phase: { kind: "running", taskId: event.started.id } }, effects: [] };
    }
    case "taskWatch": {
      const { watch } = event;
      if (state.phase.kind !== "running" || watch.taskId !== state.phase.taskId || !state.plan) return same(state);
      if (watch.status === "failed" || watch.status === "canceled" || watch.status === "interrupted") {
        return { state: { ...state, phase: { kind: "failed", code: "run_failed" } }, effects: [] };
      }
      if (watch.status !== "succeeded") return same(state);
      if (watch.full) {
        const payload = (watch.full.result as GroupEvalPayload | null | undefined) ?? null;
        // A succeeded task with no result is a result that did not arrive — the same
        // honest sentence as a fetch that gave up, never the empty state.
        if (!payload) return { state: { ...state, phase: { kind: "failed", code: "result_unavailable" } }, effects: [] };
        return {
          state: { ...state, phase: { kind: "ready", payload, createdAt: null, mismatch: null } },
          // Only a top-N run makes the ROLE "evaluated": a selection run's eval lives
          // under its own cache key, and claiming the role would send the next default
          // open to a role-level row that was never written.
          effects: state.plan.isSelection ? [] : [{ type: "markEvaluated", roleKey: state.plan.role.roleKey }],
        };
      }
      if (watch.resultUnavailable) return { state: { ...state, phase: { kind: "failed", code: "result_unavailable" } }, effects: [] };
      return same(state); // succeeded, result still being fetched
    }
  }
}

export type GroupEvalView = "idle" | "loading" | "ready" | "failed";

/** What the modal renders. `failed` is never folded into the empty state and
 *  `loading` always ends: every terminal task reading leaves `running`. */
export function groupEvalView(state: GroupEvalOpenState): GroupEvalView {
  switch (state.phase.kind) {
    case "idle":
      return "idle";
    case "probing":
    case "starting":
    case "running":
      return "loading";
    case "ready":
      return "ready";
    case "failed":
      return "failed";
  }
}

/** The selection a Re-run replays: the saved payload's compared ids when it was a
 *  selection-launched eval, else the open's own selection (a failed selection run
 *  has no payload to read them from), else none (a top-N re-run). */
export function rerunSelection(state: GroupEvalOpenState): string[] | undefined {
  if (state.phase.kind === "ready") {
    const p = state.phase.payload;
    return p.selection != null ? p.comparedIds : undefined;
  }
  return state.plan?.selectionIds ?? undefined;
}

/** Pool drift: how many candidates joined or left the role's pending pool since the
 *  evaluation ran, against the FULL cohort it was computed over. Stable entry ids when
 *  the payload carries them (two same-named candidates count distinctly); labels only
 *  for legacy payloads saved before ids were persisted; 0 when it carries neither. */
export function poolDrift(
  payload: Pick<GroupEvalPayload, "evaluatedIds" | "evaluatedLabels"> | null | undefined,
  group: { entries: readonly { id: string; candidateLabel: string }[] } | null | undefined
): number {
  if (!group || !payload) return 0;
  const count = (evaluated: readonly string[], current: readonly string[]): number => {
    const was = new Set(evaluated);
    const now = new Set(current);
    let changed = 0;
    for (const k of was) if (!now.has(k)) changed += 1;
    for (const k of now) if (!was.has(k)) changed += 1;
    return changed;
  };
  if (payload.evaluatedIds && payload.evaluatedIds.length > 0) {
    return count(payload.evaluatedIds, group.entries.map((e) => e.id));
  }
  if (payload.evaluatedLabels) return count(payload.evaluatedLabels, group.entries.map((e) => e.candidateLabel));
  return 0;
}
