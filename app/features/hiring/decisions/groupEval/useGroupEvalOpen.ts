// The Decisions tab's group-eval OPEN — the thin React side of groupEvalOpenMachine.ts.
// It owns the machine's state and performs the effects the reducer returns (the cache
// probe, startTask, the governance control, the role's "evaluated" chip); every write
// goes through stepGroupEvalOpen, so a probe or start that resolves under a superseded
// ticket writes nothing. Not to be confused with useGroupEval.ts / groupEvalSession.ts,
// which own what the modal does WITH an evaluation (decide, sealed outcomes).
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useTasks, useTaskResult } from "@/app/features/shell/tasks/TasksProvider";
import type { GovernanceMode } from "@/app/_lib/group-eval-governance";
import type { GroupEvalPayload } from "@/app/features/shared/groupEvalTypes";
import type { GovernanceCacheMismatch } from "./governanceCacheSync";
import type { Group } from "../decisionsQueueTypes";
import {
  FAILURE_MESSAGE_KEY,
  groupEvalView,
  initialGroupEvalOpenState,
  planOpen,
  poolDrift,
  rerunSelection,
  stepGroupEvalOpen,
  type GroupEvalEffect,
  type GroupEvalEvent,
  type GroupEvalRole,
  type GroupEvalView,
  type ProbeAnswer,
} from "./groupEvalOpenMachine";

/** Everything the modal and the role rows need from the open — one object instead
 *  of the fourteen props DecisionsTab used to forward to DecisionsModals. */
export type GroupEvalOpen = {
  role: GroupEvalRole | null;
  /** The live group for the open role (null once it left the queue). */
  group: Group | null;
  view: GroupEvalView;
  evaluation: GroupEvalPayload | null;
  createdAt: string | null;
  /** The failure sentence in the reader's language (view === "failed"). */
  error: string | null;
  drift: number;
  governanceMismatch: GovernanceCacheMismatch | null;
  /** Is a run for this role in flight? (the row's busy spinner) */
  isBusy: (roleKey: string) => boolean;
  open: (g: Group, rerun?: boolean, selection?: string[]) => void;
  rerun: () => void;
  close: () => void;
};

export function useGroupEvalOpen({
  groups,
  isRoleEvaluated,
  markEvaluated,
  governance,
  applyMode,
}: {
  groups: readonly Group[];
  isRoleEvaluated: (roleKey: string) => boolean;
  markEvaluated: (roleKey: string) => void;
  /** The governance control as the recruiter sees it, read at the moment it matters. */
  governance: () => { selected: GovernanceMode; userChose: boolean };
  applyMode: (mode: GovernanceMode) => void;
}): GroupEvalOpen {
  const t = useTranslations("decisions");
  const { startTask } = useTasks();
  const [state, setState] = useState(initialGroupEvalOpenState);
  // The machine's state of record, read and written only by `send` (handlers,
  // promise callbacks, the watch effect) — never during render. `state` mirrors it
  // for rendering.
  const current = useRef(state);

  const send = (event: GroupEvalEvent) => {
    const step = stepGroupEvalOpen(current.current, event);
    if (step.state !== current.current) {
      current.current = step.state;
      setState(step.state);
    }
    for (const fx of step.effects) perform(fx);
  };

  const perform = (fx: GroupEvalEffect) => {
    switch (fx.type) {
      case "probe":
        // A probe that FAILED (offline, a 500, an unparseable body) is not a miss:
        // it resolves to null and the machine names it probe_failed instead of
        // falling through to a fresh paid run.
        void fetch(`/api/decisions/group-eval?role=${encodeURIComponent(fx.cacheKey)}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
          .then((probe: ProbeAnswer) => send({ type: "probeResolved", ticket: fx.ticket, probe, governance: governance() }));
        return;
      case "start":
        // startTask resolves null on a refused or dropped POST /api/tasks.
        void startTask("group_eval", fx.params).then((started) => send({ type: "startResolved", ticket: fx.ticket, started }));
        return;
      case "applyMode":
        applyMode(fx.mode);
        return;
      case "markEvaluated":
        markEvaluated(fx.roleKey);
        return;
    }
  };

  // Watch the run. A terminal reading is fed to the machine, which moves the phase
  // off `running`: the watched id goes null and the reading is consumed once. The
  // machine drops a reading for any task but the one it is running, so a late
  // reading of an abandoned run lands on nothing.
  const taskId = state.phase.kind === "running" ? state.phase.taskId : null;
  const watch = useTaskResult(taskId);
  const { status: watchStatus, full: watchFull, resultUnavailable } = watch;
  // `send` is re-created every render; the effect must call the LATEST one without
  // re-firing on every render, so it goes through a ref refreshed after each render
  // (the latestLoaders shape in useDecisionsQueue). The reading is the dependency.
  const latestSend = useRef(send);
  useEffect(() => {
    latestSend.current = send;
  });
  useEffect(() => {
    if (!taskId) return;
    latestSend.current({ type: "taskWatch", watch: { taskId, status: watchStatus, full: watchFull, resultUnavailable } });
  }, [taskId, watchStatus, watchFull, resultUnavailable]);

  const role = state.plan?.role ?? null;
  const group = role ? groups.find((g) => g.roleKey === role.roleKey) ?? null : null;
  const ready = state.phase.kind === "ready" ? state.phase : null;

  const open = (g: Group, rerun = false, selection?: string[]) => {
    const gov = governance();
    send({
      type: "open",
      plan: planOpen(g, { rerun, selection, roleEvaluated: isRoleEvaluated(g.roleKey), governanceMode: gov.selected }),
    });
  };

  return {
    role,
    group,
    view: groupEvalView(state),
    evaluation: ready?.payload ?? null,
    createdAt: ready?.createdAt ?? null,
    error: state.phase.kind === "failed" ? t(FAILURE_MESSAGE_KEY[state.phase.code]) : null,
    drift: poolDrift(ready?.payload, group),
    governanceMismatch: ready?.mismatch ?? null,
    isBusy: (roleKey) => groupEvalView(state) === "loading" && role?.roleKey === roleKey,
    open,
    rerun: () => {
      // selection-memory-rerun — replay the original explicit selection; planOpen
      // filters it against the CURRENT cohort, and the server re-validates.
      if (group) open(group, true, rerunSelection(state));
    },
    close: () => {
      send({ type: "close" });
    },
  };
}
