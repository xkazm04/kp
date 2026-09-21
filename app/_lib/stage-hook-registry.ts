// Late-bound stage-arrival hook — the seam that keeps stage-hooks.ts OFF the import
// graph of every route that touches the pipeline store.
//
// app/_lib/db/pipeline.ts is a hub: app/_lib/tasks.ts imports it, and ~200 routes
// import tasks.ts, so every module the store reaches — statically OR through
// `import()`, because the perf budget counts both (scripts/perf/check-budget.mjs) —
// is paid by all of them on first hit. stage-hooks.ts reaches the interview-invite
// door, and through it the whole voice layer (both provider adapters, failover,
// language lock, the candidate brief) plus the interview run/telemetry/transcript
// modules and three more stores: 23 modules and ~295 KB, which took the
// `app/api/**/route.ts` group from 214 to 237 modules against a 225 ceiling
// (measured 2026-09-21).
//
// So the store holds only this registry, and the implementation registers itself at
// BOOT from instrumentation-node.ts — which is not on any route's path. Same shape,
// same reason and same globalThis caveat as app/_lib/task-external-runners.ts.
// Nothing here imports anything; the module is a leaf.
//
// UNREGISTERED IS LOUD, NOT SILENT. The tasks registry throws by name because a task
// has a run record to fail. This hook is fire-and-forget by construction (see
// `notifyStageEntered` in db/pipeline.ts) and runs after a move that has already
// committed, so throwing here would turn a boot-order bug into a failed stage move.
// It logs by name instead, naming the module that was meant to register it.

export type StageEnteredNotification = {
  entryId: string;
  stage: string;
  workspaceId: string;
  actorRef?: string | null;
};

export type StageEnteredHook = (input: StageEnteredNotification) => void;

// The holder lives on globalThis, not in module scope. Next bundles
// instrumentation-node.ts and the route handlers separately, so in `next start`
// this module is evaluated TWICE: once in the instrumentation chunk that registers,
// once in the route chunk that reads. A module-level binding is two bindings — the
// lesson task-external-runners.ts records from a smoke run on 2026-09-16.
const REGISTRY_KEY = "__kpStageEnteredHook";
const holder = globalThis as typeof globalThis & { [REGISTRY_KEY]?: StageEnteredHook };

/** Boot-time registration (instrumentation-node.ts). Re-registering replaces — the
 *  dev server re-runs instrumentation on reload and must not throw on the second pass. */
export function registerStageEnteredHook(hook: StageEnteredHook): void {
  holder[REGISTRY_KEY] = hook;
}

/** Notify the registered hook that an entry now STANDS on a stage. Synchronous and
 *  never throws: the store calls it right after `tx.immediate()` has returned. */
export function notifyStageEnteredHook(input: StageEnteredNotification): void {
  const hook = holder[REGISTRY_KEY];
  if (!hook) {
    console.error(
      "[pipeline] stage-entered hook is not registered — instrumentation-node.ts registers it at boot; " +
        `arrival on "${input.stage}" for entry ${input.entryId} was not acted on`
    );
    return;
  }
  try {
    hook(input);
  } catch (error) {
    console.error("[pipeline] stage-entered hook could not be scheduled", error instanceof Error ? error.message : error);
  }
}

/** For tests: forget the registration. */
export function _resetStageEnteredHookForTests(): void {
  delete holder[REGISTRY_KEY];
}
