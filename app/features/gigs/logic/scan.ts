import type { GigSourceRunOutcome } from "@/app/_lib/gigs/types";

/** The part of the `gig_scan` task result a source card reads (gigs/scan.ts
 *  GigScanSummary, restated narrowly: that module reaches the stores). */
export type ScanRunResult = {
  sourceId: string | null;
  notRunnable: number;
  aborted: boolean;
  sources: { sourceId: string; outcome: GigSourceRunOutcome; reason: string | null; created: number; found: number }[];
};

export type SourceScanView =
  | { kind: "ran"; outcome: GigSourceRunOutcome; reason: string | null; created: number; found: number }
  | { kind: "not_run" }
  | { kind: "unknown" };

/** What one source's scan did, read off the task's result: its own run line, "not run"
 *  when a pause landed between the enqueue and the run, or unknown when the result is
 *  unreadable (never a made-up "0 new"). */
export function sourceScanView(result: unknown, sourceId: string): SourceScanView {
  if (!result || typeof result !== "object" || !Array.isArray((result as ScanRunResult).sources)) return { kind: "unknown" };
  const r = result as ScanRunResult;
  const line = r.sources.find((s) => s && s.sourceId === sourceId);
  if (line) return { kind: "ran", outcome: line.outcome, reason: line.reason ?? null, created: Number(line.created) || 0, found: Number(line.found) || 0 };
  if (r.notRunnable > 0) return { kind: "not_run" };
  return { kind: "unknown" };
}
