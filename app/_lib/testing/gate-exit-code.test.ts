// The gate's whole value is its exit code: `npm run test:unit` is what CI and
// the App-master's gate sweeps run, and anything that stops failures from
// reaching the exit code turns the gate permanently false-green with no other
// symptom. That is not hypothetical — measured 2026-08-27: an inherited
// NODE_TEST_CONTEXT (present in any process descended from another `node
// --test` run, e.g. the bench driver) flips a fresh runner into
// child-reporting mode, which prints the failures and then exits 0. The
// scripts/run-unit-tests.mjs launcher scrubs that marker (plus the ambient DB
// backend vars) before the runner boots; this test drives the launcher from a
// deliberately polluted environment and pins the contract from the outside:
// a failing suite exits non-zero, a passing one exits zero, and ambient
// backend env never reaches a test file.
//
// Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";

// The pollution every case runs under: the exact vars the launcher must scrub.
const POLLUTED_ENV = {
  ...process.env,
  NODE_TEST_CONTEXT: "child-spec",
  DATABASE_URL: "postgres://ambient:leak@example.invalid:5432/kp",
  KP_DB_BACKEND: "",
  KP_OFFLINE: "",
  NO_COLOR: "1",
  FORCE_COLOR: "0",
};

/** Run the real launcher over a single fixture test file from the polluted
 *  environment; return its exit status (null = killed by a signal). cwd stays
 *  at the repo root, matching how npm runs the script. `extraEnv` layers on top
 *  of the pollution — the hang case uses it to shorten the launcher's
 *  --test-timeout so the fixture returns in seconds rather than two minutes. */
function runGateOn(fixtureSource: string, extraEnv: Record<string, string> = {}): number | null {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kp-gate-exit-"));
  try {
    const file = path.join(dir, "probe.test.ts");
    writeFileSync(file, fixtureSource);
    const res = spawnSync(process.execPath, ["scripts/run-unit-tests.mjs", file], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...POLLUTED_ENV, ...extraEnv },
    });
    return res.status;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a failing suite exits non-zero even under an inherited NODE_TEST_CONTEXT", () => {
  const status = runGateOn(
    'import { test } from "node:test";\n' +
      'import assert from "node:assert";\n' +
      'test("fails", () => { assert.strictEqual(1, 2); });\n'
  );
  assert.notEqual(status, null, "the runner must not die to a signal");
  assert.notEqual(status, 0, "a failing test MUST fail the gate");
});

test("a passing suite exits zero under the same pollution (the gate is not inverted)", () => {
  const status = runGateOn(
    'import { test } from "node:test";\ntest("passes", () => {});\n'
  );
  assert.equal(status, 0);
});

test("ambient DB backend env is scrubbed before any test file loads", () => {
  const status = runGateOn(
    'import { test } from "node:test";\n' +
      'import assert from "node:assert";\n' +
      'test("no ambient backend env", () => {\n' +
      "  assert.equal(process.env.DATABASE_URL, undefined);\n" +
      "  assert.equal(process.env.KP_DB_BACKEND, undefined);\n" +
      "  assert.equal(process.env.KP_OFFLINE, undefined);\n" +
      "});\n"
  );
  assert.equal(status, 0);
});

// ---------------------------------------------------------------------------
// A HANG is the other way a gate stops reporting. Node's runner waits forever by
// default, so one test that never settles pins the suite until a CI job timeout
// or a human kills it — and the output at that point names no test, only a dead
// job. The launcher passes `--test-timeout` (120 s by default, KP_TEST_TIMEOUT_MS
// for this fixture) so a hang lands as an ordinary red with the offending test
// named. Without the flag this case never returns at all, which is exactly why it
// is pinned from the outside.

test("a hanging test file fails the gate instead of blocking it forever", () => {
  const started = Date.now();
  const status = runGateOn(
    'import { test } from "node:test";\n' +
      'test("never settles", () => new Promise(() => {}));\n',
    { KP_TEST_TIMEOUT_MS: "1500" }
  );
  const elapsedMs = Date.now() - started;
  assert.notEqual(status, null, "the runner must not die to a signal");
  assert.notEqual(status, 0, "a test that never settles MUST fail the gate");
  assert.ok(
    elapsedMs < 60_000,
    `the launcher must bound a hang; this run took ${elapsedMs}ms, so --test-timeout is not reaching the runner`
  );
});

test("the bench driver runs through the launcher, so its scrub applies there too", () => {
  const pkg = JSON.parse(
    readFileSync(path.join(process.cwd(), "package.json"), "utf8")
  ) as { scripts: Record<string, string> };
  const script = pkg.scripts["test:bench-driver"];

  // The bench driver is named in run-unit-tests.mjs as the canonical source of an
  // inherited NODE_TEST_CONTEXT — a bare `node --test` there is a runner that the
  // launcher's scrub never sees, and any gate it shells out to inherits the marker
  // and exits 0 with failures on screen. Route it through the launcher instead.
  assert.ok(script, "package.json lost the test:bench-driver script");
  assert.match(
    script,
    /^node scripts\/run-unit-tests\.mjs\b/,
    "test:bench-driver must go through the launcher, not `node --test` directly"
  );
  assert.match(
    script,
    /scripts\/app-master-bench\/\*\*\/\*\.test\.mjs/,
    "test:bench-driver must keep covering the whole bench-driver glob"
  );
});

test("the launcher scrubs the pollution for .mjs files as well as .ts ones", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kp-gate-mjs-"));
  try {
    const file = path.join(dir, "probe.test.mjs");
    writeFileSync(
      file,
      'import { test } from "node:test";\n' +
        'import assert from "node:assert";\n' +
        'test("scrubbed", () => {\n' +
        "  assert.equal(process.env.DATABASE_URL, undefined);\n" +
        "});\n"
    );
    const res = spawnSync(process.execPath, ["scripts/run-unit-tests.mjs", file], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: POLLUTED_ENV,
    });
    assert.equal(res.status, 0, res.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
