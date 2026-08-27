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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";

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
 *  at the repo root, matching how npm runs the script. */
function runGateOn(fixtureSource: string): number | null {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kp-gate-exit-"));
  try {
    const file = path.join(dir, "probe.test.ts");
    writeFileSync(file, fixtureSource);
    const res = spawnSync(process.execPath, ["scripts/run-unit-tests.mjs", file], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: POLLUTED_ENV,
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
