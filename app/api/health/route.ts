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
// — ok / db / seeds / clock and the status code — is what an uptime
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
//
// `engines` RIDES THE SAME GATE (/perfect wave 17, api-workspace). It was blessed
// as public on the grounds that the shell and the demo read it — but the shell IS
// trusted and the map is SECRET-PRESENCE: it says whether this box has a Gemini
// key configured and whether a `claude` CLI (a shell-capable local binary) is
// installed. That is reconnaissance — which provider's credential is worth going
// after, and whether the LLM path here is a local process rather than a cloud call
// — and no uptime monitor needs it. The verdict a monitor DOES need (ok/db/seeds/
// clock + the status code) is unchanged, so nothing that gates on this probe moves.
//
// The detail is also no longer COMPUTED for an untrusted caller. `coreTableCounts()`
// is five unscoped `SELECT COUNT(*)`s and `countActiveTasks()` two more; all seven
// were run on every anonymous hit and then dropped on the floor. Only the one fact
// the PUBLIC verdict depends on — is the job catalog empty — is still read, as a
// single `LIMIT 1` existence probe, so the untrusted response is byte-identical to
// what it was on this line and costs one query instead of seven.
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
    let jobsEmpty: boolean;
    if (trusted) {
      tables = coreTableCounts();
      queue = countActiveTasks();
      jobsEmpty = (tables.jobs ?? 0) === 0;
    } else {
      // Same verdict, one query: an untrusted caller never sees the counts, so
      // counting is pure waste — existence is the whole question.
      jobsEmpty = ensureDb().prepare(`SELECT 1 AS n FROM jobs LIMIT 1 -- tenancy:global`).get() === undefined;
    }
    if (jobsEmpty) degradedReasons.push("job catalog is empty");

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
      // Host/tenant detail — operator only (see the header). OMITTED rather than
      // blanked for an untrusted caller: an empty `degradedReasons` beside a 503
      // would be a confident lie about a probe that DID find reasons.
      //
      // DATA4 `engines` is informational and never a degradedReason (a missing
      // Claude CLI is a designed fallback mode), but it is also secret-presence,
      // so it sits behind the same gate as the counts.
      ...(trusted ? { engines: engineAvailability(), tables, queue, degradedReasons } : {}),
    },
    { status: ok ? 200 : 503 }
  );
}
