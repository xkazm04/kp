import { NextResponse } from "next/server";
// Slices, not the `./db` barrel — see the note in app/_lib/llm-config.ts. This
// route returns 0.2 KB, but through the barrel its first-hit compile was the whole
// data layer.
import { getSeedHealth, ensureDb } from "@/app/_lib/db/core";
import { coreTableCounts, countActiveTasks } from "@/app/_lib/db/tasks";
import { engineAvailability } from "@/app/_lib/engine-preflight";
import { schedulerLiveness, schedulerLivenessReason } from "@/app/_lib/scheduler-health";


// Readiness probe: confirms the DB opens, seeds loaded cleanly, and reports the
// task queue depth. Returns 200 when healthy, 503 when degraded — so a deploy
// check / uptime monitor can gate on a real signal instead of just "the process
// is up". Read-only: it reports orphaned tasks rather than mutating them.
export async function GET() {
  const degradedReasons: string[] = [];

  let seedOk = true;
  let tables: Record<string, number> = {};
  let queue = { running: 0, queued: 0 };
  let clock: ReturnType<typeof schedulerLiveness> = "stalled";
  try {
    const seed = getSeedHealth();
    seedOk = seed.ok;
    for (const issue of seed.issues) {
      if (issue.severity === "error") degradedReasons.push(`seed:${issue.seed} ${issue.reason} (${issue.path})`);
    }
    tables = coreTableCounts();
    queue = countActiveTasks();
    if ((tables.jobs ?? 0) === 0) degradedReasons.push("job catalog is empty");

    // Scheduler LIVENESS (bug-ui-scan-2026-07-09 #1): a single indexed read of the
    // clock heartbeat, judged by age. A wedged automation clock now degrades the
    // probe (503) instead of hiding behind a green dot — and the reason names it.
    const beat = ensureDb()
      .prepare(`SELECT last_tick_at FROM scheduler_heartbeat WHERE id = 'clock'`)
      .get() as { last_tick_at?: string } | undefined;
    const lastTickAt = beat?.last_tick_at ?? null;
    clock = schedulerLiveness(Date.now(), lastTickAt ? Date.parse(lastTickAt) : null, process.uptime() * 1000);
    const clockReason = schedulerLivenessReason(clock, lastTickAt);
    if (clockReason) degradedReasons.push(clockReason);
  } catch (error) {
    // DB failed to open/seed — the hardest failure; report it and bail to 503.
    return NextResponse.json(
      { ok: false, db: "unavailable", error: error instanceof Error ? error.message : String(error) },
      { status: 503 }
    );
  }

  const ok = degradedReasons.length === 0;
  return NextResponse.json(
    {
      ok,
      db: "ok",
      seeds: seedOk ? "ok" : "degraded",
      // Named sub-check so the response says WHICH thing is broken, not just "unhealthy".
      clock,
      tables,
      queue,
      degradedReasons,
      // DATA4 — informational, never a degradedReason: a missing Claude CLI is
      // a designed fallback mode, and a missing Gemini key may be intentional
      // in a demo sandbox; 503-ing on either would block deploys that mean it.
      engines: engineAvailability(),
    },
    { status: ok ? 200 : 503 }
  );
}
