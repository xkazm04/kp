// Locks the save-vs-ingest contract (idea-10b7f136): POST /api/jds/save saves the
// JD draft authoritatively but ingests the matchable jd-<slug> Job best-effort,
// reporting which ran via `jobIngested`. When ingest fails the draft exists with no
// Job row, so "Source into Pipeline" would dead-end (POST /publish → 404). The
// builder must read `jobIngested`, block Publish with an explanation, and offer a
// retry that re-ingests in place — never let the user click into that dead end.
//
// These are source-level guards (the modules import via the "@/..." alias, which
// Node's test runner does not resolve), mirroring upload-size-contract.test.ts.
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

test("save route reports jobIngested and treats ingest as best-effort", () => {
  const src = read("./route.ts");
  // Ingest is wrapped so a failure never blocks the JD save...
  assert.match(src, /catch\s*\{[\s\S]{0,200}?best-effort/i, "ingest failure must be caught, not block the save");
  // ...and the response must surface whether it ran.
  assert.match(src, /jobIngested/, "the save response must include jobIngested");
});

test("save route supports a retry that re-ingests under an existing slug", () => {
  const src = read("./route.ts");
  // A retry passes the existing slug so we re-ingest in place instead of forking a
  // duplicate draft — the JD row must NOT be re-created when a slug is supplied.
  assert.match(src, /body\.slug/, "retry must re-use the client-supplied slug");
  assert.match(src, /loadJd\(body\.slug\)/, "an unknown retry slug must be rejected, not minted");
  assert.match(src, /status:\s*404/, "an unknown retry slug must 404");
});

test("builder blocks Source into Pipeline when ingest failed and offers a retry", () => {
  const src = read("../../../features/sub_library/JdBuilderResult.tsx");
  // The Source button must be gated on jobIngested — a failed ingest can't be sourced.
  assert.match(
    src,
    /disabled=\{sourcing \|\| !saved\.jobIngested\}/,
    "Source into Pipeline must be disabled until the role is ingested",
  );
  // ...with a retry that re-ingests in place (re-POST carrying the saved slug).
  assert.match(src, /retryIngest/, "must offer a retry handler when ingest failed");
  assert.match(src, /slug:\s*saved\.slug/, "retry must re-POST with the existing slug (re-ingest, not duplicate)");
});
