import { NextResponse } from "next/server";
// Slices, not the `./db` barrel — see the note in app/_lib/llm-config.ts. This
// route returns 0.2 KB, but through the barrel its first-hit compile was the whole
// data layer.
import { getSeedHealth, ensureDb } from "@/app/_lib/db/core";
import { coreTableCounts, countActiveTasks } from "@/app/_lib/db/tasks";
import { engineAvailability } from "@/app/_lib/engine-preflight";
import { isOperator } from "@/app/_lib/auth/require-operator";
import { schedulerLiveness, schedulerLivenessReason } from "@/app/_lib/scheduler-health";


// Readiness probe: confirms the DB opens, seeds loaded cleanly, and reports the
// task queue depth. Returns 200 when healthy, 503 when degraded — so a deploy
// check / uptime monitor can gate on a real signal instead of just "the process
// is up". Read-only: it reports orphaned tasks rather than mutating them.
//
// PUBLIC (public-routes.ts PUBLIC_API_EXACT), so the payload is SPLIT. The verdict
// — ok / db / seeds / clock / engines and the status code — is what an uptime
// monitor with no cookie needs, and it carries no tenant or host detail. The
// DETAIL is not: `tables` is coreTableCounts(), a deployment-wide
// `SELECT COUNT(*)` over jobs/profiles/pipeline_entries/analyses/tasks, `queue`
// counts every tenant's runs, and a seed failure spells out an absolute server
// filesystem path. /api/ops gates that exact payload behind requireOperator()
// precisely so a caller cannot read off how many candidates and analyses the box
// holds — but this route was handing the same numbers to callers with NO session
// at all. So the detail now rides the same gate.
//
// isOperator() is TRUE in open dev (no KP_OPERATOR_PASSWORD) and for any valid
// non-demo session, so local dev, the UAT preflight and the signed-in shell
// (useEngineAvailability) see exactly what they saw before; only the anonymous
// caller on a password-protected deploy loses the detail.
export async function GET() {
  const trusted = await isOperator();
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
    // DB failed to open/seed — the hardest failure; report it and bail to 503. The
    // driver's message quotes the database FILE PATH, so an untrusted caller gets the
    // verdict and the server log keeps the detail (the safeJsonError doctrine).
    console.error("[api/health] database unavailable", error);
    return NextResponse.json(
      {
        ok: false,
        db: "unavailable",
        ...(trusted ? { error: error instanceof Error ? error.message : String(error) } : {}),
      },
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
      // DATA4 — informational, never a degradedReason: a missing Claude CLI is
      // a designed fallback mode, and a missing Gemini key may be intentional
      // in a demo sandbox; 503-ing on either would block deploys that mean it.
      engines: engineAvailability(),
      // Host/tenant detail — operator only (see the header). OMITTED rather than
      // blanked for an untrusted caller: an empty `degradedReasons` beside a 503
      // would be a confident lie about a probe that DID find reasons.
      ...(trusted ? { tables, queue, degradedReasons } : {}),
    },
    { status: ok ? 200 : 503 }
  );
}
