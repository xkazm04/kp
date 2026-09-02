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

// The other half of the same contract: an ingest that RUNS must also LAND.
// `ingestJobAd` spawns `jobs_cli ingest` and returns the parsed Job — it writes
// nothing at all (the Python side has no DB; `insertJob` is the sole writer of the
// `jobs` table, which is why POST /api/jobs/ingest pairs the two calls). Three JD
// routes called it and dropped the result on the floor while reporting success:
//   • POST /api/jds/[slug]/ingest-job  — burned a paid Claude ad-parse and answered
//     `{ ok: true, already: false, jobId: "jd-<slug>" }` with no row written, so the
//     Ledger row stayed `unlinked`, "Source into Pipeline" 404'd, and every re-click
//     re-spent the parse.
//   • PATCH /api/jds/[slug] and POST /api/jds/[slug]/revisions — answered
//     `jobResynced: true` while the matchable job kept the requirements/education
//     floor parsed from the PRE-edit (or just-reverted) text, so match scores and the
//     winnability coach kept answering the old wording.
// Pinned as a source guard for the same reason as the rest of this file: these
// modules import via "@/..." and pull in next/server.
test("every JD route that re-parses the body PERSISTS the parse (ingestJobAd only parses)", () => {
  for (const rel of ["../[slug]/ingest-job/route.ts", "../[slug]/route.ts", "../[slug]/revisions/route.ts"]) {
    const src = read(rel);
    assert.match(src, /await ingestJobAd\(/, `${rel} is expected to re-parse the JD body`);
    assert.match(src, /\binsertJob\(/, `${rel} must persist the parse — ingestJobAd writes nothing`);
    // The write must follow the parse it persists.
    const parseAt = src.search(/await ingestJobAd\(/);
    const writeAt = src.search(/\binsertJob\(/);
    assert.ok(writeAt > parseAt, `${rel} must call insertJob AFTER ingestJobAd`);
    // …and under the EXPLICIT jd-<slug> id, or content-twin dedup can file the parse
    // onto an unrelated job and leave the JD unlinked while the response says ok.
    assert.match(src, /insertJob\([^)]*\bjobId\b[^)]*\)/, `${rel} must persist under the jd-<slug> job id`);
  }
});

test("the Ledger offers an in-place re-ingest for a JD with no matchable job (no dead-end)", () => {
  // A JD that never got a matchable Job (ingest failed, or a description-less build)
  // reads as `unlinked` and MUST offer an in-place re-ingest — never a
  // Source-into-Pipeline dead end (POST /publish → 404).
  const row = read("../../../features/library/jds/JdsLedgerRow.tsx");
  assert.match(row, /isUnlinked\(row\)[\s\S]{0,120}?<RowIngest/, "unlinked JDs must get the RowIngest affordance");
  // The retry copy was localized (bug-ui-scan-2026-07-09 jd-authoring-library-templates #3):
  // the RowIngest error state must still offer a retry — now via the ingestRetry* key.
  const rowIngest = read("../../../features/library/jds/JdsLedgerRowIngest.tsx");
  assert.match(rowIngest, /state === "error"[\s\S]{0,40}?ingestRetry/, "a failed ingest must offer a retry, not dead-end");

  // The re-ingest re-uses the existing slug (re-ingest in place, not a duplicate draft).
  const hooks = read("../../../features/library/jds/jdsHooks.ts");
  assert.match(
    hooks,
    /\/api\/jds\/\$\{encodeURIComponent\(slug\)\}\/ingest-job/,
    "re-ingest must target the existing slug's ingest-job endpoint",
  );
});

// The matchable band is pinned to the market analysis by contract (the doc's
// "AI-fixed, not editable" section). Both writers of the jd-<slug> Job — the first
// ingest and the edit-time re-sync in PATCH /api/jds/[slug] — must go through the
// one helper that pins it, or an edited salary line becomes the matchable band.
test("both jd-<slug> ingests pin the band through withGroundedBand", () => {
  const first = read("./ingest-job.ts");
  assert.match(first, /withGroundedBand\(/, "the first ingest must pin the analysis band through the shared helper");
  const resync = read("../[slug]/route.ts");
  assert.match(resync, /withGroundedBand\(/, "the edit re-sync must carry the grounded band across the re-parse");
  assert.match(resync, /groundedJdBand\(existing\.analysis_json\)/, "…read from the JD row's stored analysis, not the parse");
});
