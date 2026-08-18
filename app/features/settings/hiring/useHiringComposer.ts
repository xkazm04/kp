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
// The axis is saved BEFORE the plan, deliberately. The plan's stations resolve
// against the axis (composerStations), so persisting a plan that references a
// column the stored axis does not have yet would leave a window where the two
// disagree. If the axis write fails, the plan write never happens.
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { InterviewPlanRule, PipelineStagesRule } from "@/app/_lib/decision-config-schema";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import {
  axisEqualsStored,
  axisProblems,
  draftFromStored,
  draftToStored,
  strandedByDraft,
  type AxisDraft,
} from "@/app/features/shared/pipelineAxisDraft";
import { fromStoredPlan, planEqualsStored, toStoredPlan, type PipelinePlan } from "./pipelineComposerModel";

type ConfigPayload = { configs?: { interviewPlan?: InterviewPlanRule; pipelineStages?: PipelineStagesRule } };

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
  // removal LOOK safe, so `stranded` is only trusted once `countsLoaded` is true.
  const [counts, setCounts] = useState<Record<string, number>>({});
  // removedStageId -> destination. Reset on discard and after a successful save.
  const [mapping, setMappingState] = useState<Record<string, string>>({});
  const [countsLoaded, setCountsLoaded] = useState(false);

  const adopt = useCallback((configs: NonNullable<ConfigPayload["configs"]>) => {
    if (configs.interviewPlan) {
      setSavedPlan(configs.interviewPlan);
      setPlan(fromStoredPlan(configs.interviewPlan));
    }
    if (configs.pipelineStages) {
      setSavedAxis(configs.pipelineStages);
      setAxis(draftFromStored(configs.pipelineStages));
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
    // Occupancy is advisory, not load-bearing for rendering: a failure leaves
    // countsLoaded false, which makes the tab refuse an axis REMOVAL rather than
    // let one through unverified.
    fetch("/api/pipeline/stage-impact")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((p: { counts?: Record<string, number> }) => {
        if (!alive) return;
        setCounts(p.counts ?? {});
        setCountsLoaded(true);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [adopt]);

  const savedStages: StageDef[] = savedAxis?.stages.map((s) => ({ ...(s as StageDef) })) ?? [];
  const problems = axis ? axisProblems(axis) : [];
  const stranded = axis && countsLoaded ? strandedByDraft(axis, savedStages, counts) : [];
  const axisDirty = axis != null && savedAxis != null && !axisEqualsStored(axis, savedAxis, savedStages);
  const planDirty = plan != null && savedPlan != null && !planEqualsStored(plan, savedPlan);
  const dirty = axisDirty || planDirty;
  // A removal we cannot account for is refused, not warned about. Two ways it can
  // be unaccounted for: the occupancy read failed (so a count of 0 would be a
  // guess, not a fact), or the operator has not yet said where the people go.
  const removalsPending = axis != null && savedAxis != null && !countsLoaded && droppedAny(axis, savedStages);
  // A destination must still EXIST in the draft — removing the column someone was
  // mapped onto silently invalidates the mapping, and the reader must re-answer.
  const liveIds = new Set(axis?.stages.map((s) => s.id) ?? []);
  const unmapped = stranded.filter((s) => !liveIds.has(mapping[s.stage.id] ?? ""));
  const blocked = problems.length > 0 || unmapped.length > 0 || removalsPending;

  const setMapping = (fromStage: string, toStage: string) =>
    setMappingState((cur) => ({ ...cur, [fromStage]: toStage }));

  const discard = () => {
    if (savedPlan) setPlan(fromStoredPlan(savedPlan));
    if (savedAxis) setAxis(draftFromStored(savedAxis));
    setMappingState({});
  };

  const save = async () => {
    if (!plan || !axis || !savedAxis || saving || blocked) return;
    setSaving(true);
    try {
      if (axisDirty) {
        // Only the legs this edit actually needs — a stale mapping entry for a
        // stage the reader put back must not move anybody.
        const migrate: Record<string, string> = {};
        for (const s of stranded) migrate[s.stage.id] = mapping[s.stage.id];
        // ONE call: the axis write and the candidate moves are the same decision
        // ("remove this column, send its people there"), so they are the same
        // request. Splitting them would let a client perform half.
        await applyAxis(draftToStored(axis, savedStages), migrate, errMsg, t("saveFailed"));
      }
      if (planDirty) await writePhase("interviewPlan", toStoredPlan(plan), errMsg, t("saveFailed"));
      const refreshed = (await fetch("/api/decisions/config").then((r) => r.json())) as ConfigPayload;
      if (refreshed.configs) adopt(refreshed.configs);
      // Occupancy changed if anybody moved; re-read so a follow-up edit is judged
      // against the new reality rather than the pre-migration counts.
      const impact = (await fetch("/api/pipeline/stage-impact").then((r) => r.json())) as { counts?: Record<string, number> };
      setCounts(impact.counts ?? {});
      setMappingState({});
      toast.success(t("savedToast"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return {
    plan,
    setPlan,
    axis,
    setAxis,
    loadFailed,
    saving,
    dirty,
    blocked,
    problems,
    stranded,
    mapping,
    setMapping,
    countsLoaded,
    discard,
    save,
  };
}

/** Does this draft drop any saved stage at all? Used only to decide whether a
 *  missing occupancy read is a blocker — a draft that removes nothing is safe to
 *  save regardless of what we know about counts. */
function droppedAny(draft: AxisDraft, savedStages: readonly StageDef[]): boolean {
  const live = new Set(draft.stages.map((s) => s.id));
  return savedStages.some((s) => !live.has(s.id));
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
