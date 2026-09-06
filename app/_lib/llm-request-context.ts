// The ambient "which run is this LLM call part of" id, carried across async
// boundaries by AsyncLocalStorage.
//
// Why not a parameter: the usage ledger's `request_id` column has existed since
// T0.1 and parseLedgerLine already maps it — but nothing ever set it, so every
// Activity row landed with a null. Filling it means the id has to reach
// spawnPython, and spawnPython is called from ~20 modules (analyze-run,
// automation-run, jd-build-run, group-eval-run, devcase-run, campaign-run …),
// most of them several frames below the task runner. Threading a `requestId`
// argument through all of them — and through every helper in between — would be
// a wide, churn-heavy diff whose only job is to move one string, and any call
// site that forgot to forward it would silently go back to writing nulls.
//
// AsyncLocalStorage keeps the plumbing at the two ends that actually care: the
// task runner opens a scope around its handler (app/_lib/tasks.ts), and
// spawnPython reads it when it builds the child env. Everything in between stays
// untouched and cannot forget to forward anything.
//
// Node-only (`node:async_hooks`), which is fine: both ends are server-side —
// spawnPython forks a child process and the task runner is an in-process queue.
// Outside a scope (a route that spawns Python directly, a CLI, a unit test)
// currentLlmRequestId() returns null and the ledger row keeps its historical
// null request_id — the degraded case, not an error.
import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<string>();

/**
 * Run `fn` with `requestId` as the ambient LLM request id. Every spawnPython call
 * made inside it — at any async depth — tags its metered calls with this id.
 */
export function withLlmRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run(requestId, fn);
}

/** The ambient LLM request id, or null when the caller is outside any scope. */
export function currentLlmRequestId(): string | null {
  return storage.getStore() ?? null;
}

/**
 * Run `fn` under `requestId` ONLY when no scope is open, and under the existing
 * one when there is.
 *
 * The difference matters at exactly one seam. A companion turn names itself
 * (`companion:<threadId>:<turnId>`) because nothing else does — the message
 * route is not a task. The SAME code also runs inside the digest task, where the
 * runner has already opened a scope with the task id, and that id is the one the
 * Activity detail can resolve against `/api/tasks/[id]`. `withLlmRequestId` would
 * shadow it and the row would point at a run nobody can open, which is the whole
 * bug this exists to prevent. Outermost wins: the caller that owns a durable,
 * fetchable record of the run is the one that names it.
 */
export function withLlmRequestIdIfUnset<T>(requestId: string, fn: () => T): T {
  const open = storage.getStore();
  return open ? fn() : storage.run(requestId, fn);
}
