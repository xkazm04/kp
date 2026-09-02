"use client";

// The Hiring tab's state: TWO coordinated drafts (the board's column axis, and
// the policy plan that runs on it) plus the occupancy read that decides whether
// an axis edit is safe to save.
//
// One hook rather than state in the tab component, for the same reason the spend
// section got one: two configs, two saves and one occupancy fetch is enough
// sequencing that leaving it inline would bury the rules in JSX. Split out also
// keeps HiringTab.tsx under the 200-line cap.
//
// The RULES that read this state — dirty, blocked and WHY, the migration legs a
// save needs, what a discard restores, and what a save attempt actually did —
// live in composerState.ts as pure functions, so they can be tested without a
// renderer. This file owns the state cells and the IO, nothing else.
//
// The axis is saved BEFORE the plan, deliberately. The plan's stations resolve
// against the axis (composerStations), so persisting a plan that references a
// column the stored axis does not have yet would leave a window where the two
// disagree. If the axis write fails, the plan write never happens.
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { InterviewPlanRule, PipelineStagesRule } from "@/app/_lib/decision-config-schema";
import { draftFromStored, draftToStored, type AxisDraft } from "@/app/features/shared/pipelineAxisDraft";
import { sortPlanToAxis, type PipelinePlan } from "./pipelineComposerModel";
import {
  deriveComposerState,
  migrateMapFor,
  restoreDrafts,
  runComposerSave,
  type ComposerRefresh,
} from "./composerState";

type ConfigPayload = { configs?: { interviewPlan?: InterviewPlanRule; pipelineStages?: PipelineStagesRule } };
type ImpactPayload = { counts?: Record<string, number> };

