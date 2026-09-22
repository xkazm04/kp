// The per-candidate ledger of a FAN-OUT task (batch_screen, batch_outreach): one
// background run that performs the same automation for each entry of a cohort.
//
// A fan-out run used to end as one number in the Background-tasks drawer. The
// outreach handler marked every non-throwing item `ok` although the automation
// returns `suppressed_*` / `already_sent` WITHOUT throwing (a consent-suppressed
// letter was counted as drafted), it stored the thrown `e.message` — Python
// tracebacks, workdir paths — as the item's reason, and the screen handler kept an
// error COUNT only. Retry was whole-run and only for failed/interrupted/canceled.
//
// This module reads a stored row (params + result + status) into id sets —
// delivered / suppressed / failed-by-code / unreached — and decides the scoped
// retry ('failed' | 'unreached') the retry door enqueues. Pure and import-light:
// the drawer (client) and node:test both load it; tasks.ts cannot be loaded by
// either.
//
// An item is `{ id, ok, applied?, code? }` — ids and machine tokens ONLY. The
// tasks table is erasure-exempt and not entry-keyed (app/_lib/db/pipeline.ts), so
// a candidate label, an address or free text written into it would outlive the
// candidate's erasure. That is also why the reader below copies ids and codes out
// of an item and nothing else.
import type { TaskKind } from "./task-kinds";

/** The kinds that fan out over a cohort of pipeline entries (`params.entryIds`). */
export const FANOUT_KINDS = ["batch_screen", "batch_outreach"] as const satisfies readonly TaskKind[];
export type FanoutKind = (typeof FANOUT_KINDS)[number];

export function isFanoutKind(kind: unknown): kind is FanoutKind {
  return kind === "batch_screen" || kind === "batch_outreach";
}

/** Why one item failed, as a code the drawer translates (`tasks.outcome.fanout.code.*`).
 *  The first four are automation-run.ts's AUTOMATION_REFUSALS — tasks.ts assigns an
 *  `AutomationRefusal` to this type, so a refusal added there without a word here is
 *  a compile error at that line. Everything else is `engine_failed`: its message is
 *  internal detail and is never stored. */
export const FANOUT_CODES = ["unknown_task", "entry_not_found", "entry_has_no_profile", "task_not_offered", "engine_failed"] as const;
export type FanoutCode = (typeof FANOUT_CODES)[number];

function isFanoutCode(v: unknown): v is FanoutCode {
  return typeof v === "string" && (FANOUT_CODES as readonly string[]).includes(v);
}

/** One stored per-candidate record. */
export type FanoutItem = { id: string; ok: boolean; applied?: string; code?: FanoutCode };

/** The code for a caught per-item failure: the thrower's own machine `refusal` when
 *  it is one this build can label, else `engine_failed`. Never the message. */
export function fanoutItemCode(error: unknown): FanoutCode {
  const refusal = error && typeof error === "object" ? (error as { refusal?: unknown }).refusal : undefined;
  return isFanoutCode(refusal) ? refusal : "engine_failed";
}

export type FanoutOutcome = {
  /** Processed: the letter went out (or already had), or the screen reached a verdict. */
  deliveredIds: string[];
  /** Processed but deliberately NOT contacted — consent expired, data anonymized. */
  suppressedIds: string[];
  failedIds: string[];
  /** In the cohort, never attempted: the run stopped (canceled / interrupted) first. */
  unreachedIds: string[];
  byCode: Partial<Record<FanoutCode, number>>;
};

const SUPPRESSED = new Set(["suppressed_anonymized", "suppressed_consent_expired"]);

function cohortOf(params: unknown): string[] | null {
  const ids = params && typeof params === "object" ? (params as { entryIds?: unknown }).entryIds : undefined;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : null;
}

function ledgerOf(result: unknown): unknown[] | null {
  const items = result && typeof result === "object" ? (result as { results?: unknown }).results : undefined;
  return Array.isArray(items) ? items : null;
}

/** A stored row read as id sets. `null` for a kind that does not fan out. A row with
 *  no per-item ledger (an older batch_screen stored counts only) yields empty sets:
 *  counts cannot name WHO to retry, so no subset is ever derived from them. */
