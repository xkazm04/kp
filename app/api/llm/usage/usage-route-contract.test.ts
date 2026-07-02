// Locks the /api/llm/usage contract (backlog item 9): the ledger read surface is
// operator-gated exactly like /api/llm/keys (requireOperator rejects the anonymous
// demo session), read-only (GET only), returns the aggregateLlmUsage rollup plus
// promptCacheStats, and clamps the ?days= window so a hostile query can't force an
// unbounded ledger scan.
//
// These are source-level guards (the modules import via the "@/..." alias, which
// Node's test runner does not resolve), mirroring save-ingest-contract.test.ts.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

test("usage route is operator-gated before touching the ledger", () => {
  const src = read("./route.ts");
  assert.match(
    src,
    /const denied = await requireOperator\(\);\s*\n\s*if \(denied\) return denied;/,
    "GET must re-verify the operator session at the handler (defense in depth)"
  );
  // The gate must run BEFORE any DB read.
  const gateAt = src.indexOf("requireOperator()");
  const readAt = src.indexOf("aggregateLlmUsage(");
  assert.ok(gateAt > -1 && readAt > gateAt, "the operator gate must precede the ledger read");
});

test("usage route returns the aggregate rollup plus prompt-cache stats", () => {
  const src = read("./route.ts");
  assert.match(src, /aggregateLlmUsage\(days\)/, "must return the ledger rollup for the clamped window");
  assert.match(src, /promptCache:\s*promptCacheStats\(\)/, "must include the prompt-cache hit stats");
  assert.match(src, /days,/, "must echo the effective window so the client can label it");
});

test("usage route clamps the days window and stays read-only", () => {
  const src = read("./route.ts");
  assert.match(src, /searchParams\.get\("days"\)/, "must read the ?days= window param");
  assert.match(src, /Math\.min\(Math\.max\(parsed, 1\), MAX_DAYS\)/, "days must be clamped to a sane range");
  assert.match(src, /DEFAULT_DAYS = 30/, "the default window is 30 days (aggregateLlmUsage's default)");
  assert.doesNotMatch(
    src,
    /export async function (POST|PUT|DELETE|PATCH)/,
    "the ledger surface is read-only — writes happen only via spawnPython's sidecar ingest"
  );
});