export function useHiringComposer() {
  const t = useTranslations("hiringPlan");
  const errMsg = useErrorMessage();

  const [plan, setPlan] = useState<PipelinePlan | null>(null);
  const [savedPlan, setSavedPlan] = useState<InterviewPlanRule | null>(null);
  const [axis, setAxis] = useState<AxisDraft | null>(null);
  const [savedAxis, setSavedAxis] = useState<PipelineStagesRule | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  // Per-stage occupancy. Empty until it lands: a missing count must never make a
  // removal LOOK safe, so stranding is only computed once `countsLoaded` is true.
  const [counts, setCounts] = useState<Record<string, number>>({});
  // removedStageId -> destination. Reset on discard and after a successful save.
  const [mapping, setMappingState] = useState<Record<string, string>>({});
  const [countsLoaded, setCountsLoaded] = useState(false);
  // The occupancy read FAILED (as opposed to "has not landed yet"). Rendered as
  // its own line with its own retry: it is the thing that blocks a removal, and a
  // reader looking at a page with no problems on it cannot act on "fix the
  // problems above".
  const [countsFailed, setCountsFailed] = useState(false);
  // The post-save re-reads failed. NOT a save failure — both writes are committed.
  const [refreshFailed, setRefreshFailed] = useState(false);

  const adopt = useCallback((configs: NonNullable<ConfigPayload["configs"]>) => {
    if (configs.pipelineStages) {
      setSavedAxis(configs.pipelineStages);
      setAxis(draftFromStored(configs.pipelineStages));
    }
    // No projection: the composer edits the stored shape directly (both are
    // stage-keyed), so nothing is lost on the way in or out and there is no
    // second model to keep in step with this one.
    if (configs.interviewPlan) {
      setSavedPlan(configs.interviewPlan);
      setPlan(configs.interviewPlan);
    }
  }, []);

  const loadCounts = useCallback(async (): Promise<void> => {
    try {
      const p = await readJson<ImpactPayload>(await fetch("/api/pipeline/stage-impact"));
      setCounts(p.counts ?? {});
      setCountsLoaded(true);
      setCountsFailed(false);
    } catch {
      // Deliberately not fatal to the page: the composer still edits policy. It
      // is fatal to a REMOVAL, which is what countsFailed says out loud.
      setCountsFailed(true);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/decisions/config")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((p: ConfigPayload) => {
        if (!alive) return;
        if (!p.configs?.interviewPlan || !p.configs?.pipelineStages) throw new Error();
        adopt(p.configs);
      })
      .catch(() => alive && setLoadFailed(true));
    // Off the synchronous effect body on purpose: the retry action and the first
    // read are the same function, and calling it inline trips the cascading-render
    // lint (the eslint rule cannot see that its first statement is an await).
    void Promise.resolve().then(loadCounts);
    return () => {
      alive = false;
    };
  }, [adopt, loadCounts]);

  const state = deriveComposerState({ axis, savedAxis, plan, savedPlan, counts, countsLoaded, mapping });

  const setMapping = (fromStage: string, toStage: string) =>
    setMappingState((cur) => ({ ...cur, [fromStage]: toStage }));

  const discard = () => {
    const next = restoreDrafts(savedPlan, savedAxis, { plan, axis });
    setPlan(next.plan);
    setAxis(next.axis);
    setMappingState(next.mapping);
  };

  const applyRefresh = (data: ComposerRefresh) => {
    if (data.configs) adopt(data.configs);
    if (data.counts) {
      setCounts(data.counts);
      setCountsLoaded(true);
      setCountsFailed(false);
    }
  };

  const refreshAfterSave = async (): Promise<ComposerRefresh> => {
    const configs = await readJson<ConfigPayload>(await fetch("/api/decisions/config"));
    // Occupancy changed if anybody moved; re-read so a follow-up edit is judged
    // against the new reality rather than the pre-migration counts.
    const impact = await readJson<ImpactPayload>(await fetch("/api/pipeline/stage-impact"));
    return { configs: configs.configs, counts: impact.counts ?? {} };
  };

  const retryRefresh = async () => {
    try {
      applyRefresh(await refreshAfterSave());
      setRefreshFailed(false);
    } catch {
      // Still stale — the line stays up, which is the honest report.
      setRefreshFailed(true);
    }
  };

  const save = async () => {
    if (!plan || !axis || !savedAxis || saving || state.blocked) return;
    setSaving(true);
    const outcome = await runComposerSave(
      { axisDirty: state.axisDirty, planDirty: state.planDirty },
      {
        // ONE call: the axis write and the candidate moves are the same decision
        // ("remove this column, send its people there"), so they are the same
        // request. Splitting them would let a client perform half.
        applyAxis: () =>
          applyAxis(draftToStored(axis, state.savedStages), migrateMapFor(state.stranded, mapping), errMsg, t("saveFailed")),
        // Sent in BOARD order. The editor appends a column's step on first touch,
        // so a step added and then moved earlier leaves the array disagreeing with
        // the board — and the validator numbers rounds by array position to decide
        // which one is the plan's first (and so carries no cohort reducer). Sorting
        // here is what stops a "Top 3" the composer legitimately offered from being
        // stripped by the save that reports success.
        writePlan: () => writePhase("interviewPlan", sortPlanToAxis(plan, axis.stages), errMsg, t("saveFailed")),
        refresh: refreshAfterSave,
      }
    );
    setSaving(false);
    if (outcome.kind === "write-failed") {
      toast.error(outcome.error instanceof Error ? outcome.error.message : t("saveFailed"));
      return;
    }
    setMappingState({});
    toast.success(t("savedToast"));
    if (outcome.refresh === "ok") {
      applyRefresh(outcome.data);
      setRefreshFailed(false);
    } else {
      setRefreshFailed(true);
    }
  };

  return {
    plan,
    setPlan,
    axis,
    setAxis,
    loadFailed,
    saving,
    dirty: state.dirty,
    blocked: state.blocked,
    blockedReason: state.blockedReason,
    problems: state.problems,
    stranded: state.stranded,
    mapping,
    setMapping,
    /** The occupancy read failed; a removal cannot be judged until it succeeds. */
    countsFailed,
    retryCounts: loadCounts,
    /** The save landed, the view behind it did not refresh. */
    refreshFailed,
    retryRefresh,
    discard,
    save,
  };
}

/** A JSON body from a response that must be OK. `r.json()` on a 500 HTML page
 *  throws a SyntaxError, which used to escape the save's try as "save failed"
 *  even though both writes had committed. */
async function readJson<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

/**
 * Apply an axis change and the candidate moves it forces, as one request.
 *
 * POST /api/pipeline/stage-migration owns the ordering (moves first, then the
 * config) because the two halves live behind separate SQLite connections and
 * cannot share a transaction — see that route for why moves-first is the safe
 * order. The server recomputes occupancy and refuses an unmapped removal on its
 * own; this call is not trusted to have got it right.
 */
async function applyAxis(
  config: unknown,
  migrate: Record<string, string>,
  errMsg: (payload: { code?: string | null; error?: string | null } | null, fallback: string) => string,
  fallback: string
): Promise<void> {
  const r = await fetch("/api/pipeline/stage-migration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config, migrate }),
  });
  const d = (await r.json().catch(() => ({}))) as { code?: string; error?: string };
  if (!r.ok) throw new Error(errMsg(d, fallback));
}

async function writePhase(
  phase: "pipelineStages" | "interviewPlan",
  config: unknown,
  errMsg: (payload: { code?: string | null; error?: string | null } | null, fallback: string) => string,
  fallback: string
): Promise<void> {
  const r = await fetch("/api/decisions/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Team-tier override: this workspace's own pipeline, not the org baseline.
    body: JSON.stringify({ phase, config, scope: "team" }),
  });
  const d = (await r.json().catch(() => ({}))) as { code?: string; error?: string };
  if (!r.ok) throw new Error(errMsg(d, fallback));
}
