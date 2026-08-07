// Direction 3 — "honest progress for the single-CV run". The analyze progress
// strip used to animate six Python-INTERNAL stages (extract→gemini→…→insights) on
// a fixed 1800ms cosmetic timer unrelated to real server state. These are the only
// phases the TypeScript side can actually OBSERVE:
//   • reading   — the uploaded CV file(s) are being read off disk (fast).
//   • analyzing — the Python engine is running (the long, opaque LLM span; the
//                 client shows indeterminate progress + a ticking elapsed clock
//                 here, since nothing finer is observable from this side).
//   • saving    — the delivered result is being persisted.
// analyze-run (server) emits these through the task row's progress `msg`; the
// client (AnalyzeApi) maps them back to honest, localized stage labels. One source
// of truth so the two sides can't drift, and so `next dev`'s server/client split
// never disagrees on the token spelling.
export const ANALYZE_PHASE = {
  reading: "reading",
  analyzing: "analyzing",
  saving: "saving",
} as const;

export type AnalyzePhase = (typeof ANALYZE_PHASE)[keyof typeof ANALYZE_PHASE];

/** The ordered phases, driving the strip's row order and completion percent. */
export const ANALYZE_PHASE_ORDER: AnalyzePhase[] = [
  ANALYZE_PHASE.reading,
  ANALYZE_PHASE.analyzing,
  ANALYZE_PHASE.saving,
];

/** Narrow an arbitrary task progress `msg` to a known phase, or null. */
export function asAnalyzePhase(msg: string | null | undefined): AnalyzePhase | null {
  return msg === "reading" || msg === "analyzing" || msg === "saving" ? msg : null;
}
