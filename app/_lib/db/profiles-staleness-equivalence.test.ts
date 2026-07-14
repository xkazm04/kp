// profileStaleness single-query equivalence.
//
// profileStaleness used to run an N+1: one listAnalysesByCvHash per lineage-bearing
// profile, on EVERY GET /api/profile. It is now a single join. This proves the two
// are IDENTICAL on a seeded fixture by re-implementing the OLD per-profile loop
// inline (the reference oracle) and asserting deepEqual against the live function —
// across the tricky cases: multiple newer analyses (newest wins), a same-CV analysis
// that is OLDER than the source (not stale), a hand-built NULL-lineage profile
// (never stale), and a newer analysis in ANOTHER workspace (no cross-tenant leak).
//
// testing/unit-db.ts MUST be the first project import — it points KP_DB_PATH at a
// throwaway file before core.ts opens the store, so this never touches real data.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { saveAnalysis, listAnalysesByCvHash } from "./analyses.ts";
import { saveProfile, profileStaleness, type ProfileStaleness } from "./profiles.ts";
import { ensureDb } from "./core.ts";

after(() => cleanupUnitDb());

const WS = "ws-stale-equiv";

const profileInput = {
  label: "P",
  archetype: "bau",
  roleFamily: "engineering_backend",
  completeness: 0.8,
  payload: { displayName: "P" },
};
const analysisBase = {
  candidateLabel: "cv.pdf",
  jdSlug: null,
  score: 70,
  roleFamily: "engineering_backend",
  seniority: "senior",
  payload: { ok: true },
};

// The OLD algorithm, verbatim: for each lineage profile, take the newest same-CV
// analysis (≠ the source slug) and keep it only if it is strictly newer than the
// source's analyzed-at. This is the oracle the single query must match.
function oldLoopStaleness(workspaceId: string): Record<string, ProfileStaleness> {
  const db = ensureDb();
  const lineageRows = db
    .prepare(
      `SELECT id, source_analysis_slug, source_cv_hash, source_analyzed_at
       FROM profiles
       WHERE workspace_id = ? AND source_cv_hash IS NOT NULL AND source_analyzed_at IS NOT NULL`
    )
    .all(workspaceId) as {
    id: string;
    source_analysis_slug: string | null;
    source_cv_hash: string;
    source_analyzed_at: string;
  }[];
  const out: Record<string, ProfileStaleness> = {};
  for (const r of lineageRows) {
    const newer = listAnalysesByCvHash(r.source_cv_hash, workspaceId, r.source_analysis_slug ?? undefined, 1).find(
      (a) => a.created_at > r.source_analyzed_at
    );
    if (newer) out[r.id] = { newerSlug: newer.slug, newerAnalyzedAt: newer.created_at };
  }
  return out;
}

// saveAnalysis stamps created_at = now(); force strictly-ordered timestamps so the
// fixture has no ambiguous ties (the old LIMIT-1 tiebreak was arbitrary).
function stampCreatedAt(slug: string, iso: string) {
  ensureDb().prepare(`UPDATE analyses SET created_at = ? WHERE slug = ?`).run(iso, slug);
}

test("single-query profileStaleness is identical to the old per-profile loop on a mixed fixture", () => {
  // Profile 1: two NEWER same-CV analyses exist → stale, pointing at the NEWEST.
  const src1 = saveAnalysis({ ...analysisBase, cvHash: "hash-1" }, WS);
  stampCreatedAt(src1.slug, "2026-01-01T00:00:00.000Z");
  const p1 = saveProfile({ ...profileInput, label: "P1" }, WS, {
    sourceAnalysisSlug: src1.slug,
    sourceCvHash: "hash-1",
    sourceAnalyzedAt: "2026-01-01T00:00:00.000Z",
  });
  const mid1 = saveAnalysis({ ...analysisBase, cvHash: "hash-1", payload: { v: 2 } }, WS);
  stampCreatedAt(mid1.slug, "2026-02-01T00:00:00.000Z");
  const new1 = saveAnalysis({ ...analysisBase, cvHash: "hash-1", payload: { v: 3 } }, WS);
  stampCreatedAt(new1.slug, "2026-03-01T00:00:00.000Z");

  // Profile 2: the only OTHER same-CV analysis is OLDER than the source → NOT stale.
  const src2 = saveAnalysis({ ...analysisBase, cvHash: "hash-2" }, WS);
  stampCreatedAt(src2.slug, "2026-05-01T00:00:00.000Z");
  const older2 = saveAnalysis({ ...analysisBase, cvHash: "hash-2", payload: { v: 0 } }, WS);
  stampCreatedAt(older2.slug, "2026-04-01T00:00:00.000Z");
  saveProfile({ ...profileInput, label: "P2" }, WS, {
    sourceAnalysisSlug: src2.slug,
    sourceCvHash: "hash-2",
    sourceAnalyzedAt: "2026-05-01T00:00:00.000Z",
  });

  // Profile 3: hand-built, NULL lineage → never appears.
  saveProfile({ ...profileInput, label: "P3" }, WS);

  // Profile 4: a newer same-CV analysis exists but in ANOTHER workspace → not stale here.
  const src4 = saveAnalysis({ ...analysisBase, cvHash: "hash-4" }, WS);
  stampCreatedAt(src4.slug, "2026-06-01T00:00:00.000Z");
  const other4 = saveAnalysis({ ...analysisBase, cvHash: "hash-4", payload: { v: 9 } }, "ws-other");
  stampCreatedAt(other4.slug, "2026-07-01T00:00:00.000Z");
  saveProfile({ ...profileInput, label: "P4" }, WS, {
    sourceAnalysisSlug: src4.slug,
    sourceCvHash: "hash-4",
    sourceAnalyzedAt: "2026-06-01T00:00:00.000Z",
  });

  const live = profileStaleness(WS);
  const oracle = oldLoopStaleness(WS);
  assert.deepEqual(live, oracle, "single query must match the per-profile loop exactly");

  // Spot-check the intent, not just self-consistency.
  assert.equal(live[p1.id]?.newerSlug, new1.slug, "P1 is stale, pointing at the NEWEST same-CV analysis");
  assert.equal(Object.keys(live).length, 1, "only P1 is stale; P2/P3/P4 are not");
});
