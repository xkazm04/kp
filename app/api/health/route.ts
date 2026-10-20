import { NextResponse } from "next/server";
// Slices, not the `./db` barrel — see the note in app/_lib/llm-config.ts. This
// route returns 0.2 KB, but through the barrel its first-hit compile was the whole
// data layer.
import { coreTableCounts, countActiveTasks } from "@/app/_lib/db/tasks";
import { engineAvailability } from "@/app/_lib/engine-preflight";
import { isHomeOrgReader, isOperator } from "@/app/_lib/auth/require-operator";
import { collectReadiness, type ReadinessReport } from "@/app/_lib/readiness";
import { getDecisionConfigHealth } from "@/app/_lib/decision-config-store";


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
// were run on every anonymous hit and then dropped on the floor. The only catalog
// fact the verdict can still depend on — is the catalog empty BECAUSE its seed
// failed — is read as a single `LIMIT 1` existence probe, and only when a failed
// jobs seed makes that question meaningful, so the ordinary untrusted hit now costs
// no catalog query at all.
//
// AN EMPTY CATALOG IS NOT A DEGRADED DEPLOYMENT. This probe used to answer 503 to an
// uptime monitor because nobody had created a job yet — a brand-new install paging
// its operator for being brand new. The line between "empty" and "broken" is drawn
// once, identically here and in /api/ops, and the reasoning is written out there:
// only an empty catalog whose jobs SEED errored is a fault. `catalog` reports the
// ordinary state as a fact, and rides the operator gate with `tables` rather than the
// public verdict — "this deployment holds zero jobs" is business volume, which is the
// exact class of fact this route stopped handing to anonymous callers.
//
// TWO TIERS since challenge r03 (platform-auth-api/A). `trusted` above meant
// isOperator(), i.e. "signed in and not demo", which a member of ANY org satisfies,
// and a signup-enabled deployment makes every registrant the owner of a fresh org.
// `engines` is the signed-in shell's own business (useEngineAvailability) and stays
// on isOperator(). Everything deployment-wide (tables, queue, catalog, the reasons
// that name workspace ids and host paths, configIssues, and the raw DB error) moves
// to `hostDetail`: the install's HOME org (require-operator.ts homeOrgReader), the
// same gate /api/ops and the llm_usage routes answer on. Single-org installs are
// unchanged; app/api/deployment-read-gate.test.ts keeps a new reader from skipping it.
export async function GET() {
  const trusted = await isOperator();
  const hostDetail = trusted && (await isHomeOrgReader());
  let tables: Record<string, number> = {};
  let queue = { running: 0, queued: 0 };
  let catalogEmpty = false;
  let configIssues: ReturnType<typeof getDecisionConfigHealth>["issues"] = [];
  let readiness: ReadinessReport;
  try {
    if (hostDetail) {
      tables = coreTableCounts();
      queue = countActiveTasks();
      catalogEmpty = (tables.jobs ?? 0) === 0;
    }
    // Every readiness check runs ONCE, in app/_lib/readiness.ts, the module /api/ops
    // calls too (the two inline copies had already drifted: only ops checked the
    // public origin). The one catalog question that can still change the verdict (see
    // the header) is asked there, and only when the jobs seed ERRORED: an untrusted
    // caller never sees the counts, so it gets a single `LIMIT 1` existence probe
    // instead of seven COUNT(*)s, and the ordinary hit costs no catalog query at all.
    //
    // Decision-config health (/perfect wave 41): an unreadable stored row falls back to
    // the CODE DEFAULT, so that workspace's auto-reject rules are NOT in force while its
    // settings panel renders the shipped defaults. The reason names a WORKSPACE ID, so
    // it rides the detail tier; the VERDICT (`config` plus the status code) stays public
    // like `seeds`: a monitor is told which sub-check failed, never whose tenant it was.
    //
    // Scheduler LIVENESS (bug-ui-scan-2026-07-09 #1): a wedged automation clock degrades
    // the probe (503) instead of hiding behind a green dot, and the reason names it.
    //
    // `probeReasons` is exactly the set this probe has always gated on. The public-origin
    // check reaches the DETAIL as a coded warn finding and never the status code:
    // onboarding pins GET /api/health -> 200 as its boot contract, and a keyless dev box
    // has no APP_BASE_URL.
    readiness = collectReadiness(hostDetail ? { catalogEmpty: () => catalogEmpty } : {});
    configIssues = getDecisionConfigHealth().issues;
  } catch (error) {
    // DB failed to open/seed — the hardest failure; report it and bail to 503. The
    // driver's message quotes the database FILE PATH, so an untrusted caller gets the
    // verdict and the server log keeps the detail (the safeJsonError doctrine).
    console.error("[api/health] database unavailable", error);
    return NextResponse.json(
      {
        ok: false,
        db: "unavailable",
        ...(hostDetail ? { error: error instanceof Error ? error.message : String(error) } : {}),
      },
      { status: 503 }
    );
  }

  const degradedReasons = readiness.probeReasons;
  const ok = degradedReasons.length === 0;
  return NextResponse.json(
    {
      ok,
      db: "ok",
      seeds: readiness.seedOk ? "ok" : "degraded",
      config: readiness.configOk ? "ok" : "degraded",
      // Named sub-check so the response says WHICH thing is broken, not just "unhealthy".
      clock: readiness.clock,
      // Host/tenant detail — operator only (see the header). OMITTED rather than
      // blanked for an untrusted caller: an empty `degradedReasons` beside a 503
      // would be a confident lie about a probe that DID find reasons.
      //
      // DATA4 `engines` is informational and never a degradedReason (a missing
      // Claude CLI is a designed fallback mode), but it is also secret-presence,
      // so it sits behind the same gate as the counts.
      // `catalog` is a STATE, not a verdict, and it rides the same gate as `tables`
      // for the same reason: an empty catalog is what a new install looks like, and
      // how much business a deployment holds is not a public readiness fact.
      ...(trusted ? { engines: engineAvailability() } : {}),
      ...(hostDetail
        ? {
            tables,
            queue,
            catalog: catalogEmpty ? "empty" : "ok",
            degradedReasons,
            // Coded findings (app/_lib/readiness.ts): the same facts as the reasons, plus
            // the origin warning the probe does not gate on, each with its remedy.
            findings: readiness.findings,
            configIssues,
          }
        : {}),
    },
    { status: ok ? 200 : 503 }
  );
}
