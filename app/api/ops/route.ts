import { NextResponse } from "next/server";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { promptCacheStats } from "@/app/_lib/db/analyses";
import { getSeedHealth, ensureDb } from "@/app/_lib/db/core";
import { coreTableCounts, countActiveTasks } from "@/app/_lib/db/tasks";
import { engineAvailability } from "@/app/_lib/engine-preflight";
import { analyzeTelemetry, commsTelemetry, engineTelemetry } from "@/app/_lib/ops-telemetry";
import { getScheduleNoSlotsCount, getScheduleReconcileCount } from "@/app/_lib/logger";
import { schedulerLiveness, schedulerLivenessReason } from "@/app/_lib/scheduler-health";


// DATA2 — the operator's read of everything the app records and nothing read:
// the /api/health readiness signals, engine preflight (DATA4), prompt-cache
// size + expired backlog, cache hit-rate and durations from a bounded tail of
// analyze.log, Gemini token spend + per-stage timings from pipeline.log,
// comms dead-letters, and the in-process schedule counters. Read-only.
//
// Unlike /api/health this always answers 200 with the payload — it is a
// dashboard read, not a readiness probe; `ok`/`degradedReasons` carry the
// health verdict inside the body.
//
// OPERATOR-GATED (the /api/brand split: open read where the data is harmless,
// gated where it isn't — here it isn't). Everything below is DEPLOYMENT-wide by
// design and stays that way: coreTableCounts() runs an unscoped
// `SELECT COUNT(*)` over jobs/profiles/pipeline_entries/analyses/tasks, the
// queue counts every tenant's runs, and the telemetry tails one shared log set.
// That is correct for a host-operator read and wrong for a tenant one — ungated,
// any signed-in member of ANY workspace, plus the anonymous /api/demo visitor,
// could read off the System strip how many candidates and analyses every other
// team on the box has. So the counts stay global; the caller now has to earn
// them. Not a tenancy fix (there is nothing here to scope) — an authz one.
//
// Callers already treat a non-200 as "no telemetry" rather than an error
// (useSpendData drops the engine lines), so a demo session loses the strip
// instead of seeing a failure it can do nothing about.
export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const degradedReasons: string[] = [];
    const seed = getSeedHealth();
    for (const issue of seed.issues) {
      if (issue.severity === "error") degradedReasons.push(`seed:${issue.seed} ${issue.reason} (${issue.path})`);
    }
    const tables = coreTableCounts();
    const queue = countActiveTasks();
    if ((tables.jobs ?? 0) === 0) degradedReasons.push("job catalog is empty");

    // Scheduler LIVENESS (bug-ui-scan-2026-07-09 #1): a single indexed read of the
    // clock heartbeat, judged by age. This is the surface SystemCard's "Healthy"
    // dot reads, so a wedged automation clock now flips that dot to Degraded and
    // adds a named reason — the green dot can no longer lie about a dead clock.
    const beat = ensureDb()
      .prepare(`SELECT last_tick_at FROM scheduler_heartbeat WHERE id = 'clock'`)
      .get() as { last_tick_at?: string } | undefined;
    const lastTickAt = beat?.last_tick_at ?? null;
    const clock = schedulerLiveness(Date.now(), lastTickAt ? Date.parse(lastTickAt) : null, process.uptime() * 1000);
    const clockReason = schedulerLivenessReason(clock, lastTickAt);
    if (clockReason) degradedReasons.push(clockReason);

    return NextResponse.json({
      ok: degradedReasons.length === 0,
      seeds: seed.ok ? "ok" : "degraded",
      // Named sub-check so the panel says WHICH thing is broken, not just "unhealthy".
      clock,
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
