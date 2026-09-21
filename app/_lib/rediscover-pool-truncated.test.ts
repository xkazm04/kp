// Honesty of the rediscovery pool cap. buildCandidatePool already computes
// `truncated` when 100 profiles or 60 analyses are dropped, but rediscoverForJob
// used to destructure `{ entries: pool }` and drop the flag, so silver-medalist
// ranking silently omitted the overflow with only a console.warn. Ranking is a
// Python subprocess, so the keep-and-forward contract is pinned at SOURCE (the
// same shape rediscovery-consent-rank.test.ts uses for the consent gate order).
//
// Runner: Node's built-in test runner with type stripping. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "rediscover.ts"), "utf8").replace(/\r\n/g, "\n");
const route = readFileSync(path.join(here, "..", "api", "jobs", "[id]", "rediscover", "route.ts"), "utf8").replace(
  /\r\n/g,
  "\n"
);

test("rediscoverForJob keeps truncated from the pool and returns it as poolTruncated", () => {
  assert.match(
    src,
    /const \{ entries: pool, truncated \} = buildCandidatePool/,
    "truncated must be kept, not destructured away"
  );
  assert.match(src, /poolTruncated:\s*boolean/, "RediscoverResult carries the flag");
  // Every return site forwards it, including the empty-pool / all-suppressed shorts
  // (a capped corpus that then withholds everyone is still a truncated pool).
  const returns = [...src.matchAll(/return \{\s*rediscovered:[\s\S]*?\};/g)].map((m) => m[0]);
  assert.ok(returns.length >= 3, `expected at least 3 rediscoverForJob returns, found ${returns.length}`);
  for (const block of returns) {
    assert.match(block, /poolTruncated:\s*truncated/, `a return dropped the flag:\n${block}`);
  }
  // Truncation is an admission on a still-ranked subset, never a wipe.
  assert.doesNotMatch(src, /if\s*\(\s*truncated\s*\)\s*return/, "a truncated pool may still return rediscovered rows");
});

test("the on-demand route forwards poolTruncated as a boolean, never dropped identities", () => {
  assert.match(route, /poolTruncated \} = await rediscoverForJob/, "the route reads the flag off the result");
  assert.match(route, /^\s*poolTruncated,$/m, "the JSON echoes the boolean");
  assert.doesNotMatch(
    route,
    /truncatedIds|droppedIdentit|excludedIds|poolDropped/,
    "dropped identities must not ride the wire (same rule as suppressed)"
  );
});
