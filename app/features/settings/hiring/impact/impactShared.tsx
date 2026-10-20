"use client";

/*
 * The plan readings the Settings > Hiring impact previews draw (kit/HiringKitPreviews): the
 * station label a preview says out loud, and the ledger of every point where a verdict could be
 * ratified. Pure readings of the plan plus one label hook; the previews own their drawing.
 *
 * The card chrome that used to live here (per-destination silhouettes, the round chip) left with
 * the pre-kit impact strip when the kit view was promoted (Gate 1, kit-unification spark).
 */
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { prunePlanToAxis } from "@/app/_lib/decision-config-schema";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import type { GateMode, PipelinePlan, RoundKind } from "../pipelineComposerModel";
import { DEFAULT_STAGE_AXIS } from "@/app/_lib/pipeline-stages";

/** The station label the cards say out loud, resolved ONCE.
 *
 *  A workspace-renamed column shows its own words; a shipped one stays localized
 *  through `enums.stage.*` — the same catalog PipelineBoard draws its column
 *  headers from, which is why Settings and Overview read as one product. */
export function useImpactCopy(axis: readonly StageDef[]) {
  const enumLabel = useEnumLabel();
  const stationLabel = (id: string): string => {
    const stage = axis.find((s) => s.id === id);
    return stage && stage.label !== stage.id ? stage.label : enumLabel("stage", id);
  };
  return { stationLabel };
}

/** EVERY point in the plan where a verdict could be ratified, human or not —
 *  the reading the old strip could not give, because it listed only the human
 *  queues and so never showed what the recruiter had switched OFF.
 *
 *  Mirrors `deriveImpact`'s rule that a human round's verdict is human by
 *  definition (the gate only governs AI rounds). */
export type GateRow = {
  key: string;
  kind: "screening" | "homework" | "round" | "offer";
  /** The board column this ratification point sits at — so the ledger can name
   *  the recruiter's own column instead of a generic station word. */
  stageId: string;
  /** 1-based round number, for `stationRound`. */
  n?: number;
  roundKind?: RoundKind;
  mode: GateMode;
};

/** EVERY point in the plan where a verdict could be ratified, walked in BOARD
 *  order. It used to assume the shape — screening, then every round, then offer —
 *  because the plan was three loose fields and the order was the only structure
 *  there was. The plan names its columns now, so this reads the board and asks
 *  what each column does, which is also the only way a second screening column
 *  can appear in the ledger at all. */
export function gateLedger(plan: PipelinePlan, axis: readonly StageDef[] = DEFAULT_STAGE_AXIS): GateRow[] {
  const rows: GateRow[] = [];
  let n = 0;
  // The plan AS THE SERVER WILL READ IT — same projection `deriveImpact` takes,
  // so the ladder and the touchpoint count beside it cannot disagree. The
  // composer is the only reader that holds the raw blob (it loads
  // getAllDecisionConfigs, not getInterviewPlan), so a step at a column this axis
  // has dropped or re-roled would otherwise draw a checkpoint nobody ever reaches.
  const live = prunePlanToAxis(plan, axis);
  for (const stage of axis) {
    const step = live.steps.find((s) => s.stageId === stage.id);
    if (!step) continue;
    if (stage.role === "screening") rows.push({ key: `${stage.id}:gate`, kind: "screening", stageId: stage.id, mode: step.gate });
    // The case step's checkpoint: who lets the assignment go out. Drawn like any
    // other gate so a recruiter can see it left on `auto` — the one reading the
    // queue-name row could never give.
    if (stage.role === "homework") rows.push({ key: `${stage.id}:gate`, kind: "homework", stageId: stage.id, mode: step.gate });
    step.rounds.forEach((r, i) => {
      n += 1;
      rows.push({
        key: `${stage.id}:${i}`,
        kind: "round",
        stageId: stage.id,
        n,
        roundKind: r.kind,
        mode: (r.kind === "human" ? "human" : r.gate) as GateMode,
      });
    });
    if (stage.role === "offer") rows.push({ key: `${stage.id}:gate`, kind: "offer", stageId: stage.id, mode: step.gate });
  }
  return rows;
}
