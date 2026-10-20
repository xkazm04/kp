import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, utimesSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ownerAlive, isSweepable } from "./unit-db.ts";

// bug-ui-scan-2026-07-09 (data-store-persistence #5): the stale-dir sweep must NOT reclaim
// a still-running sibling's DB dir just because its DIRECTORY mtime went stale (a test that
// created its kp.sqlite early then only wrote to it). Liveness is now proven by a `pid`
// marker, not mtime alone.

const SCRATCH = mkdtempSync(path.join(tmpdir(), "kp-sweep-test-"));
function makeDir(name: string, pid?: string): string {
  const dir = mkdtempSync(path.join(SCRATCH, name + "-"));
  if (pid !== undefined) writeFileSync(path.join(dir, "pid"), pid);
  return dir;
}
function agedByAnHour(dir: string): void {
  const old = Date.now() / 1000 - 3600; // 1h ago, well past STALE_MS (15m)
  utimesSync(dir, old, old);
}

test("ownerAlive: our own pid is alive, a dead/absent/malformed marker is not (#5)", () => {
  assert.equal(ownerAlive(makeDir("self", String(process.pid))), true, "our own pid is alive");
  assert.equal(ownerAlive(makeDir("dead", "1073741824")), false, "a pid far above any real one is dead");
  assert.equal(ownerAlive(makeDir("nomarker")), false, "no pid marker → cannot prove liveness");
  assert.equal(ownerAlive(makeDir("garbage", "not-a-number")), false, "malformed marker → dead");
  assert.equal(ownerAlive(makeDir("zero", "0")), false, "pid 0 is rejected");
});

test("isSweepable protects a LIVE owner's dir even when its mtime is stale (#5)", () => {
  const live = makeDir("live", String(process.pid));
  agedByAnHour(live);
  assert.equal(isSweepable(live), false, "a stale-mtime dir whose creator is alive must NOT be swept");
});

test("isSweepable reclaims a stale dir whose owner is dead, or a legacy dir with no marker (#5)", () => {
  const dead = makeDir("dead2", "1073741824");
  agedByAnHour(dead);
  assert.equal(isSweepable(dead), true, "stale + dead owner → reclaimable");

  const legacy = makeDir("legacy"); // pre-fix dir, no pid marker
  agedByAnHour(legacy);
  assert.equal(isSweepable(legacy), true, "stale + no marker → reclaimable (fallback)");
});

test("isSweepable never touches a FRESH dir, whatever its owner (#5)", () => {
  const freshDead = makeDir("fresh", "1073741824"); // dead owner but just created
  assert.equal(isSweepable(freshDead), false, "recent mtime → never swept regardless of owner");
});

test("cleanup scratch", () => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

// --- Class guard: no test may derive its temp DB path from process.pid ------------
//
// This defect has landed THREE times (7c63692 root-caused it in the billing pair; the
// sweep that follows migrated eight more files). The shape is always the same:
//
//   const TMP = path.join(os.tmpdir(), `kp-<thing>-test-${process.pid}.sqlite`);
//   process.env.KP_DB_PATH = TMP;
//
// `--test-isolation=process` gives each test FILE its own process, which reads as
// sufficient — but the OS RECYCLES pids. A run that draws a pid an earlier run used
// re-opens that run's leftover database and inherits its committed state, so every
// stateful assertion fails intermittently and only under the full parallel suite.
// mkdtempSync is unique BY CONSTRUCTION; process.pid is not. Ad-hoc mkdtemp paths stay
// legal (a few files predate the fixture) — what is pinned shut is the pid derivation.
const TESTING_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(TESTING_DIR, "..", ".."); // app/_lib/testing -> app/

// The fixture pair legitimately reads/writes pid MARKERS (the liveness probe above);
// they are the mechanism, not an instance of the defect.
const EXEMPT = new Set([path.join(TESTING_DIR, "unit-db.ts"), path.join(TESTING_DIR, "unit-db.test.ts")]);

function testFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") testFiles(p, out);
    } else if (e.name.endsWith(".test.ts") && !EXEMPT.has(p)) {
      out.push(p);
    }
  }
  return out;
}

