import { NextResponse } from "next/server";
import { safeJsonError } from "@/app/_lib/api-response";
import { requireHomeOrgReader } from "@/app/_lib/auth/require-operator";
import { promptCacheStats } from "@/app/_lib/db/analyses";
import { aggregateLlmUsage } from "@/app/_lib/db/llm";
import { coreTableCounts, countActiveTasks } from "@/app/_lib/db/tasks";
import { engineAvailability } from "@/app/_lib/engine-preflight";
import { analyzeTelemetry, commsTelemetry, engineTelemetry, tailJsonl } from "@/app/_lib/ops-telemetry";
import { getScheduleNoSlotsCount, getScheduleReconcileCount } from "@/app/_lib/logger";
import { collectReadiness } from "@/app/_lib/readiness";
import { getDecisionConfigHealth } from "@/app/_lib/decision-config-store";
import { getAfterResponseFailureCount } from "@/app/_lib/after-response";
import { rateLimitRefusalStats } from "@/app/_lib/rate-limit";


// DATA2 — the operator's read of everything the app records and nothing read:
// the /api/health readiness signals, engine preflight (DATA4), prompt-cache
// size + expired backlog, cache hit-rate and durations from a bounded tail of
// analyze.log, all-provider tokens from llm_usage + per-stage timings from pipeline.log,
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
// "Earn" means HOME ORG (challenge r03 platform-auth-api/A). requireOperator() alone
// said yes to any signed-in member of ANY org, and a signup-enabled deployment makes
// every registrant the owner of a fresh org, so the sentence above was not yet true.
// requireHomeOrgReader() keeps the 401 for no session / demo and answers a coded 403
// (FORBIDDEN_CAPABILITY, capability "deployment:read") to a member of another org;
// the password operator, open dev and every home-org seat read exactly as before.
//
// Callers already treat a non-200 as "no telemetry" rather than an error
// (useSpendData drops the engine lines), so a demo session loses the strip
// instead of seeing a failure it can do nothing about.
export async function GET() {
  const denied = await requireHomeOrgReader();
  if (denied) return denied;
  try {
    const tables = coreTableCounts();
    const queue = countActiveTasks();

    // An empty job catalog is TWO conditions wearing ONE verdict, and only one of
    // them is a fault. "Nobody has written a role yet" is the ordinary opening
    // state of every install — and the DECLARED state of a KP_EMPTY=1 tenant
    // (db/seed-gate.ts) — so pushing it into degradedReasons told a first-run
    // operator, in red, that their deployment was degraded because it was new.
    // "The catalog is empty because its SEED failed to load" is a different thing
    // entirely: a fault someone has to go and fix.
    //
    // The honest signal for the second one already exists in getSeedHealth(), and
    // /api/jobs already draws exactly this line for JOB_SEED_BROKEN
    // (app/api/jobs/route.ts): severity "error", never "missing" — a seed file that
    // is simply absent is a supported install (a self-hosted box that ships no demo
    // corpus), not a break. app/_lib/readiness.ts applies that rule for both this
    // route and /api/health, so the two surfaces cannot disagree about whether the
    // same catalog is broken.
    //
    // `catalog` carries the ordinary state instead, as a fact rather than a
    // verdict, so the strip can say "no jobs yet" without saying "degraded".
    const catalogEmpty = (tables.jobs ?? 0) === 0;

    // Every readiness check (public origin, seeds, catalog-seed, decision-config,
    // scheduler liveness) runs ONCE, in app/_lib/readiness.ts, which /api/health
    // calls too — the two inline copies had already drifted (only this route
    // checked the origin). This route is home-org gated in full, so it carries the
    // DETAIL: the legacy `degradedReasons` strings (unchanged, and still what `ok`
    // is judged on) and the coded `findings` the System strip renders in the
    // reader's language with a fix — which phase and tier of an unreadable decision
    // config, which seed, how long the clock has been silent.
    const readiness = collectReadiness({ catalogEmpty: () => catalogEmpty });
    const degradedReasons = readiness.degradedReasons;
    const configHealth = getDecisionConfigHealth();

    return NextResponse.json({
      ok: degradedReasons.length === 0,
      seeds: readiness.seedOk ? "ok" : "degraded",
      config: readiness.configOk ? "ok" : "degraded",
      // A STATE, not a verdict (see the note above): "empty" is what a new install
      // looks like, and the strip renders it as a neutral fact.
      catalog: catalogEmpty ? "empty" : "ok",
      // Named sub-check so the panel says WHICH thing is broken, not just "unhealthy".
      clock: readiness.clock,
      degradedReasons,
      // Coded twins of `degradedReasons` (app/_lib/readiness.ts): code, severity,
      // params and remedy, so the strip can localize each and offer its fix.
      findings: readiness.findings,
      configIssues: configHealth.issues,
      tables,
      queue,
      engines: engineAvailability(),
      promptCache: promptCacheStats(),
      analyze: analyzeTelemetry(),
      engine: engineTelemetry(aggregateLlmUsage(7)),
      comms: commsTelemetry(),
      // Structured warnings were written but had no read surface. The bounded
      // tail uses the same log directory as opsLog and stays operator-only here.
      opsWarnings: tailJsonl("ops-warn.log"),
      schedule: {
        reconcileFailures: getScheduleReconcileCount(),
        noSlotStalls: getScheduleNoSlotsCount(),
      },
      afterResponseFailures: getAfterResponseFailureCount(),
      // Which door is refusing: the in-process limiter's refusals per key FAMILY (the
      // prefix before the first ':'), never a token or client address.
      rateLimitRefusals: rateLimitRefusalStats(),
    });
  } catch (error) {
    // The thrown message here is the WORST kind to forward: this payload is built
    // from better-sqlite3 (the db file path in a SQLITE_* message), the seed report
    // (absolute seed paths) and three log tails (the log directory). It answered with
    // all of it. safeJsonError logs the real error and hands back the code the System
    // strip renders through useErrorMessage in the reader's language.
    return safeJsonError(error, "api:ops", "OPS_STATUS_FAILED");
  }
}
