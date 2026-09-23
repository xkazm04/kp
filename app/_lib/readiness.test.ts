// Challenge r03 platform-auth-api/B: readiness is computed ONCE, as coded findings.
//
// /api/health and /api/ops used to run the same seed / catalog / decision-config /
// clock checks in two inline copies, held together only by a test that existed to stop
// them disagreeing (seed-catalog-verdict.test.ts) - and they had already drifted: only
// /api/ops checked the public origin. The output was `degradedReasons: string[]`, English
// sentences the System strip printed raw. collectReadiness() now owns the checks and
// returns both faces: the legacy strings, byte-identical so no monitor or existing
// assertion moves, and `findings` {code, severity, params, remedy} that the client
// renders in the reader's language with a fix.
//
// Every source is injectable, so these cases need no seed file, no clock and no config
// row; the route suites (health-exposure, ops-route, seed-catalog-verdict) prove the
// wiring against the real sources.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import "./testing/unit-db.ts";
import {
  collectReadiness,
  isReadinessCode,
  READINESS_CODES,
  type ReadinessFinding,
  type ReadinessSources,
} from "./readiness.ts";
import { schedulerLivenessReason } from "./scheduler-health.ts";

const NOW = Date.parse("2026-09-23T12:00:00.000Z");
const FRESH_TICK = new Date(NOW - 30_000).toISOString();

/** A deployment with nothing wrong: fresh heartbeat, clean seeds, clean config. */
function healthy(over: Partial<ReadinessSources> = {}): Partial<ReadinessSources> {
  return {
    seedIssues: [],
    configIssues: [],
    lastTickAt: FRESH_TICK,
    nowMs: NOW,
    uptimeMs: 10 * 60_000,
    catalogEmpty: () => false,
    ...over,
  };
}

function find(findings: readonly ReadinessFinding[], code: string): ReadinessFinding | undefined {
  return findings.find((f) => f.code === code);
}

beforeEach(() => {
  // A configured, agreeing origin is the neutral baseline; the origin cases unset it.
  process.env.APP_BASE_URL = "https://hire.example.com";
  process.env.NEXT_PUBLIC_APP_BASE_URL = "https://hire.example.com";
});

test("the code vocabulary is closed: a literal array with a runtime guard", () => {
  assert.ok(READINESS_CODES.length >= 7);
  assert.equal(new Set(READINESS_CODES).size, READINESS_CODES.length, "no code repeats");
  for (const code of READINESS_CODES) assert.ok(isReadinessCode(code));
  assert.equal(isReadinessCode("NOT_A_CODE"), false);
  assert.equal(isReadinessCode(undefined), false);
});

test("a healthy deployment has no findings and no reasons", () => {
  const r = collectReadiness(healthy());
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.degradedReasons, []);
  assert.deepEqual(r.probeReasons, []);
  assert.equal(r.clock, "healthy");
});

test("a jobs seed error over an empty catalog is two faults, and the legacy strings are unchanged", () => {
  const path = "/srv/kp/data/seed_jobs/jobs.normalized.json";
  const r = collectReadiness(
    healthy({
      seedIssues: [{ seed: "jobs", path, reason: "failed to read/parse seed", severity: "error" }],
      catalogEmpty: () => true,
    })
  );
  const seed = find(r.findings, "SEED_LOAD_FAILED");
  assert.equal(seed?.severity, "fault");
  assert.equal(seed?.params.seed, "jobs");
  assert.equal(seed?.remedy.kind, "host");
  const catalog = find(r.findings, "CATALOG_SEED_FAILED");
  assert.equal(catalog?.severity, "fault");
  assert.deepEqual(r.degradedReasons, [
    `seed:jobs failed to read/parse seed (${path})`,
    "job catalog is empty because its seed data failed to load",
  ]);
  assert.deepEqual(r.probeReasons, r.degradedReasons, "both faults page a monitor, as before");
  assert.equal(r.seedOk, false);
});

test("a MISSING seed file is a supported install, not a finding; the catalog is not even asked", () => {
  let asked = 0;
  const r = collectReadiness(
    healthy({
      seedIssues: [{ seed: "jobs", path: "/x", reason: "file does not exist", severity: "missing" }],
      catalogEmpty: () => {
        asked++;
        return true;
      },
    })
  );
  assert.deepEqual(r.findings, []);
  assert.equal(asked, 0, "the catalog question is only meaningful when the jobs seed errored");
});