export function fanoutOutcome(kind: string, params: unknown, result: unknown, status: string): FanoutOutcome | null {
  if (!isFanoutKind(kind)) return null;
  const out: FanoutOutcome = { deliveredIds: [], suppressedIds: [], failedIds: [], unreachedIds: [], byCode: {} };
  const items = ledgerOf(result);
  if (!items) return out;
  const recorded = new Set<string>();
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as { id?: unknown; ok?: unknown; applied?: unknown; code?: unknown };
    if (typeof item.id !== "string" || recorded.has(item.id)) continue;
    recorded.add(item.id);
    if (item.ok === true) {
      (typeof item.applied === "string" && SUPPRESSED.has(item.applied) ? out.suppressedIds : out.deliveredIds).push(item.id);
    } else {
      // A legacy item carries a raw `reason` and no code: it is an engine failure,
      // and the reason is not read at all.
      const code: FanoutCode = isFanoutCode(item.code) ? item.code : "engine_failed";
      out.failedIds.push(item.id);
      out.byCode[code] = (out.byCode[code] ?? 0) + 1;
    }
  }
  // Only a run that STOPPED has a remainder. A succeeded run's unrecorded ids were
  // filtered out as ineligible (no longer active, another workspace), not skipped.
  if (status !== "succeeded") {
    const cohort = cohortOf(params);
    if (cohort) out.unreachedIds = [...new Set(cohort)].filter((id) => !recorded.has(id));
  }
  return out;
}

export const RETRY_SCOPES = ["failed", "unreached"] as const;
export type RetryScope = (typeof RETRY_SCOPES)[number];

function isRetryScope(v: unknown): v is RetryScope {
  return v === "failed" || v === "unreached";
}

const ACTIVE_STATUSES = new Set(["queued", "running"]);

/** The scopes a finished row can be retried by, in display order. */
export function retryScopes(kind: string, params: unknown, result: unknown, status: string): RetryScope[] {
  if (ACTIVE_STATUSES.has(status)) return [];
  const out = fanoutOutcome(kind, params, result, status);
  if (!out) return [];
  return RETRY_SCOPES.filter((s) => (s === "failed" ? out.failedIds : out.unreachedIds).length > 0);
}

/** The original params narrowed to `ids`. `null` when the kind does not fan out or
 *  the subset is empty. The cohort is part of both kinds' dedupe identity
 *  (task-dedupe.ts), so a subset forks its own run instead of merging onto the old one. */
export function retryParamsFor(kind: string, params: unknown, ids: readonly string[]): Record<string, unknown> | null {
  if (!isFanoutKind(kind) || ids.length === 0) return null;
  const base = params && typeof params === "object" && !Array.isArray(params) ? (params as Record<string, unknown>) : {};
  return { ...base, entryIds: [...ids] };
}

/** The statuses a whole-run replay (no scope) accepts — a dead end, never a success. */
export const FULL_REPLAY_STATUSES: ReadonlySet<string> = new Set(["failed", "interrupted", "canceled"]);

export type RetryDecision = { ok: Record<string, unknown> } | { refuse: "TASK_NOT_FOUND" | "TASK_NOT_RETRYABLE" };

/** What POST /api/tasks/[id]/retry may enqueue, decided from what it has already read.
 *
 *  `task` is the row the route read with `getTask(id, ws)` — null for a missing id
 *  AND for another workspace's task, which is why it is weighed FIRST: a foreign id
 *  answers TASK_NOT_FOUND whatever the scope. Every refusal here is decided before
 *  the route touches a rate-limit bucket. The subset is derived server-side from the
 *  stored row; the client names a scope, never ids. */
export function retryDecision(
  task: { kind: string; status: string; params: unknown; result: unknown } | null,
  scope: unknown
): RetryDecision {
  if (!task) return { refuse: "TASK_NOT_FOUND" };
  const params = task.params && typeof task.params === "object" ? (task.params as Record<string, unknown>) : {};
  if (scope === undefined || scope === null) {
    return FULL_REPLAY_STATUSES.has(task.status) ? { ok: params } : { refuse: "TASK_NOT_RETRYABLE" };
  }
  if (!isRetryScope(scope) || !retryScopes(task.kind, params, task.result, task.status).includes(scope)) {
    return { refuse: "TASK_NOT_RETRYABLE" };
  }
  const out = fanoutOutcome(task.kind, params, task.result, task.status);
  const subset = out && retryParamsFor(task.kind, params, scope === "failed" ? out.failedIds : out.unreachedIds);
  return subset ? { ok: subset } : { refuse: "TASK_NOT_RETRYABLE" };
}
