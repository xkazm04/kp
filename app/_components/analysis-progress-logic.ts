// Pure, render-free logic for the AnalysisProgress panel. Split out of the
// .tsx so it can be unit-tested under Node's built-in runner (which strips .ts
// types but cannot load JSX). AnalysisProgress.tsx re-exports every symbol here,
// so existing `@/app/_components/AnalysisProgress` imports keep working.

export type StageId =
  | "extract"
  | "gemini"
  | "profile"
  | "scoring"
  | "salary"
  | "insights";

export type StageStatus = "pending" | "active" | "done";

export type StageState = Record<StageId, StageStatus>;

export const STAGE_ORDER: StageId[] = [
  "extract",
  "gemini",
  "profile",
  "scoring",
  "salary",
  "insights",
];

export function initialStageState(): StageState {
  return {
    extract: "pending",
    gemini: "pending",
    profile: "pending",
    scoring: "pending",
    salary: "pending",
    insights: "pending",
  };
}

export function applyStageEvent(state: StageState, stage: StageId, status: StageStatus): StageState {
  if (status === "done" && state[stage] === "done") return state;
  if (status === "active" && state[stage] === "active") return state;
  const next: StageState = { ...state, [stage]: status };
  if (status === "active") {
    const idx = STAGE_ORDER.indexOf(stage);
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

// bug-ui-scan-2026-07-09 (cv-analysis-workspace #5): the old bar invented
// progress from a 1.8s stage timer and froze at ~83% for the whole 30–60s Gemini
// call (reads as a hang), and on a multi-variant comparison it showed that same
// fake single track while THROWING AWAY the genuine per-variant done/total the
// server already persists (setTaskProgress → task.progressDone/progressTotal).
// This derives an honest display:
//   • multi-variant (variantsTotal > 1): drive the bar from the REAL variant
//     completion count; show an indeterminate bar until the first variant lands.
//   • single run: keep the cosmetic stage strip, but once the LAST stage is
//     active (the long, un-instrumented Gemini call) flip to indeterminate
//     instead of freezing at a fabricated percentage.
export function deriveProgressDisplay(args: {
  stages: StageState;
  complete: boolean;
  variantsDone?: number;
  variantsTotal?: number;
}): ProgressDisplay {
  const { stages, complete, variantsDone, variantsTotal } = args;
  if (complete) return { percent: 100, indeterminate: false };

  // Real per-variant signal from the server takes precedence over the faked strip.
  if (variantsTotal && variantsTotal > 1) {
    const done = Math.min(Math.max(variantsDone ?? 0, 0), variantsTotal);
    const percent = Math.round((done / variantsTotal) * 100);
    // Nothing has finished yet → no honest determinate value; show motion.
    return { percent, indeterminate: done === 0 };
  }

  const completedCount = STAGE_ORDER.filter((id) => stages[id] === "done").length;
  const percent = Math.round((completedCount / STAGE_ORDER.length) * 100);
  const headlineStage = STAGE_ORDER.find((id) => stages[id] === "active") ?? null;
  const lastStage = STAGE_ORDER[STAGE_ORDER.length - 1];
  const indeterminate = headlineStage === lastStage;
  return { percent, indeterminate };
}

/** The active stage to headline, or null once the run is complete. */
export function headlineStageOf(stages: StageState, complete: boolean): StageId | null {
  if (complete) return null;
  return STAGE_ORDER.find((id) => stages[id] === "active") ?? null;
}