test("no configured origin is a WARN with an env remedy, and it never gates the probe", () => {
  delete process.env.APP_BASE_URL;
  delete process.env.NEXT_PUBLIC_APP_BASE_URL;
  const r = collectReadiness(healthy());
  const f = find(r.findings, "PUBLIC_ORIGIN_FALLBACK");
  assert.equal(f?.severity, "warn");
  assert.deepEqual(f?.remedy, { kind: "env", vars: ["APP_BASE_URL"] });
  assert.equal(
    f?.reason,
    "public-origin: no usable APP_BASE_URL or NEXT_PUBLIC_APP_BASE_URL for detached candidate links"
  );
  // /api/ops carried this reason (and its `ok`) before; /api/health never did, and a
  // keyless dev box has no APP_BASE_URL while onboarding pins GET /api/health -> 200.
  assert.deepEqual(r.degradedReasons, [f?.reason]);
  assert.deepEqual(r.probeReasons, [], "the probe's gating set is exactly today's");
});

test("two disagreeing origins name both variables", () => {
  process.env.APP_BASE_URL = "https://a.example.com";
  process.env.NEXT_PUBLIC_APP_BASE_URL = "https://b.example.com";
  const r = collectReadiness(healthy());
  const f = find(r.findings, "PUBLIC_ORIGIN_CONFLICT");
  assert.ok(f, `expected a conflict finding, got ${JSON.stringify(r.findings)}`);
  assert.deepEqual(f.remedy, { kind: "env", vars: ["APP_BASE_URL", "NEXT_PUBLIC_APP_BASE_URL"] });
  assert.equal(f.params.server, "https://a.example.com");
  assert.equal(f.params.client, "https://b.example.com");
  assert.equal(find(r.findings, "PUBLIC_ORIGIN_FALLBACK"), undefined, "one origin finding at most");
  assert.deepEqual(r.degradedReasons, ["public-origin: APP_BASE_URL and NEXT_PUBLIC_APP_BASE_URL disagree"]);
  assert.deepEqual(r.probeReasons, []);
});

test("an unreadable decision_config row opens the Decisions tab", () => {
  const r = collectReadiness(
    healthy({ configIssues: [{ phase: "screening", scope: "team", workspaceId: "ws-x" }] })
  );
  const f = find(r.findings, "DECISION_CONFIG_UNREADABLE");
  assert.equal(f?.severity, "fault");
  assert.deepEqual(f?.params, { phase: "screening", scope: "team", workspaceId: "ws-x" });
  assert.deepEqual(f?.remedy, { kind: "door", tab: "decisions" });
  assert.deepEqual(r.degradedReasons, ["decision-config:screening unreadable (team ws-x)"]);
  assert.equal(r.configOk, false);
});

test("a stalled clock is a host fault that carries the last tick; a booting one is a warn with no action", () => {
  const stale = new Date(NOW - 60 * 60_000).toISOString();
  const stalled = collectReadiness(healthy({ lastTickAt: stale }));
  const s = find(stalled.findings, "SCHEDULER_STALLED");
  assert.equal(s?.severity, "fault");
  assert.equal(s?.params.lastTickAt, stale);
  assert.deepEqual(s?.remedy, { kind: "host" });
  assert.deepEqual(stalled.degradedReasons, [schedulerLivenessReason("stalled", stale)]);

  const never = collectReadiness(healthy({ lastTickAt: null, uptimeMs: 60 * 60_000 }));
  assert.equal(find(never.findings, "SCHEDULER_STALLED")?.params.lastTickAt, null, "never ticked");

  const booting = collectReadiness(healthy({ lastTickAt: null, uptimeMs: 5_000 }));
  const b = find(booting.findings, "SCHEDULER_STARTING");
  assert.equal(b?.severity, "warn");
  assert.deepEqual(b?.remedy, { kind: "none" });
  assert.equal(booting.clock, "starting");
  // A starting clock gated the probe before this change; severity does not move that.
  assert.deepEqual(booting.probeReasons, [schedulerLivenessReason("starting", null)]);
});

test("the ops ordering is preserved: origin, seeds, catalog, config, clock", () => {
  delete process.env.APP_BASE_URL;
  delete process.env.NEXT_PUBLIC_APP_BASE_URL;
  const r = collectReadiness(
    healthy({
      seedIssues: [{ seed: "jobs", path: "/p", reason: "seed JSON is not an array", severity: "error" }],
      catalogEmpty: () => true,
      configIssues: [{ phase: "screening", scope: "org", workspaceId: "ws-a" }],
      lastTickAt: null,
      uptimeMs: 60 * 60_000,
    })
  );
  assert.deepEqual(
    r.findings.map((f) => f.code),
    ["PUBLIC_ORIGIN_FALLBACK", "SEED_LOAD_FAILED", "CATALOG_SEED_FAILED", "DECISION_CONFIG_UNREADABLE", "SCHEDULER_STALLED"]
  );
  assert.deepEqual(r.degradedReasons, r.findings.map((f) => f.reason));
  assert.deepEqual(r.probeReasons, r.degradedReasons.slice(1));
  for (const f of r.findings) assert.ok(isReadinessCode(f.code));
});
