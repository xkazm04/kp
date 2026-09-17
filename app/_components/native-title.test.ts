// Source-guard: shared feedback/status primitives must not use native `title=`.
//
// Surface doctrine: a tooltip must be a real element, not `title=`. Native title
// never appears on keyboard focus and is invisible to touch. Confidence-band
// drivers and the LoadStatus pill used to live there; they now wrap Tooltip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const FILES = [
  "Badge.tsx",
  "LoadStatus.tsx",
  "StatusChip.tsx",
  "IconAction.tsx",
  "Toast.tsx",
  "Modal.tsx",
  "Tooltip.tsx",
] as const;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

for (const file of FILES) {
  test(`${file}: no literal title= (Tooltip is the named replacement)`, () => {
    const src = stripComments(readFileSync(path.join(HERE, file), "utf8"));
    assert.doesNotMatch(
      src,
      /\btitle\s*=/,
      `${file} still has a native title= — wrap Tooltip and drop the attribute`,
    );
  });
}

test("ConfidenceBandBadge and ConfidenceRange wrap Tooltip, not title=", () => {
  const src = readFileSync(path.join(HERE, "Badge.tsx"), "utf8");
  assert.match(src, /<Tooltip label=\{confidenceBandTitle\(drivers, copy\.title\)\}>/);
  assert.equal((src.match(/<Tooltip /g) ?? []).length, 2, "badge + range each wrap Tooltip");
  assert.match(src, /export function ConfidenceBandBadge/);
  assert.match(src, /export function ConfidenceRange/);
});

test("LoadStatus pill wraps Tooltip with the stale/offline title strings", () => {
  const src = readFileSync(path.join(HERE, "LoadStatus.tsx"), "utf8");
  assert.match(src, /<Tooltip label=\{tip\}>/);
  assert.match(src, /t\("pillTitleStale"/);
  assert.match(src, /t\("pillTitle"/);
});
