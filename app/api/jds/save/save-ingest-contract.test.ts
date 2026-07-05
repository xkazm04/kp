// Locks the save-vs-ingest contract (idea-10b7f136): POST /api/jds/save saves the
// JD draft authoritatively but ingests the matchable jd-<slug> Job best-effort,
// reporting which ran via `jobIngested`. When ingest fails the draft exists with no
// Job row, so "Source into Pipeline" would dead-end (POST /publish → 404). The
// recovery must be an in-place re-ingest under the existing slug — never a dead end.
// (The inline builder result that once carried this guard was retired for the
// backgrounded flow; the finished JD now lives in the Ledger, where a JD with no
// matchable Job reads as `unlinked` and offers the RowIngest re-ingest affordance.)
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
  assert.match(src, /loadJd\(body\.slug\b/, "an unknown retry slug must be rejected, not minted");
  assert.match(src, /status:\s*404/, "an unknown retry slug must 404");
});

test("the Ledger offers an in-place re-ingest for a JD with no matchable job (no dead-end)", () => {
  // A JD that never got a matchable Job (ingest failed, or a description-less build)
  // reads as `unlinked` and MUST offer an in-place re-ingest — never a
  // Source-into-Pipeline dead end (POST /publish → 404).
  const ledger = read("../../../features/sub_library/LibrarySavedJdsLedger.tsx");
  assert.match(ledger, /isUnlinked\(row\)[\s\S]{0,120}?<RowIngest/, "unlinked JDs must get the RowIngest affordance");
  assert.match(ledger, /Couldn't ingest[\s\S]{0,10}?retry/, "a failed ingest must offer a retry, not dead-end");

  // The re-ingest re-uses the existing slug (re-ingest in place, not a duplicate draft).
  const hooks = read("../../../features/sub_library/jd-hooks.ts");
  assert.match(
    hooks,
    /\/api\/jds\/\$\{encodeURIComponent\(slug\)\}\/ingest-job/,
    "re-ingest must target the existing slug's ingest-job endpoint",
  );
});
