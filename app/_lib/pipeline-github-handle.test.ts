// Pins the inbound GitHub-handle persistence the conversational apply relies on
// (the repo-signal differentiator for board candidates): createPipelineEntry
// stores the normalized handle on a new entry and FILL-ONLY backfills it on a
// dedup re-add, rowToEntry maps it back (including on the listPipeline board
// payload), mergeReapplication backfills a handle-less original without ever
// overwriting one, and setEntryGithubEvidence attaches the drawer-run deep-dive
// summary additively. Drives the REAL db.ts against a throwaway SQLite file so
// a copied-out guard can't drift from the module.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
// Static (hoisted) import — loads better-sqlite3 BEFORE registerHooks runs, so
// the resolve hook below never intercepts its internal CJS requires (the same
// ordering rematch-source.test.ts relies on). Also the audit-event reader.
import Database from "better-sqlite3";

// db.ts transitively imports the "@/*" alias, extensionless TS siblings, and JSON
// files without an import attribute — none of which the bare `node --test` runner
// resolves on its own. Install the same minimal hooks the other real-module tests
// use (see rematch-source.test.ts) so we load the REAL db module.
const ROOT = new URL("../../", import.meta.url).href; // repo root (app/_lib/ -> ../../)
registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;
    if (spec.startsWith("@/")) spec = new URL(spec.slice(2), ROOT).href; // tsconfig "@/*"
    else if ((spec.startsWith("./") || spec.startsWith("../")) && context.parentURL) {
      spec = new URL(spec, context.parentURL).href; // relative -> file: so we can test for .ts
    }
    if (spec.startsWith("file:") && !/\.[a-z0-9]+$/i.test(spec) && fs.existsSync(fileURLToPath(spec + ".ts"))) {
      spec += ".ts"; // extensionless import, e.g. "./pipeline-status"
    }
    return nextResolve(spec, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".json")) {
      // Wrap JSON as an ES module so the missing `type: json` attribute is moot.
      const source = "export default " + fs.readFileSync(fileURLToPath(url), "utf8") + ";";
      return { format: "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

// Point db.ts at a throwaway DB BEFORE importing it: db-path reads KP_DB_PATH at
// module load; ensureDb opens lazily on first use. node --test isolates each file in
// its own process, so this env mutation can't leak to other tests.
const TMP = path.join(os.tmpdir(), `kp-github-handle-test-${process.pid}.sqlite`);
process.env.KP_DB_PATH = TMP;

const { createPipelineEntry, getPipelineEntry, listPipeline, mergeReapplication, setEntryGithubEvidence } =
  await import("./db.ts");

after(() => {
  // Best-effort: the module connection stays open (no close hook); on Windows an
  // open SQLite file can't be unlinked, so swallow the error — the file is disposable.
  for (const f of [TMP, `${TMP}-wal`, `${TMP}-shm`]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      /* file locked / absent — fine */
    }
  }
});

let n = 0;
// Seed one entry with a unique candidate+job so the (candidate, job) idempotency
// key never collides across tests. `githubHandle` mirrors the apply route's
// already-coerced input (createPipelineEntry never re-validates it).
function seed(githubHandle?: string | null): { id: string; candidateId: string; jobId: string } {
  n += 1;
  const candidateId = `c${process.pid}_${n}`;
  const jobId = `ghJob${process.pid}_${n}`;
  const { entry } = createPipelineEntry({
    candidateId,
    candidateLabel: `Cand ${n}`,
    jobId,
    jobTitle: `GH Role ${n}`,
    stage: "Accepted",
    githubHandle,
  });
  return { id: entry.id, candidateId, jobId };
}

// A minimal summary in the exact coerced shape rowToEntry revives at the read
// boundary — what the set_github route persists after coerceGithubEvidenceSummary.
function summary(username: string) {
  return {
    username,
    profileUrl: `https://github.com/${username}`,
    summary: "Active public profile.",
    confirmedSkills: ["TypeScript"],
    unverifiedClaims: [],
    hiddenStrengths: [],
    topRepositories: [],
    analyzedAt: "2026-06-12T00:00:00.000Z",
  };
}

test("createPipelineEntry persists the handle and rowToEntry maps it back", () => {
  const { id } = seed("octocat");
  assert.equal(getPipelineEntry(id)?.githubHandle, "octocat");
});

test("an entry created without a handle reads null (recruiter/Match adds, legacy rows)", () => {
  const { id } = seed();
  assert.equal(getPipelineEntry(id)?.githubHandle, null);
});

test("a dedup re-add backfills a missing handle but never overwrites one", () => {
  const { id, candidateId, jobId } = seed();
  const again = createPipelineEntry({
    candidateId,
    candidateLabel: "Same Person",
    jobId,
    jobTitle: "GH Role",
    githubHandle: "octocat",
  });
  assert.equal(again.created, false);
  assert.equal(again.entry.id, id);
  assert.equal(again.entry.githubHandle, "octocat"); // fill: the entry had none
  const third = createPipelineEntry({
    candidateId,
    candidateLabel: "Same Person",
    jobId,
    jobTitle: "GH Role",
    githubHandle: "impostor",
  });
  assert.equal(third.entry.githubHandle, "octocat"); // never an overwrite
});

test("mergeReapplication backfills a handle-less entry and refuses an overwrite", () => {
  const { id } = seed();
  assert.equal(mergeReapplication(id, { githubHandle: "octocat" })?.githubHandle, "octocat");
  assert.equal(mergeReapplication(id, { githubHandle: "impostor" })?.githubHandle, "octocat");
});

test("setEntryGithubEvidence attaches evidence once and keeps the first attach", () => {
  const { id } = seed("octocat");
  const attached = setEntryGithubEvidence(id, JSON.stringify(summary("octocat")));
  assert.equal(attached?.githubEvidence?.username, "octocat");
  assert.equal(attached?.githubEvidence?.confirmedSkills[0], "TypeScript");
  // FILL-ONLY: a second run never silently replaces what's already attached.
  const rerun = setEntryGithubEvidence(id, JSON.stringify(summary("someone-else")));
  assert.equal(rerun?.githubEvidence?.username, "octocat");
  // Unknown id is a safe null, the route's 404 signal.
  assert.equal(setEntryGithubEvidence("does-not-exist", JSON.stringify(summary("x"))), null);
  // The audit trail shows where the evidence came from — once, on the real
  // attach only (a refused rerun records nothing). Read via a separate
  // read-only connection on the same file, the way db.ts shares kp.sqlite.
  const d = new Database(TMP, { readonly: true });
  const events = d
    .prepare(`SELECT kind FROM pipeline_events WHERE entry_id = ? AND kind = 'github_evidence_attached'`)
    .all(id) as { kind: string }[];
  d.close();
  assert.equal(events.length, 1);
});

test("listPipeline carries githubHandle AND attached evidence onto the board payload", () => {
  // Pins the listPipeline SELECT columns — the drawer can only offer the
  // deep-dive (and render its result) if both fields ride the board payload.
  const { id } = seed("octocat");
  setEntryGithubEvidence(id, JSON.stringify(summary("octocat")));
  const row = listPipeline().find((e) => e.id === id);
  assert.ok(row, "seeded entry must be on the active board");
  assert.equal(row?.githubHandle, "octocat");
  assert.equal(row?.githubEvidence?.username, "octocat");
});
