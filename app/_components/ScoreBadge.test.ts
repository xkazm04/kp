// ScoreBadge must normalize its displayed number like every sibling score surface
// (shared-ui-design-system #5) — a fractional 82.6 or out-of-range 150 must not
// leak onto a hiring surface. Client render component with no DOM test env here, so
// this source-guards that the raw {score} is passed through clampPercent + round.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "ScoreBadge.tsx"), "utf8");

test("ScoreBadge normalizes the score for display (round + clamp), not raw", () => {
  assert.match(src, /Math\.round\(clampPercent\(/, "the displayed score must be rounded + clamped");
  assert.doesNotMatch(src, />\{score\}</, "the raw {score} must not be rendered verbatim");
});
