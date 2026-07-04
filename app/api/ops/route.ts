import { NextResponse } from "next/server";
import { getSeedHealth, coreTableCounts, countActiveTasks, promptCacheStats } from "@/app/_lib/db";
import { engineAvailability } from "@/app/_lib/engine-preflight";
import { analyzeTelemetry, commsTelemetry, engineTelemetry } from "@/app/_lib/ops-telemetry";
import { getScheduleNoSlotsCount, getScheduleReconcileCount } from "@/app/_lib/logger";


// DATA2 — the operator's read of everything the app records and nothing read:
// the /api/health readiness signals, engine preflight (DATA4), prompt-cache
// size + expired backlog, cache hit-rate and durations from a bounded tail of
// analyze.log, Gemini token spend + per-stage timings from pipeline.log,
// comms dead-letters, and the in-process schedule counters. Read-only.
//
// Unlike /api/health this always answers 200 with the payload — it is a
// dashboard read, not a readiness probe; `ok`/`degradedReasons` carry the
// health verdict inside the body.
export async function GET() {
  try {
    const degradedReasons: string[] = [];
    const seed = getSeedHealth();
    for (const issue of seed.issues) {
      if (issue.severity === "error") degradedReasons.push(`seed:${issue.seed} ${issue.reason} (${issue.path})`);
    }
    const tables = coreTableCounts();
    const queue = countActiveTasks();
    if ((tables.jobs ?? 0) === 0) degradedReasons.push("job catalog is empty");

    return NextResponse.json({
      ok: degradedReasons.length === 0,
      seeds: seed.ok ? "ok" : "degraded",
      degradedReasons,
      tables,
      queue,
      engines: engineAvailability(),
      promptCache: promptCacheStats(),
      analyze: analyzeTelemetry(),
      engine: engineTelemetry(),
      comms: commsTelemetry(),
      schedule: {
        reconcileFailures: getScheduleReconcileCount(),
        noSlotStalls: getScheduleNoSlotsCount(),
      },
    });
  } catch (error) {
    console.error("[api/ops] failed to build the ops payload", error);
    const message = error instanceof Error ? error.message : "Failed to load system status.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
