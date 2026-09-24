import { transitionGig } from "../db/gigs";
import { listGigAttemptsByStatus, transitionGigAttempt } from "../db/gigs-attempts";
import { parseGigDeliverable } from "./deliverable";
import { fetchPersonaExecution, type FetchExecutionResult } from "./personas-exec";
import type { GigAttempt } from "./types";

// Pull the state of every in-flight attempt from Personas and land what finished.
//
// For each attempt `dispatched | running` in the workspace, GET its execution and map
// the Personas status word (ExecutionState, personas core/src/types.rs) onto the attempt:
//
//   Personas status          attempt                              gig
//   ---------------------    -----------------------------------  -----------------------
//   queued / pending         unchanged (still `dispatched`)       unchanged
//   running                  dispatched -> running                unchanged
//   completed + deliverable  -> drafted (deliverable, cost)       dispatched -> drafted
//   completed, no/bad block  -> failed (parse reason, cost)       dispatched -> qualified
//   incomplete + deliverable -> drafted (deliverable, cost)       dispatched -> drafted
//   incomplete, no block     -> failed `personas_incomplete`      dispatched -> qualified
//   failed                   -> failed `personas_failed`          dispatched -> qualified
//   cancelled                -> failed `personas_cancelled`       dispatched -> qualified
//   any other word           unchanged (counted `unknown`)        unchanged
//   GET 404                  -> failed `personas_execution_missing`  dispatched -> qualified
//   GET 403                  -> failed `personas_scope_missing`   dispatched -> qualified
//   unreachable / 401 / 5xx  unchanged (retried next sync)        unchanged
//
// `costUsd` is stored when Personas reported one, null otherwise (null = not reported,
// never "free"). Every write is a CAS through the WP1 helpers: an attempt the operator
// discarded while its run was finishing stays discarded (`stale` is counted, not forced).
//
// An attempt still `dispatched` with NO execution id is a dispatch whose POST never
// finished (a crash between the POST and the stamp). Past DISPATCH_INTERRUPTED_MS it is
// failed `dispatch_interrupted` so the gig returns to `qualified` instead of hanging.

export const DISPATCH_INTERRUPTED_MS = 10 * 60_000;

export type GigSyncDeps = {
  fetchExecution: (executionId: string) => Promise<FetchExecutionResult>;
  now?: () => Date;
};

export type GigSyncSummary = {
  checked: number;
  running: number;
  drafted: number;
  failed: number;
  unchanged: number;
  /** Personas answered a status word kp does not know. */
  unknown: number;
  /** Personas could not be asked (retried next sync). */
  unreachable: number;
  /** A write lost its CAS - the attempt or gig moved meanwhile. */
  stale: number;
};

const defaultDeps: GigSyncDeps = { fetchExecution: fetchPersonaExecution };

type Landing =
  | { kind: "none" }
  | { kind: "running" }
  | { kind: "drafted"; outputData: string | null; costUsd: number | null }
  | { kind: "failed"; reason: string; costUsd: number | null };

/** The Personas status word -> what kp does with it. Pure; exported for the table test. */
export function landingFor(status: string, outputData: string | null, costUsd: number | null): Landing {
  switch (status.toLowerCase()) {
    case "queued":
    case "pending":
      return { kind: "none" };
    case "running":
      return { kind: "running" };
    case "completed":
      return { kind: "drafted", outputData, costUsd };
    case "incomplete":
      // A run cut short (turn or budget cap) may still have ended with its block; if it
      // did, the operator reviews it like any draft. If not, the reason is the cut.
      return parseGigDeliverable(outputData).ok
        ? { kind: "drafted", outputData, costUsd }
        : { kind: "failed", reason: "personas_incomplete", costUsd };
    case "failed":
      return { kind: "failed", reason: "personas_failed", costUsd };
    case "cancelled":
      return { kind: "failed", reason: "personas_cancelled", costUsd };
    default:
      return { kind: "none" };
  }
}

