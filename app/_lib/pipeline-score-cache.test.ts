// Per-workspace, short-TTL memo for canonical-score resolution (perfect-board).
// Proves: (1) the payload shape is byte-identical to withCanonicalScores, (2) the
// fit map is memoized within the TTL and recomputed after it (injectable clock, no
// wall-clock sleep — the analytics-cache idiom), (3) two workspaces never share a
// memo. The board poll otherwise re-ran the analyses query every 30s.
//
// unit-db.ts MUST be the first project import (sets KP_DB_PATH before any store
// module resolves db-path.ts).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry, listPipeline } from "./db/pipeline.ts";
import { saveAnalysis } from "./db/analyses.ts";
import { withCanonicalScores } from "./match-score-resolve.ts";
import { createCachedScoreResolver } from "./pipeline-score-cache.ts";

after(() => cleanupUnitDb());

test("cached resolver produces the SAME payload shape + values as withCanonicalScores", () => {
  createPipelineEntry({ candidateId: "sc-1", candidateLabel: "Ann Novak", jobId: "jd-role-a", jobTitle: "Role A", matchScore: 55, workspaceId: "ws-shape" });
  const entries = listPipeline("ws-shape");
  const direct = withCanonicalScores(entries, "ws-shape");

  const resolver = createCachedScoreResolver();
  const cached = resolver.withCanonicalScores(entries, "ws-shape");

  assert.deepEqual(cached, direct, "cached output is identical to the uncached path");
  assert.ok("canonicalScore" in cached[0] && "scoreProvenance" in cached[0], "the canonical fields ride along");
});

test("the fit map is served from the memo within the TTL, then recomputed after it", () => {
  // A JD-backed entry: jobId `jd-<slug>` so a saved analysis on that slug is the
  // job-matched fit the canonical precedence prefers over the snapshot score.
  createPipelineEntry({ candidateId: "sc-2", candidateLabel: "Bo Li", jobId: "jd-ttl", jobTitle: "TTL Role", matchScore: 40, workspaceId: "ws-ttl" });
  const entries = listPipeline("ws-ttl");

  let clock = 0;
  const resolver = createCachedScoreResolver({ ttlMs: 1000, now: () => clock });

  // t=0: no analysis yet → canonical score falls back to the snapshot (40). This
  // caches the (empty) fit map for the TTL window.
  const first = resolver.withCanonicalScores(entries, "ws-ttl");
  assert.equal(first[0].canonicalScore, 40, "with no analysis, canonical = snapshot");

  // A fresh job-matched analysis lands mid-window.
  saveAnalysis({ candidateLabel: "Bo Li", jdSlug: "ttl", score: 91, roleFamily: null, seniority: null, payload: {} }, "ws-ttl");

  // t=500 (< TTL): served from the memo — the new analysis is NOT yet reflected.
  clock = 500;
  const stale = resolver.withCanonicalScores(entries, "ws-ttl");
  assert.equal(stale[0].canonicalScore, 40, "within the TTL the cached fit map is reused (no re-query)");

  // t=1500 (> TTL): recomputed — the analysis fit now wins the precedence.
  clock = 1500;
  const fresh = resolver.withCanonicalScores(entries, "ws-ttl");
  assert.equal(fresh[0].canonicalScore, 91, "past the TTL the fit map is rebuilt and the analysis surfaces");
});

test("the memo never crosses tenants", () => {
  createPipelineEntry({ candidateId: "sc-a", candidateLabel: "Cara", jobId: "jd-x", jobTitle: "X", matchScore: 30, workspaceId: "ws-x" });
  createPipelineEntry({ candidateId: "sc-b", candidateLabel: "Cara", jobId: "jd-x", jobTitle: "X", matchScore: 30, workspaceId: "ws-y" });

  const resolver = createCachedScoreResolver({ ttlMs: 100_000, now: () => 0 });
  // Warm ws-x's memo, then give ws-y a Cara/x analysis. ws-x must not inherit it.
  resolver.withCanonicalScores(listPipeline("ws-x"), "ws-x");
  saveAnalysis({ candidateLabel: "Cara", jdSlug: "x", score: 88, roleFamily: null, seniority: null, payload: {} }, "ws-y");

  const y = resolver.withCanonicalScores(listPipeline("ws-y"), "ws-y");
  assert.equal(y[0].canonicalScore, 88, "ws-y sees its own analysis");
  const x = resolver.withCanonicalScores(listPipeline("ws-x"), "ws-x");
  assert.equal(x[0].canonicalScore, 30, "ws-x's memo never inherited ws-y's fit");
});
