import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