function failGig(workspaceId: string, gigId: string): boolean {
  return transitionGig(workspaceId, gigId, { from: "dispatched", to: "qualified" }).ok;
}

function failAttempt(workspaceId: string, attempt: GigAttempt, reason: string, costUsd: number | null, s: GigSyncSummary): void {
  const res = transitionGigAttempt(workspaceId, attempt.id, {
    from: ["dispatched", "running"],
    to: "failed",
    patch: { fallbackReason: reason, ...(costUsd !== null ? { costUsd } : {}) },
  });
  if (!res.ok) {
    s.stale += 1;
    return;
  }
  s.failed += 1;
  // The gig may already have moved on (withdrawn, a newer attempt): only a gig still
  // waiting on THIS dispatch goes back to qualified.
  failGig(workspaceId, attempt.gigId);
}

async function syncOne(workspaceId: string, attempt: GigAttempt, deps: GigSyncDeps, now: Date, s: GigSyncSummary): Promise<void> {
  if (!attempt.executionId) {
    const age = now.getTime() - Date.parse(attempt.createdAt);
    if (attempt.status === "dispatched" && Number.isFinite(age) && age > DISPATCH_INTERRUPTED_MS) {
      failAttempt(workspaceId, attempt, "dispatch_interrupted", null, s);
    } else s.unchanged += 1;
    return;
  }
  s.checked += 1;
  let fetched: FetchExecutionResult;
  try {
    fetched = await deps.fetchExecution(attempt.executionId);
  } catch {
    // The default transport never throws; an injected one might - treated as unreachable.
    fetched = { ok: false, reason: "personas_unreachable", retryable: true };
  }
  if (!fetched.ok) {
    if (fetched.retryable) {
      s.unreachable += 1;
      return;
    }
    failAttempt(workspaceId, attempt, fetched.reason, null, s);
    return;
  }
  const { status, outputData, costUsd } = fetched.execution;
  const landing = landingFor(status, outputData, costUsd);
  if (landing.kind === "none") {
    if (!["queued", "pending"].includes(status.toLowerCase())) s.unknown += 1;
    else s.unchanged += 1;
    return;
  }
  if (landing.kind === "running") {
    if (attempt.status === "running") {
      s.unchanged += 1;
      return;
    }
    const res = transitionGigAttempt(workspaceId, attempt.id, { from: "dispatched", to: "running" });
    if (res.ok) s.running += 1;
    else s.stale += 1;
    return;
  }
  if (landing.kind === "failed") {
    failAttempt(workspaceId, attempt, landing.reason, landing.costUsd, s);
    return;
  }
  const parsed = parseGigDeliverable(landing.outputData);
  if (!parsed.ok) {
    failAttempt(workspaceId, attempt, parsed.reason, landing.costUsd, s);
    return;
  }
  const res = transitionGigAttempt(workspaceId, attempt.id, {
    from: ["dispatched", "running"],
    to: "drafted",
    patch: { deliverable: parsed.deliverable, fallbackReason: null, costUsd: landing.costUsd },
  });
  if (!res.ok) {
    s.stale += 1;
    return;
  }
  s.drafted += 1;
  transitionGig(workspaceId, attempt.gigId, { from: "dispatched", to: "drafted" });
}

/** One sync pass over the workspace's in-flight attempts, oldest first, sequential (a
 *  local bridge, a handful of rows - and one slow GET must not fan out into many). */
export async function syncGigAttempts(workspaceId: string, deps: GigSyncDeps = defaultDeps): Promise<GigSyncSummary> {
  const s: GigSyncSummary = { checked: 0, running: 0, drafted: 0, failed: 0, unchanged: 0, unknown: 0, unreachable: 0, stale: 0 };
  const now = deps.now ? deps.now() : new Date();
  for (const attempt of listGigAttemptsByStatus(workspaceId, ["dispatched", "running"])) {
    await syncOne(workspaceId, attempt, deps, now, s);
  }
  return s;
}
