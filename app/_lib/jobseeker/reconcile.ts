// One source, one run: discover → detail (bounded) → upsert → mark the unseen absent
// → record the outcome. The stores are injected (deps) so the run is testable on a
// fixture adapter with no DB, and so the scan runner (WP4) owns the workspace binding.
//
// The outcome vocabulary is types.ts SOURCE_RUN_OUTCOMES; the `reason` beside it is
// the closed set below — a code the UI translates, never a message. Three rules that
// make a run honest: a `blocked` fetch ANYWHERE stops the source and pauses it (a
// denial is a relationship signal, not a retry candidate); a `collapsed` shape pauses
// it too; and postings are marked absent ONLY after a complete, successful pass — a
// truncated or failed run says nothing about who is gone. "Truncated" includes reaching
// maxRefs and running out of detail budget; "complete" excludes a pass where some
// detail page could not be read (an outage, not a 404).

import type { RawPosting, SourceRunOutcome, SourceRunSummary, JobseekerSource, PauseReason } from "./types";
import { AdapterCollapsed, FetchHalt, type AdapterContext, type PostingRef, type SourceAdapter } from "./adapters/types";
import type { UpsertOutcome } from "../db/jobseeker-postings";

/** Every `reason` a SourceRunSummary can carry. */
export const RECONCILE_REASONS = [
  "blocked", // a denial status or an interstitial on some fetch
  "offline", // KP_OFFLINE
  "shape_changed", // collapsed: an API/feed without its items
  "required_rule_miss", // collapsed: a listing page where a required rule matched nothing
  "robots_disallowed", // the listing/index URL is disallowed for kp-jobseeker
  "source_outage", // 5xx / timeout / network / too large on a page the run needs
  "source_gone", // 404/410 on the listing/index
  "config_invalid", // the adapter could not build its URL from the source config
  "adapter_error", // an unexpected throw inside the adapter (logged server-side)
] as const;
export type ReconcileReason = (typeof RECONCILE_REASONS)[number];

export type ReconcileDeps = {
  upsertPosting(sourceId: string, raw: RawPosting, seenAt: string): { id: string; outcome: UpsertOutcome };
  markAbsent(sourceId: string, seenBefore: string): number;
  recordSourceRun(sourceId: string, outcome: SourceRunOutcome, at: string): void;
  pauseSource(sourceId: string, reason: PauseReason): void;
  now?: () => string;
  /** Detail progress for the caller's live line: `done` of the `total` refs this run will
   *  read (the ref list capped by the detail budget), called once before the first detail
   *  and after each one. Optional; a throw from it is the caller's bug, not the source's. */
  onDetailProgress?: (done: number, total: number) => void;
};

function haltToSummary(halt: FetchHalt): { outcome: SourceRunOutcome; reason: ReconcileReason; pause: PauseReason | null } {
  switch (halt.outcome.kind) {
    case "blocked":
      return { outcome: "blocked", reason: "blocked", pause: "blocked" };
    case "offline":
      return { outcome: "offline", reason: "offline", pause: null };
    case "robots_disallowed":
      return { outcome: "failed", reason: "robots_disallowed", pause: null };
    case "gone":
      return { outcome: "failed", reason: "source_gone", pause: null };
    case "outage":
      return { outcome: "failed", reason: halt.outcome.detail.startsWith("config_") ? "config_invalid" : "source_outage", pause: null };
  }
}

export async function reconcileSource(
  source: JobseekerSource,
  adapter: SourceAdapter,
  ctx: AdapterContext,
  deps: ReconcileDeps
): Promise<SourceRunSummary> {
  const now = deps.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const summary: SourceRunSummary = { sourceId: source.id, outcome: "succeeded", new: 0, changed: 0, unchanged: 0, absent: 0, reason: null, truncated: false };
  let detailFetches = 0;
  let truncated = false;
  const finish = (outcome: SourceRunOutcome, reason: ReconcileReason | null, pause: PauseReason | null): SourceRunSummary => {
    summary.outcome = outcome;
    summary.reason = reason;
    // Said on the record, not only in the log: a capped pass read part of the source.
    summary.truncated = truncated;
    if (pause) deps.pauseSource(source.id, pause);
    deps.recordSourceRun(source.id, outcome, now());
    return summary;
  };
  // The run's own context: an adapter reports a posting it could not read (a detail
  // outage) through `incomplete`, and that alone voids the absence measurement.
  let incomplete = false;
  const runCtx: AdapterContext = {
    ...ctx,
    incomplete: (reason) => {
      if (!incomplete) ctx.log({ level: "info", code: "pass_incomplete", detail: reason });
      incomplete = true;
      ctx.incomplete?.(reason);
    },
  };
  try {
    const refs: PostingRef[] = [];
    for await (const ref of adapter.discover(runCtx)) {
      refs.push(ref);
      if (refs.length >= ctx.limits.maxRefs) break;
    }
    // Reaching the cap is truncation whoever stopped: reconcile's break above, or an
    // adapter that honours maxRefs itself and ends its iterator at exactly the cap.
    // Either way refs past it were never seen, so they must not be called gone.
    if (refs.length >= ctx.limits.maxRefs) {
      truncated = true;
      ctx.log({ level: "info", code: "ref_cap_reached", detail: `${ctx.limits.maxRefs} refs read; absence not measured this run` });
    }
    const planned = adapter.detailFetches ? Math.min(refs.length, ctx.limits.maxDetailFetches) : refs.length;
    let read = 0;
    deps.onDetailProgress?.(0, planned);
    for (const ref of refs) {
      if (adapter.detailFetches) {
        if (detailFetches >= ctx.limits.maxDetailFetches) {
          truncated = true;
          ctx.log({ level: "info", code: "detail_budget_exhausted", detail: `${refs.length - detailFetches} refs left for the next run` });
          break;
        }
        detailFetches++;
      }
      const raw = await adapter.detail(ref, runCtx);
      deps.onDetailProgress?.(++read, planned);
      if (!raw) continue;
      const seenAt = now();
      const { outcome } = deps.upsertPosting(source.id, raw, seenAt);
      summary[outcome] += 1;
    }
    if (!truncated && !incomplete) {
      summary.absent = deps.markAbsent(source.id, startedAt);
    }
    return finish("succeeded", null, null);
  } catch (error) {
    if (error instanceof AdapterCollapsed) {
      ctx.log({ level: "warn", code: "collapsed", detail: error.message });
      return finish("collapsed", error.reason, "collapsed");
    }
    if (error instanceof FetchHalt) {
      const mapped = haltToSummary(error);
      ctx.log({ level: "warn", code: mapped.reason, detail: error.outcome.detail });
      return finish(mapped.outcome, mapped.reason, mapped.pause);
    }
    // The raw error goes to the server log; the summary carries the code only.
    console.error(`[jobseeker:reconcile] ${source.id} adapter_error`, error);
    return finish("failed", "adapter_error", null);
  }
}
