// Where the line between "empty" and "BROKEN" sits, for both routes at once.
//
// `/api/health` and `/api/ops` used to push "job catalog is empty" into
// degradedReasons whenever the jobs table had no rows. Two genuinely different
// conditions therefore shared one verdict:
//
//   * a catalog nobody has filled yet — the ordinary opening state of every
//     install, and the DECLARED state of a KP_EMPTY=1 tenant. The billing tab's
//     engine strip rendered a red dot and the word "Degraded" as the first thing
//     a first-run operator read, and /api/health answered an uptime monitor 503,
//     because nobody had created a job yet;
//   * a catalog that is empty because its SEED failed to load — a real fault, the
//     one `JOB_SEED_BROKEN` in app/_lib/api-response.ts already names.
//
// The line is severity "error", the same one `/api/jobs` already draws for
// JOB_SEED_BROKEN — a seed file that is merely ABSENT is a supported install, not
// a break. This file proves the BROKEN half end to end, on both routes, because
// that is the half a regression would silently delete: the healthy half fails
// loudly (a red "Degraded" on a new install) while a lost fault signal fails
// silently. The healthy half is pinned in ops-route.test.ts and
// health-exposure.test.ts, which run against loadable seeds.
//
// HOW THE FAILURE IS FORCED, without touching the repo's own seed files: seed
// paths in db/core.ts are `path.join(process.cwd(), "data", …)` resolved at MODULE
// EVALUATION time, so this file chdir's into a throwaway directory holding an
// unparseable `data/seed_jobs/jobs.normalized.json` BEFORE the routes (and through
// them, db/core) are first imported. Seeding then records a real severity:"error"
// issue against a file nothing else in the tree can see.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
//   node scripts/run-unit-tests.mjs "app/api/health/seed-catalog-verdict.test.ts"
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { register } from "node:module";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";

register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// No KP_OPERATOR_PASSWORD (unit-db clears it) → open mode → isOperator() is true
// without ever reading a cookie, so both routes answer their full payload here.
// KP_EMPTY would skip seeding entirely, which is the opposite of what this proves.
delete process.env.KP_EMPTY;

const CWD = process.cwd();
const FAKE_ROOT = mkdtempSync(path.join(tmpdir(), "kp-broken-seed-"));
mkdirSync(path.join(FAKE_ROOT, "data", "seed_jobs"), { recursive: true });
writeFileSync(path.join(FAKE_ROOT, "data", "seed_jobs", "jobs.normalized.json"), "{not json", "utf8");
process.chdir(FAKE_ROOT);

// Imported AFTER the chdir — db/core resolves its seed paths on first evaluation.
const { GET: healthGET } = await import("./route.ts");
const { GET: opsGET } = await import("../ops/route.ts");

after(() => {
  process.chdir(CWD);
  cleanupUnitDb();
  try {
    rmSync(FAKE_ROOT, { recursive: true, force: true });
  } catch {
    /* best-effort: a throwaway dir under the OS temp root, swept by the OS if a handle lingers */
  }
});

type Body = { ok?: boolean; catalog?: string; seeds?: string; degradedReasons?: string[] };
const CATALOG_REASON = "job catalog is empty because its seed data failed to load";

test("the seed really did fail to load in this process", async () => {
  const { getSeedHealth } = await import("../../_lib/db/core.ts");
  const health = getSeedHealth();
  assert.ok(
    health.issues.some((i) => i.seed === "jobs" && i.severity === "error"),
    `the fixture must produce a severity:"error" jobs issue, else the rest of this file proves nothing — got ${JSON.stringify(health.issues)}`
  );
});

test("/api/health: an empty catalog whose seed FAILED still degrades the probe", async () => {
  const response = await healthGET();
  const body = (await response.json()) as Body;
  assert.equal(response.status, 503, "a monitor must still be paged for a seed that would not load");
  assert.equal(body.ok, false);
  assert.equal(body.catalog, "empty");
  assert.ok(
    body.degradedReasons?.includes(CATALOG_REASON),
    `the reason must name the CAUSE, not just the emptiness — got ${JSON.stringify(body.degradedReasons)}`
  );
  assert.ok(
    body.degradedReasons?.some((r) => r.startsWith("seed:jobs ")),
    "and the seed report's own line, which carries the failing path, is unchanged"
  );
});

test("/api/ops: the operator strip is told the same thing", async () => {
  const body = (await (await opsGET()).json()) as Body;
  assert.equal(body.ok, false, "the strip's first dot stays red for a fault");
  assert.equal(body.seeds, "degraded");
  assert.equal(body.catalog, "empty");
  assert.ok(
    body.degradedReasons?.includes(CATALOG_REASON),
    `the two routes must never disagree about whether this catalog is broken — got ${JSON.stringify(body.degradedReasons)}`
  );
});
