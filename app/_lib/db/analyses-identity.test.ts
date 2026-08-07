// Content-addressed candidate identity (cv_hash) — store behavior.
//
// Identity used to be the FILENAME: re-running the same CV against the same JD
// kept INSERTing fresh History rows, two "CV.pdf" uploads for different people
// collided, and one person under two filenames never linked. cv_hash (SHA-256 of
// the CV bytes, threaded from the analyze intake) makes identity content-addressed:
//   - listAnalyses collapses same-(cv_hash, jd) re-runs to the newest, reporting
//     prior_runs — WITHOUT deleting the older rows (they stay loadable by slug);
//   - listAnalysesByCvHash links the same CV's analyses against OTHER jobs;
//   - hasLabelCollision flags two different CVs sharing one filename-derived label;
//   - legacy NULL-cv_hash rows are never grouped (behavior-identical to before).
//
// testing/unit-db.ts MUST be the first project import — it points KP_DB_PATH at a
// throwaway file before core.ts opens the store, so this never touches real data.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  saveAnalysis,
  listAnalyses,
  listAnalysesByCvHash,
  hasLabelCollision,
  loadAnalysis,
} from "./analyses.ts";

after(() => cleanupUnitDb());

const WS = "ws-identity-test";
const base = {
  score: 70,
  roleFamily: "engineering_backend",
  seniority: "senior",
  payload: { ok: true },
};

test("re-running the same CV+JD collapses to the newest row with prior_runs, keeping older rows loadable", () => {
  const cvHash = "hash-alice";
  const first = saveAnalysis({ ...base, candidateLabel: "Alice.pdf", jdSlug: "jd-1", cvHash }, WS);
  const second = saveAnalysis({ ...base, candidateLabel: "Alice.pdf", jdSlug: "jd-1", cvHash }, WS);
  const third = saveAnalysis({ ...base, candidateLabel: "Alice.pdf", jdSlug: "jd-1", cvHash }, WS);

  const rows = listAnalyses(100, WS);
  const group = rows.filter((r) => r.cv_hash === cvHash && r.jd_slug === "jd-1");
  // Only the newest of the three appears in the list…
  assert.equal(group.length, 1, "same (cv_hash, jd) re-runs collapse to one list row");
  assert.equal(group[0].slug, third.slug, "the newest run wins the group");
  assert.equal(group[0].prior_runs, 2, "it supersedes the two earlier runs");

  // …but NO row was deleted — the earlier runs still resolve by slug.
  assert.ok(loadAnalysis(first.slug, WS), "older run 1 is not deleted");
  assert.ok(loadAnalysis(second.slug, WS), "older run 2 is not deleted");
});

test("same CV against a different JD is a separate group, not a supersede", () => {
  const cvHash = "hash-alice"; // same content as the group above
  const other = saveAnalysis({ ...base, candidateLabel: "Alice.pdf", jdSlug: "jd-2", cvHash }, WS);
  const rows = listAnalyses(100, WS);
  const jd2 = rows.find((r) => r.slug === other.slug);
  assert.ok(jd2, "a same-CV, different-JD run stands on its own in the list");
  assert.equal(jd2.prior_runs, 0);
});

test("listAnalysesByCvHash links the same CV's OTHER-job analyses (workspace-scoped)", () => {
  const links = listAnalysesByCvHash("hash-alice", WS, /* excludeSlug irrelevant */ "none");
  const jds = new Set(links.map((r) => r.jd_slug));
  assert.ok(jds.has("jd-1") && jds.has("jd-2"), "both jobs the CV was analyzed for are returned");
  // A different workspace sees nothing (tenant isolation).
  assert.equal(listAnalysesByCvHash("hash-alice", "other-ws").length, 0);
  // A NULL/empty hash links nothing.
  assert.equal(listAnalysesByCvHash(null, WS).length, 0);
});

test("hasLabelCollision flags two different CVs under one filename-derived label", () => {
  // A second, DIFFERENT person also uploaded as "Alice.pdf".
  saveAnalysis({ ...base, candidateLabel: "Alice.pdf", jdSlug: "jd-9", cvHash: "hash-someone-else" }, WS);
  assert.equal(hasLabelCollision("Alice.pdf", "hash-alice", WS), true, "same label, different hash → collision");
  assert.equal(hasLabelCollision("Alice.pdf", "hash-someone-else", WS), true);
  // A unique label doesn't collide; a NULL hash can't be judged.
  assert.equal(hasLabelCollision("Unique.pdf", "hash-alice", WS), false);
  assert.equal(hasLabelCollision("Alice.pdf", null, WS), false);
});

test("legacy NULL-cv_hash rows are never grouped and carry prior_runs 0", () => {
  const a = saveAnalysis({ ...base, candidateLabel: "Legacy.pdf", jdSlug: "jd-legacy", cvHash: null }, WS);
  const b = saveAnalysis({ ...base, candidateLabel: "Legacy.pdf", jdSlug: "jd-legacy", cvHash: null }, WS);
  const rows = listAnalyses(100, WS);
  const legacy = rows.filter((r) => r.slug === a.slug || r.slug === b.slug);
  assert.equal(legacy.length, 2, "NULL-hash rows are each kept (no grouping)");
  assert.ok(legacy.every((r) => r.prior_runs === 0));
});