/** Strip line + block comments so the explanatory `${process.pid}` post-mortems the
 *  migrated files carry (deliberately quoting the old path) don't self-trip the guard. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("no test file derives a temp DB path from process.pid (pid recycling — 7c63692)", () => {
  const files = testFiles(APP_DIR);
  assert.ok(files.length >= 100, `expected to scan the whole test tree, only found ${files.length} files`);

  const offenders: string[] = [];
  for (const f of files) {
    const lines = stripComments(readFileSync(f, "utf8")).split("\n");
    lines.forEach((line, i) => {
      // process.pid is fine on its own (record ids, labels). It is the defect only when
      // it lands in something that names a database file or the DB-path env var.
      if (!line.includes("process.pid")) return;
      if (!/tmpdir|\.sqlite|KP_DB_PATH/.test(line)) return;
      offenders.push(`${path.relative(APP_DIR, f)}:${i + 1}: ${line.trim()}`);
    });
  }

  assert.deepEqual(
    offenders,
    [],
    "pid-derived temp DB path(s) found. PIDs are RECYCLED, so this re-opens a previous " +
      'run\'s leftover database and inherits its state. Use the fixture instead:\n' +
      '  const { cleanupUnitDb, UNIT_DB_PATH: TMP } = await import(".../testing/unit-db.ts");\n' +
      "  after(cleanupUnitDb);\n" +
      "as the FIRST project import (DB_PATH freezes at db-path.ts module-eval).\n" +
      offenders.join("\n")
  );
});

// --- One suite per machine: concurrent launchers take turns -------------------------
//
// The python-runner, templates-isolation and devcase comms flakes of 2026-10-17/18 each
// passed alone and failed only in a gate that ran beside another lane's gate. Reproduced
// on the 16-core dev box: three full suites started together failed 3/3 (python-runner
// wall-clock bounds: "Python process timed out after 4s", the 80 ms background bound);
// one or two at a time never did. The isolation fixtures above were all clean - nothing
// was shared but the CPU. scripts/run-unit-tests.mjs now holds a machine-wide slot for
// the whole run, and this pins it from the outside: two launchers started together must
// run one after the other.
//
// RED-FIRST: on the launcher without the slot, both fixture runs overlap and the
// first test fails on the overlap assertion.
const REPO_ROOT = path.resolve(TESTING_DIR, "..", "..", "..");

type LauncherRun = { code: number | null; out: string };

/** Start the real launcher on one file, contending for the slot at `slotDir` (never the
 *  machine's real slot, which the suite running this file holds). */
function launch(file: string, slotDir: string, extraEnv: Record<string, string> = {}): Promise<LauncherRun> {
  const env: NodeJS.ProcessEnv = { ...process.env, KP_TEST_SLOT_DIR: slotDir, KP_FLAKE_RERUN: "0", ...extraEnv };
  // This file runs inside a launcher that holds its own slot; a child that inherited
  // the marker would skip the slot and prove nothing.
  if (!("KP_TEST_SLOT_HELD" in extraEnv)) delete env.KP_TEST_SLOT_HELD;
  delete env.KP_TEST_SLOT;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/run-unit-tests.mjs", file], { cwd: REPO_ROOT, env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

/** A test file that records the wall-clock window it ran in, one `start end` line. */
function windowFixture(dir: string, log: string): string {
  const file = path.join(dir, "slot-window.test.mjs");
  writeFileSync(
    file,
    'import { test } from "node:test";\n' +
      'import { appendFileSync } from "node:fs";\n' +
      'test("holds the machine for a while", async () => {\n' +
      "  const start = Date.now();\n" +
      "  await new Promise((r) => setTimeout(r, 1500));\n" +
      `  appendFileSync(${JSON.stringify(log)}, start + " " + Date.now() + "\\n");\n` +
      "});\n"
  );
  return file;
}

test("two launchers started together run one after the other, and the second says why it waits", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kp-slot-test-"));
  try {
    const log = path.join(dir, "windows.log");
    const file = windowFixture(dir, log);
    const slot = path.join(dir, "slot");
    const runs = await Promise.all([launch(file, slot), launch(file, slot)]);
    for (const r of runs) assert.equal(r.code, 0, `the launcher run passed:\n${r.out}`);

    const windows = readFileSync(log, "utf8").trim().split("\n").map((l) => l.split(" ").map(Number)).sort((a, b) => a[0] - b[0]);
    assert.equal(windows.length, 2, "both runs executed the fixture");
    const [[, firstEnd], [secondStart]] = windows;
    assert.ok(
      secondStart >= firstEnd,
      `the second suite started ${firstEnd - secondStart} ms before the first finished: two suites shared the machine`
    );
    assert.equal(runs.filter((r) => r.out.includes("another suite is running on this machine")).length, 1, "exactly one run waited, and said so");
    assert.throws(() => readdirSync(slot), "the slot is released when the holder ends");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a launcher started by a test of the holding suite does not wait on its own parent", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kp-slot-test-"));
  try {
    const file = windowFixture(dir, path.join(dir, "windows.log"));
    const slot = path.join(dir, "slot");
    mkdirSync(slot);
    writeFileSync(path.join(slot, "owner.json"), JSON.stringify({ pid: process.pid, cwd: REPO_ROOT, at: Date.now() }));
    const run = await launch(file, slot, { KP_TEST_SLOT_HELD: String(process.pid) });
    assert.equal(run.code, 0, run.out);
    assert.ok(!run.out.includes("another suite is running"), "a nested launcher never waits");
    assert.deepEqual(readdirSync(slot), ["owner.json"], "and never releases the slot it does not own");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a slot left by a dead launcher is taken over, not waited on", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kp-slot-test-"));
  try {
    const file = windowFixture(dir, path.join(dir, "windows.log"));
    const slot = path.join(dir, "slot");
    mkdirSync(slot);
    writeFileSync(path.join(slot, "owner.json"), JSON.stringify({ pid: 1073741824, cwd: "gone", at: Date.now() }));
    const run = await launch(file, slot);
    assert.equal(run.code, 0, run.out);
    assert.ok(!run.out.includes("another suite is running"), "a dead owner is not waited on");
    assert.throws(() => readdirSync(slot), "the taken-over slot is released at the end");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
