// The profile build sits on the UNAUTHENTICATED accept path and spawns Python.
// With no explicit timeout it inherited python-runner's 600s hang-backstop, so a
// wedged child could hold an applicant's request open for ten minutes (they see a
// hung form and re-submit, each retry spawning another child).
//
// Two things must hold, and this file pins both: the spawn is bounded by an
// explicit 60s-class value, and a spawn that REJECTS — which is exactly how the
// runner delivers a timeout — degrades through the EXISTING intake-degraded path
// rather than throwing out to the route (a candidate-facing 500 for an
// application that could still have been filed).
//
// The rejection is induced with a nonexistent PYTHON_CMD (spawn ENOENT) rather
// than by waiting 60 wall-clock seconds: python-runner delivers a timeout and a
// spawn error through the SAME rejection of `result`, which the guard below
// pins, so this exercises the same recovery.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import type { JobRecord } from "./db/core.ts";

after(() => cleanupUnitDb());

// Must be set before python-runner is evaluated (it reads PYTHON_CMD at module
// load), hence the dynamic import below rather than a static one.
process.env.PYTHON_CMD = "kp-no-such-python-binary";
const { buildApplicantProfile } = await import("./applicant-profile.ts");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, "applicant-profile.ts"), "utf8");
const runnerSrc = readFileSync(path.join(HERE, "python-runner.ts"), "utf8");

const JOB: JobRecord = {
  id: "job-timeout-test",
  title: "Backend Engineer",
  company: "Acme",
  workMode: "hybrid",
  seniority: "medior",
  roleFamily: "backend",
  languages: ["Czech", "English"],
};

test("the profile spawn is bounded by an explicit 60s-class timeout, not the 600s backstop", () => {
  const declared = src.match(/const PROFILE_BUILD_TIMEOUT_MS = ([\d_]+)/);
  assert.ok(declared, "the bound must be a named constant, not an inline literal");
  const ms = Number(declared[1].replace(/_/g, ""));
  assert.ok(ms >= 30_000 && ms <= 120_000, `expected a 60s-class bound, got ${ms}ms`);
  assert.match(
    src,
    /spawnPython\(\["-m", "pipeline\.jobfit\.profile_cli"[\s\S]{0,120}?timeoutMs: PROFILE_BUILD_TIMEOUT_MS/,
    "the profile_cli spawn must pass the bound — omitting it silently inherits the 600s default"
  );
  // Non-vacuity: the default it would otherwise inherit really is 10 minutes.
  assert.match(runnerSrc, /const DEFAULT_TIMEOUT_MS = 600_000/);
});

test("a timeout reaches the caller as a REJECTION (the path the degrade test exercises)", () => {
  assert.match(
    runnerSrc,
    /fail\(new Error\(`Python process timed out after \$\{Math\.round\(timeoutMs \/ 1000\)\}s/,
    "python-runner must deliver a timeout by rejecting `result`, like any other spawn failure"
  );
});

test("a rejected spawn degrades the intake — it never throws at the candidate", async () => {
  const outcome = await buildApplicantProfile(JOB, { name: "Jana Nová", skills: "TypeScript, SQL", experience: "4 years" });
  assert.equal(outcome.ok, false, "a failed build must be reported, not thrown");
  assert.ok(outcome.ok === false && outcome.reason.length > 0, "the degraded reason is what makes the stub recruiter-visible");
  assert.ok(outcome.ok === false && outcome.reason.length <= 280, "the reason is bounded — it lands in a DB column and a compact UI");
  assert.ok(!outcome.ok, "and the caller still files an entry (intakeDegraded) rather than 500ing");
});
