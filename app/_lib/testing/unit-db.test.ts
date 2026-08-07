import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, utimesSync, rmSync, readFileSync, readdirSync } from "node:fs";
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
