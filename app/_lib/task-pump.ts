// The background runner's SCHEDULING decision, extracted from tasks.ts so the one
// piece of it with real branching is pure and testable without a DB, a timer or a
// live queue.
//
// Why it exists at all: the pump used to be `while (running < MAX_CONCURRENT)
// queue.shift()` — strict FIFO over a PROCESS-GLOBAL slot count. On a single-tenant
// install that is right. On any multi-tenant one it is a starvation bug: team A
// submitting two long analyses (each minutes of LLM time) takes BOTH slots, and
// team B's click sits behind them however long they take. Nothing in the runner ever
// read the workspace the task row carries, even though startTask has stamped it for
// two waves and the comment above it names "the reservation gate that counts
// in-flight runs" — a gate that did not exist.
//
// The rule here is the cheapest one that fixes it without inventing per-tenant
// quotas: among the queued tasks, run the one whose workspace currently holds the
// FEWEST running slots, breaking ties by queue position. Consequences, all of them
// intended:
//   - one tenant alone in the queue is unaffected (every candidate ties at its own
//     count, so the tie-break makes it plain FIFO — the single-tenant path is
//     byte-identical in behaviour);
//   - with MAX_CONCURRENT = 2 it is exactly the "cap one workspace at
//     MAX_CONCURRENT - 1 while another waits" reservation: A can never hold both
//     slots while B has anything queued;
//   - it never idles a slot to hold it for a tenant that has not asked (unlike a
//     fixed per-tenant reservation), because the pick is made over what is queued
//     NOW, not over the tenant list.
//
// FIFO inside a workspace is preserved: candidates from one workspace always tie on
// count, so the earliest-enqueued of them wins the tie-break.

/** The queue entry the pump reasons about: a task id and the tenant that enqueued it. */
export type PumpEntry = {
  id: string;
  workspaceId: string;
};

/**
 * Index into `queue` of the task to start next, or `null` when nothing may start.
 *
 * @param queue              queued tasks in submission order (FIFO within a tenant).
 * @param runningWorkspaces  the workspace of every task running RIGHT NOW, one entry
 *                           per in-flight task (so a tenant running two tasks appears
 *                           twice). Duplicates are what make this a fairness count.
 * @param maxConcurrent      the process-wide slot ceiling.
 */
export function nextTaskToRun(
  queue: readonly PumpEntry[],
  runningWorkspaces: readonly string[],
  maxConcurrent: number
): number | null {
  if (queue.length === 0) return null;
  if (runningWorkspaces.length >= maxConcurrent) return null;

  const load = new Map<string, number>();
  for (const ws of runningWorkspaces) load.set(ws, (load.get(ws) ?? 0) + 1);

  let bestIndex = 0;
  let bestLoad = load.get(queue[0].workspaceId) ?? 0;
  for (let i = 1; i < queue.length; i += 1) {
    // Strictly less-than, so a tie keeps the earlier entry: FIFO survives inside a
    // workspace, and across workspaces the first-queued of the equally-idle ones wins.
    const l = load.get(queue[i].workspaceId) ?? 0;
    if (l < bestLoad) {
      bestIndex = i;
      bestLoad = l;
      if (bestLoad === 0) break; // nothing can beat an idle tenant; stop scanning
    }
  }
  return bestIndex;
}
