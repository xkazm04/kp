// Pure, render-free logic for the AnalysisProgress panel. Split out of the
// .tsx so it can be unit-tested under Node's built-in runner (which strips .ts
// types but cannot load JSX). AnalysisProgress.tsx re-exports every symbol here,
// so existing `@/app/_components/AnalysisProgress` imports keep working.
//
// Direction 3 — HONEST stages. The strip used to animate six Python-INTERNAL
// stages (extract→gemini→profile→scoring→salary→insights) on a fixed cosmetic
// timer the client couldn't observe. It now reflects only the phases the
// TypeScript side genuinely sees, emitted by analyze-run through the task row:
//   reading → analyzing → saving  (see app/_lib/analyze-phases.ts).
// The long "analyzing" (engine) span is honestly INDETERMINATE with a ticking
// elapsed clock rather than a fabricated advancing percentage.
import { ANALYZE_PHASE_ORDER, type AnalyzePhase } from "@/app/_lib/analyze-phases";

// The strip's stages ARE the observable phases — one source of truth with the
// server emitter so a stage can never be shown that the run isn't actually in.
export type StageId = AnalyzePhase;

export type StageStatus = "pending" | "active" | "done";

export type StageState = Record<StageId, StageStatus>;

export const STAGE_ORDER: StageId[] = [...ANALYZE_PHASE_ORDER];

export function initialStageState(): StageState {
  return {
    reading: "pending",
    analyzing: "pending",
    saving: "pending",
  };
}

export function applyStageEvent(state: StageState, stage: StageId, status: StageStatus): StageState {
  if (status === "done" && state[stage] === "done") return state;
  if (status === "active" && state[stage] === "active") return state;
  const next: StageState = { ...state, [stage]: status };
  if (status === "active") {
    const idx = STAGE_ORDER.indexOf(stage);
    // Auto-complete every EARLIER stage. This also guarantees no regression on a
    // repeated/late signal: advancing to a later phase can only mark earlier ones
    // done, never re-open them, so a stalled or retried engine can't rewind the
    // strip.
    for (let i = 0; i < idx; i += 1) {
      const earlier = STAGE_ORDER[i];
      if (next[earlier] === "pending") {
        next[earlier] = "done";
      }
    }
  }
  return next;
}

export type ProgressDisplay = {
  /** 0–100 fill for the determinate bar. */
  percent: number;
  /**
   * When true, render an animated indeterminate bar instead of a frozen fill —
   * the client has no finer signal for the ongoing step, so a static width would
   * read as a hang.
   */
  indeterminate: boolean;
};

// Derives an HONEST display:
//   • multi-variant (variantsTotal > 1): drive the bar from the REAL per-variant
//     completion count the server persists; show motion until the first lands.
//   • single run: a small determinate fill for the instant reading/saving phases,
//     and INDETERMINATE while "analyzing" (the long, un-instrumented engine span)
//     is active — so a slow or stalled model call reads as in-progress (the
//     elapsed clock keeps ticking) rather than freezing at a fabricated percent.
export function deriveProgressDisplay(args: {
  stages: StageState;
  complete: boolean;
  variantsDone?: number;
  variantsTotal?: number;
}): ProgressDisplay {
  const { stages, complete, variantsDone, variantsTotal } = args;
  if (complete) return { percent: 100, indeterminate: false };

  // Real per-variant signal from the server takes precedence for a comparison.
  if (variantsTotal && variantsTotal > 1) {
    const done = Math.min(Math.max(variantsDone ?? 0, 0), variantsTotal);
    const percent = Math.round((done / variantsTotal) * 100);
    // Nothing has finished yet → no honest determinate value; show motion.
    return { percent, indeterminate: done === 0 };
  }

  const completedCount = STAGE_ORDER.filter((id) => stages[id] === "done").length;
  const percent = Math.round((completedCount / STAGE_ORDER.length) * 100);
  // The engine span is the only truly un-instrumented one → indeterminate there.
  const indeterminate = stages.analyzing === "active";
  return { percent, indeterminate };
}

/** The active stage to headline, or null once the run is complete. */
export function headlineStageOf(stages: StageState, complete: boolean): StageId | null {
  if (complete) return null;
  return STAGE_ORDER.find((id) => stages[id] === "active") ?? null;
}
