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
import { createCachedScoreResolver, scoreCacheKey } from "./pipeline-score-cache.ts";
import { invalidateAnalyticsWorkspace } from "./analytics-cache.ts";

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

test("an analytics settings write leaves the score memo intact", () => {
  // The regression this memo's split from analytics-cache closes. It used to be built
  // on `createAnalyticsCache`, whose key carries a per-workspace ANALYTICS write
  // version — so saving a conversion goal or a channel spend figure on the Insights
  // tab (both call invalidateAnalyticsWorkspace) named a key nothing had stored and
  // the next board poll re-ran buildFreshestFits() for a write about neither scores
  // nor analyses. Fresh is not wrong, but it is a full analyses re-query per settings
  // save, and the two subsystems share no data at all.
  createPipelineEntry({ candidateId: "sc-inv", candidateLabel: "Dana", jobId: "jd-inv", jobTitle: "Inv Role", matchScore: 44, workspaceId: "ws-inv" });
  const entries = listPipeline("ws-inv");

  const resolver = createCachedScoreResolver({ ttlMs: 100_000, now: () => 0 });
  assert.equal(resolver.withCanonicalScores(entries, "ws-inv")[0].canonicalScore, 44, "warm the memo");

  // An analysis lands, then the analytics write door fires. If the score memo still
  // rode the analytics write version, the bump would retire it and the new analysis
  // would surface immediately — which is exactly how we detect the shared key.
  saveAnalysis({ candidateLabel: "Dana", jdSlug: "inv", score: 97, roleFamily: null, seniority: null, payload: {} }, "ws-inv");
  invalidateAnalyticsWorkspace("ws-inv");

  assert.equal(
    resolver.withCanonicalScores(entries, "ws-inv")[0].canonicalScore,
    44,
    "the analytics write did not retire the score memo — it is served for its own TTL"
  );
});

test("the score memo key is the workspace and nothing else", () => {
  assert.notEqual(scoreCacheKey("ws-a"), scoreCacheKey("ws-b"));
  assert.equal(scoreCacheKey("ws-a"), scoreCacheKey("ws-a"));
  // No analytics write version in the key: it is stable across a settings write.
  const before = scoreCacheKey("ws-stable");
  invalidateAnalyticsWorkspace("ws-stable");
  assert.equal(scoreCacheKey("ws-stable"), before);
});
