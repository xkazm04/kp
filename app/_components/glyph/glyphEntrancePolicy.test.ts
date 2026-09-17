import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { shouldReplayEntrance } from "./glyphEntrancePolicy.ts";

test("playOnce never remounts the entrance on re-entry", () => {
  assert.equal(shouldReplayEntrance({ playOnce: true, reentered: true }), false);
  assert.equal(shouldReplayEntrance({ playOnce: true, reentered: false }), false);
});

test("a looping consumer still replays only on re-entry", () => {
  assert.equal(shouldReplayEntrance({ playOnce: false, reentered: true }), true);
  assert.equal(shouldReplayEntrance({ playOnce: false, reentered: false }), false);
});

test("MotionizedGlyph disconnects the observer after the first play when playOnce", () => {
  const src = readFileSync(fileURLToPath(new URL("./MotionizedGlyph.tsx", import.meta.url)), "utf8");
  assert.match(src, /playOnce\s*=\s*true/);
  assert.match(src, /if \(playOnce\) \{\s*io\.disconnect\(\);/s);
  assert.match(src, /shouldReplayEntrance\(\{ playOnce, reentered:/);
});
