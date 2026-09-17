import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { shouldReplayEntrance } from "./glyphEntrancePolicy.ts";

test("playOnce never remounts the entrance on re-entry", () => {
  assert.equal(shouldReplayEntrance({ playOnce: true, reduced: false, reentered: true }), false);
  assert.equal(shouldReplayEntrance({ playOnce: true, reduced: false, reentered: false }), false);
});

test("a looping consumer still replays only on re-entry", () => {
  assert.equal(shouldReplayEntrance({ playOnce: false, reduced: false, reentered: true }), true);
  assert.equal(shouldReplayEntrance({ playOnce: false, reduced: false, reentered: false }), false);
});

test("prefers-reduced-motion never remounts, even for a looping consumer", () => {
  assert.equal(shouldReplayEntrance({ playOnce: false, reduced: true, reentered: true }), false);
  assert.equal(shouldReplayEntrance({ playOnce: true, reduced: true, reentered: true }), false);
  assert.equal(shouldReplayEntrance({ playOnce: false, reduced: true, reentered: false }), false);
});

test("MotionizedGlyph disconnects the observer after the first play when playOnce", () => {
  const src = readFileSync(fileURLToPath(new URL("./MotionizedGlyph.tsx", import.meta.url)), "utf8");
  assert.match(src, /playOnce\s*=\s*true/);
  assert.match(src, /if \(playOnce\) \{\s*io\.disconnect\(\);/s);
  assert.match(src, /shouldReplayEntrance\(\{ playOnce, reduced, reentered:/);
});

test("MotionizedGlyph does not arm the observer under prefers-reduced-motion", () => {
  const src = readFileSync(fileURLToPath(new URL("./MotionizedGlyph.tsx", import.meta.url)), "utf8");
  assert.match(src, /useReducedMotion\(\)/);
  assert.match(src, /if \(!el \|\| reduced \|\| typeof IntersectionObserver === "undefined"\) return/);
});
