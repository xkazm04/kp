import { NextResponse } from "next/server";
import { getSeedHealth, coreTableCounts, countActiveTasks } from "@/app/_lib/db";

export const runtime = "nodejs";

// Readiness probe: confirms the DB opens, seeds loaded cleanly, and reports the
// task queue depth. Returns 200 when healthy, 503 when degraded — so a deploy
// check / uptime monitor can gate on a real signal instead of just "the process
// is up". Read-only: it reports orphaned tasks rather than mutating them.
export async function GET() {
  const degradedReasons: string[] = [];

  let seedOk = true;
  let tables: Record<string, number> = {};
  let queue = { running: 0, queued: 0 };
  try {
    const seed = getSeedHealth();
    seedOk = seed.ok;
    for (const issue of seed.issues) {
      if (issue.severity === "error") degradedReasons.push(`seed:${issue.seed} ${issue.reason} (${issue.path})`);
    }
    tables = coreTableCounts();
    queue = countActiveTasks();
    if ((tables.jobs ?? 0) === 0) degradedReasons.push("job catalog is empty");
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
      tables,
      queue,
      degradedReasons,
    },
    { status: ok ? 200 : 503 }
  );
}
