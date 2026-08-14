// The command palette (⌘K) searches five tables at once. `searchEntities` has
// always TAKEN a workspaceId — the route threaded it in correctly — but bound it
// for `pipeline_entries` only. Profiles, jobs, JDs and analyses accepted the
// argument and ignored it, so two typed letters returned another team's candidate
// profiles, analysis scores and JD drafts, each hit deep-linking to the record.
//
// This pins BOTH halves of the contract, because they differ per table and
// copying the wrong one silently re-opens the leak:
//   profiles / jds / analyses  team-private → strict workspace_id = ?
//   jobs                       dual-tier → NULL rows are the shared cross-company
//                              corpus and MUST stay visible to every team
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { ensureDb } from "./core.ts";
import { searchEntities } from "./analytics.ts";
import { createPipelineEntry } from "./pipeline.ts";
import { saveProfile } from "./profiles.ts";
import { saveJd } from "./jobs.ts";
import { saveAnalysis } from "./analyses.ts";
import { insertJob } from "../job-ingest.ts";
import { DEFAULT_WORKSPACE_ID } from "./workspaces.ts";

after(() => cleanupUnitDb());

const WS_A = DEFAULT_WORKSPACE_ID;
const WS_B = "team-search-b";
// A nonsense token, so nothing here can collide with the seeded ČS corpus.
const MARK = "Zzqweel";

function seed(ws: string, tag: string) {
  saveProfile({ label: `${MARK} Profile ${tag}`, archetype: "bau", roleFamily: null, completeness: null, payload: {} }, ws);
  saveJd({ title: `${MARK} JD ${tag}`, body: "# body" }, ws);
  saveAnalysis(
    { candidateLabel: `${MARK} Candidate ${tag}`, jdSlug: null, score: 70, roleFamily: null, seniority: null, payload: {} },
    ws
  );
  insertJob({ id: `${MARK.toLowerCase()}-job-${tag}`, title: `${MARK} Role ${tag}` }, undefined, "published", ws);
  createPipelineEntry({
    candidateId: `${MARK}-c-${tag}`,
    candidateLabel: `${MARK} Entry ${tag}`,
    jobId: `${MARK.toLowerCase()}-job-${tag}`,
    jobTitle: `${MARK} Role ${tag}`,
    contact: `${tag}@example.com`,
    workspaceId: ws,
  });
}

seed(WS_A, "A");
seed(WS_B, "B");

/** Which team's rows (A / B) show up among hits of one type. */
function tagsFor(ws: string, type: string): string[] {
  return searchEntities(MARK, 20, ws)
    .filter((h) => h.type === type)
    .map((h) => h.label.slice(-1))
    .sort();
}

test("team-private types are visible to their own team only", () => {
  for (const type of ["profile", "jd", "analysis", "entry"]) {
    assert.deepEqual(tagsFor(WS_A, type), ["A"], `${type}: team A must see only its own`);
    assert.deepEqual(tagsFor(WS_B, type), ["B"], `${type}: team B must see only its own`);
  }
});

test("jobs stay dual-tier: own rows plus the shared NULL-workspace corpus", () => {
  assert.deepEqual(tagsFor(WS_A, "job"), ["A"], "team A sees its own opening");
  assert.deepEqual(tagsFor(WS_B, "job"), ["B"], "team B sees its own opening, not A's");

  // A corpus row (workspace_id NULL) is the cross-company reference every team
  // matches against — narrowing this query must not hide it. No helper can write
  // NULL, so demote a row directly, exactly as the seed migration leaves them.
  insertJob({ id: `${MARK.toLowerCase()}-job-corpus`, title: `${MARK} Role Corpus` }, undefined, "published", WS_A);
  ensureDb().prepare(`UPDATE jobs SET workspace_id = NULL WHERE id = ?`).run(`${MARK.toLowerCase()}-job-corpus`);

  for (const ws of [WS_A, WS_B]) {
    const titles = searchEntities(MARK, 20, ws).filter((h) => h.type === "job").map((h) => h.label);
    assert.ok(titles.includes(`${MARK} Role Corpus`), `${ws} must still see the shared corpus row`);
  }
});

test("an unknown workspace matches nothing team-private — the filter is real, not decorative", () => {
  const hits = searchEntities(MARK, 20, "team-that-does-not-exist").filter((h) => h.type !== "job");
  assert.deepEqual(hits, [], "no team-private hit may survive an unmatched tenant");
});
