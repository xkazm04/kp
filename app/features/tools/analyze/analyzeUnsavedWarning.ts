import type { Analysis } from "@/app/_lib/schemas";

// A delivered analysis whose save failed. persistAnalysis (app/_lib/analyze-run.ts)
// swallows a saveAnalysis error and the response carries `persistence: null`; the live
// result then looks complete although nothing reached History, so reloading loses it.
// Only an explicit null is that signal: a body without the field predates the receipt,
// and a restored result always rebuilds one from its saved row (analyzeSession.ts).
// Pure + render-free so it unit-tests under Node.
export function shouldWarnUnsaved(analysis: Analysis | null): boolean {
  return analysis !== null && analysis.persistence === null;
}
