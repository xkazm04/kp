import { advanceRoleRun, type AdvanceOptions, type AdvanceResult, type StageRunners } from "./role-run-engine.ts";
import { producerRunners } from "./role-run-producers/index.ts";
import { roleSpecProducer } from "./role-run-producers/role-spec.ts";
import { slateProducer } from "./role-run-producers/slate.ts";
import { screenProducer } from "./role-run-producers/screen.ts";
import { getRoleRun, listRoleRuns } from "./db/role-runs.ts";
import { listWorkspaces } from "./db/workspaces.ts";
import { opsLog } from "./ops-telemetry.ts";

// THE LIVE ROLE-RUN DRIVER (ADR-0011 s1/s4, operator decision 2026-10-16: role-run stages
// call real LLMs, at least through the Claude Code CLI).
//
// The engine (role-run-engine.ts) keeps its keyless DEFAULT_STAGE_RUNNERS: that is the
// floor tests run on, and the floor a stage falls back to. THIS module is the one caller
// that composes the producer set on top of it for a live trigger - the start/advance
// routes and the clock job. Each producer degrades to the keyless floor on its own when no
// provider/CLI is installed, KP_ROLE_RUN_LLM=0 or KP_OFFLINE is set (roleRunLlmAvailable).
//
// WHAT A TRIGGER CAN NEVER DO, by construction rather than by a check here:
//   - resolve an Art. 22 gate: advanceRoleRun parks at S2/S4/S6 (`awaiting_approval`) and
//     the only door past them is commitRoleRunStageGate behind a spent approval token;
//   - exceed the per-run LLM budget: advanceRoleRun checks it before EVERY stage and parks.
//
// CONCURRENCY. One process owns the SQLite file, so a per-run single-flight map is enough
// to keep two triggers (a route call racing the clock tick) from running the same stage
// twice: the second caller is told `busy` and does nothing. (Across processes the ledger's
// legal-transition check still refuses a duplicate artifact; this keeps the LLM spend from
// being duplicated first.) The map is on globalThis so a dev-server module reload shares it.

/** The runner set the live engine uses: producers over the keyless floor. */
export function liveRoleRunRunners(): Partial<StageRunners> {
  return producerRunners([roleSpecProducer(), slateProducer(), screenProducer()]);
}

const FLIGHTS_KEY = "__kpRoleRunFlights";
type FlightMap = Map<string, Promise<unknown>>;
function flights(): FlightMap {
  const g = globalThis as unknown as Record<string, FlightMap | undefined>;
  // Invariant: the slot is only ever written here, with a Map.
  return (g[FLIGHTS_KEY] ??= new Map());
}

/** Per-pass stage ceiling for a live trigger: a slate of twenty is ~20 x 2 stages before
 *  the first gate, and a pass must stay well inside a request/tick. The next trigger
 *  resumes exactly where this one stopped. */
export const LIVE_MAX_STAGES = 60;

export type LiveAdvance =
  | { outcome: "advanced"; result: AdvanceResult }
  | { outcome: "busy" }
  | { outcome: "not_found" };

export type LiveAdvanceOptions = Pick<AdvanceOptions, "runners" | "budget" | "readUsage" | "now" | "maxStages">;

/** Advance one run of `workspaceId` by one live pass. `not_found` for an id that is not
 *  this tenant's (the engine would throw; a trigger wants a refusal it can map to 404). */
export async function advanceRoleRunLive(runId: string, workspaceId: string, opts: LiveAdvanceOptions = {}): Promise<LiveAdvance> {
  if (!getRoleRun(runId, workspaceId)) return { outcome: "not_found" };
  const key = `${workspaceId}:${runId}`;
  const map = flights();
  if (map.has(key)) return { outcome: "busy" };
  const pass = advanceRoleRun(
    runId,
    { runners: opts.runners ?? liveRoleRunRunners(), maxStages: opts.maxStages ?? LIVE_MAX_STAGES, budget: opts.budget, readUsage: opts.readUsage, now: opts.now },
    workspaceId
  );
  map.set(key, pass);
  try {
    return { outcome: "advanced", result: await pass };
  } finally {
    map.delete(key);
  }
}

export type TickSummary = { workspaces: number; runs: number; advanced: number; produced: number; busy: number; parkedOnBudget: number; failed: number };

/** The clock's pass: every `running` run in every workspace, one live pass each. Runs
 *  parked at a gate produce nothing (a no-op read); runs parked on budget stay parked.
 *  One run's failure never stops the others. */
export async function tickRoleRuns(opts: LiveAdvanceOptions = {}): Promise<TickSummary> {
  const sum: TickSummary = { workspaces: 0, runs: 0, advanced: 0, produced: 0, busy: 0, parkedOnBudget: 0, failed: 0 };
  for (const ws of listWorkspaces()) {
    const running = listRoleRuns({ limit: 200 }, ws.id).filter((r) => r.status === "running");
    if (running.length === 0) continue;
    sum.workspaces += 1;
    for (const run of running) {
      sum.runs += 1;
      try {
        const r = await advanceRoleRunLive(run.id, ws.id, opts);
        if (r.outcome === "busy") sum.busy += 1;
        if (r.outcome !== "advanced") continue;
        sum.advanced += 1;
        sum.produced += r.result.produced.length;
        if (r.result.budgetExceeded) sum.parkedOnBudget += 1;
      } catch (err) {
        sum.failed += 1;
        opsLog("warn", "role-run:tick-failed", { runId: run.id, errorName: err instanceof Error ? err.name : "unknown" });
      }
    }
  }
  return sum;
}
