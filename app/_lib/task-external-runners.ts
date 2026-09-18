// Late-bound task runners — the seam that keeps a heavy task's implementation OFF
// the import graph of every route that touches app/_lib/tasks.ts.
//
// tasks.ts is a hub: ~60 routes import it to start or poll a task, so every module
// it reaches (statically OR through `import()` — the perf budget counts both) is
// paid by all of them on first hit. The job-seeker scan reaches the whole acquisition
// graph (twelve source adapters, the rules engine on linkedom, reconciliation), which
// took the `app/api/**/route.ts` group from 217 to 272 modules when tasks.ts imported
// it directly (measured 2026-09-16, scripts/perf/check-budget.mjs).
//
// So a kind whose implementation is large registers its runner at BOOT from
// instrumentation-node.ts — which is not on any route's path — and tasks.ts only
// holds this registry. Nothing here imports anything; the module is a leaf.
//
// The kinds on this seam: `jobseeker_scan`, and — since 2026-09-18 — `interview_kit`
// and `interview_letter`. The two interview runners put the kit validator, the letter
// template/policy and their stores on tasks.ts's path, +7 modules on every route that
// starts or polls a task. The registrations themselves live in late-bound-boot.ts, the
// one list instrumentation-node.ts calls at boot and the unit-test DB bootstrap calls
// too, so a test exercises the same wiring the server runs.
//
// Contract: a spec in tasks.ts that delegates to `externalRunner(kind)` still declares
// its own `tenancy` and still passes `ctx` (the pump test reads the spec text). An
// unregistered kind is a boot-order bug, answered with a thrown error the task
// runner records as a failed task — never a silent no-op.

export type ExternalTaskCtx = {
  workspaceId: string;
  signal: AbortSignal;
  progress: (done: number, total: number, msg?: string) => void;
  /** The task row's params, exactly as tasks.ts hands them to an in-module spec
   *  (CLIENT-SUPPLIED through POST /api/tasks — a runner validates what it reads). */
  params: Record<string, unknown>;
};

export type ExternalTaskRunner = (ctx: ExternalTaskCtx) => Promise<unknown>;

// The map lives on globalThis, not in module scope. Next bundles instrumentation-node.ts
// and the route handlers separately, so in `next start` this module is evaluated TWICE:
// once in the instrumentation chunk that registers, once in the route chunk that reads.
// A module-level Map is two Maps, and the first manual scan failed with "not registered"
// (smoke, 2026-09-16) although boot had registered it. Same shape as core.ts's __kpDb.
const REGISTRY_KEY = "__kpTaskRunners";
const holder = globalThis as typeof globalThis & { [REGISTRY_KEY]?: Map<string, ExternalTaskRunner> };
const runners: Map<string, ExternalTaskRunner> = holder[REGISTRY_KEY] ?? (holder[REGISTRY_KEY] = new Map());

/** Boot-time registration (instrumentation-node.ts). Re-registering replaces — the dev
 *  server re-runs instrumentation on reload and must not throw on the second pass. */
export function registerTaskRunner(kind: string, run: ExternalTaskRunner): void {
  runners.set(kind, run);
}

/** The runner for `kind`, or a thrown error naming the missing registration. */
export function externalRunner(kind: string): ExternalTaskRunner {
  const run = runners.get(kind);
  if (!run) {
    throw new Error(`task runner for "${kind}" is not registered — instrumentation-node.ts registers it at boot`);
  }
  return run;
}

/** For tests: forget every registration. */
export function _resetTaskRunnersForTests(): void {
  runners.clear();
}
