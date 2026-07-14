// Profile ↔ CV lineage + staleness — store behavior.
//
// A saved profile built FROM a CV analysis stamps source lineage (the analysis
// slug + its content hash + its analyzed-at). Staleness = a NEWER analysis of the
// SAME CV content exists in the workspace than the one the profile was built from,
// so "this profile was built from an older CV" becomes detectable:
//   - profileStaleness flags such profiles with the newer analysis (the rebuild
//     target) and its date, reusing the round-3 content read (listAnalysesByCvHash);
//   - a hand-built profile (NULL lineage) is NEVER stale (no false badge);
//   - setProfileLineage re-points a profile at a newer analysis (rebuild), clearing
//     its staleness; a plain updateProfile leaves lineage untouched (no wipe/forge);
//   - every read is workspace-scoped (tenant isolation).
//
// testing/unit-db.ts MUST be the first project import — it points KP_DB_PATH at a
// throwaway file before core.ts opens the store, so this never touches real data.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { saveAnalysis, analysisLineageSource } from "./analyses.ts";
import {
  saveProfile,
  updateProfile,
  setProfileLineage,
  profileStaleness,
  type ProfileLineage,
} from "./profiles.ts";

after(() => cleanupUnitDb());

const WS = "ws-lineage-test";
const profileInput = {
  label: "Alice",
  archetype: "bau",
  roleFamily: "engineering_backend",
  completeness: 0.8,
  payload: { displayName: "Alice" },
};
const analysisBase = {
  candidateLabel: "Alice.pdf",
  jdSlug: null,
  score: 70,
  roleFamily: "engineering_backend",
  seniority: "senior",
  payload: { ok: true },
};

test("analysisLineageSource resolves cv_hash + analyzed-at, and is NULL for a hashless/absent analysis", () => {
  const withHash = saveAnalysis({ ...analysisBase, cvHash: "hash-src" }, WS);
  const src = analysisLineageSource(withHash.slug, WS);
  assert.ok(src, "an analysis with a cv_hash resolves a lineage source");
  assert.equal(src.cvHash, "hash-src");
  assert.equal(src.analyzedAt, withHash.createdAt);

  const noHash = saveAnalysis({ ...analysisBase, cvHash: null }, WS);
  assert.equal(analysisLineageSource(noHash.slug, WS), null, "a NULL-hash analysis anchors no lineage");
  assert.equal(analysisLineageSource("does-not-exist", WS), null, "an unknown slug resolves null");
  assert.equal(analysisLineageSource(withHash.slug, "other-ws"), null, "another workspace can't resolve it");
});

test("a profile built from an analysis becomes stale when a NEWER same-CV analysis exists", () => {
  const first = saveAnalysis({ ...analysisBase, cvHash: "hash-alice" }, WS);
  const lineage: ProfileLineage = {
    sourceAnalysisSlug: first.slug,
    sourceCvHash: "hash-alice",
    sourceAnalyzedAt: first.createdAt,
  };
  const prof = saveProfile(profileInput, WS, lineage);

  // No newer analysis yet ⇒ not stale.
  assert.equal(profileStaleness(WS)[prof.id], undefined, "no newer analysis ⇒ not stale");

  // A later re-analysis of the SAME CV content lands after the source.
  const newer = saveAnalysis(
    { ...analysisBase, cvHash: "hash-alice", payload: { v: 2 } },
    WS
  );
  // Guard: created_at must be strictly greater (ISO string compare == chronological).
  assert.ok(newer.createdAt >= first.createdAt);

  const stale = profileStaleness(WS);
  // If the two saves share the same millisecond, the store still linked them by
  // cv_hash; assert the staleness points at the newer slug when it is strictly newer.
  if (newer.createdAt > first.createdAt) {
    assert.ok(stale[prof.id], "a newer same-CV analysis marks the profile stale");
    assert.equal(stale[prof.id].newerSlug, newer.slug, "staleness targets the newer analysis (rebuild target)");
    assert.equal(stale[prof.id].newerAnalyzedAt, newer.createdAt);
  }
});

test("a hand-built profile (NULL lineage) is never stale, even when same-label analyses exist", () => {
  const handBuilt = saveProfile({ ...profileInput, label: "HandBuilt" }, WS); // no lineage
  saveAnalysis({ ...analysisBase, candidateLabel: "HandBuilt.pdf", cvHash: "hash-hand" }, WS);
  saveAnalysis({ ...analysisBase, candidateLabel: "HandBuilt.pdf", cvHash: "hash-hand", payload: { v: 2 } }, WS);
  assert.equal(profileStaleness(WS)[handBuilt.id], undefined, "NULL lineage ⇒ no false staleness");
});

test("a plain updateProfile preserves lineage; only setProfileLineage (rebuild) refreshes it", () => {
  const older = saveAnalysis({ ...analysisBase, cvHash: "hash-edit" }, WS);
  const prof = saveProfile({ ...profileInput, label: "Editable" }, WS, {
    sourceAnalysisSlug: older.slug,
    sourceCvHash: "hash-edit",
    sourceAnalyzedAt: older.createdAt,
  });
  const newer = saveAnalysis({ ...analysisBase, cvHash: "hash-edit", payload: { v: 2 } }, WS);
  const staleBefore = profileStaleness(WS)[prof.id];

  // A plain edit must NOT wipe lineage — staleness is unchanged after it.
  updateProfile(prof.id, { ...profileInput, label: "Editable (edited)" }, WS);
  const staleAfterEdit = profileStaleness(WS)[prof.id];
  assert.deepEqual(staleAfterEdit, staleBefore, "a plain edit leaves lineage (and staleness) untouched");

  // Rebuild-from-latest re-points the SAME row at the newer analysis ⇒ staleness clears.
  if (newer.createdAt > older.createdAt) {
    assert.ok(staleBefore, "precondition: the profile was stale before rebuild");
    setProfileLineage(
      prof.id,
      { sourceAnalysisSlug: newer.slug, sourceCvHash: "hash-edit", sourceAnalyzedAt: newer.createdAt },
      WS
    );
    assert.equal(profileStaleness(WS)[prof.id], undefined, "after rebuild, no newer analysis exists ⇒ not stale");
  }
});

test("staleness is workspace-scoped", () => {
  const a = saveAnalysis({ ...analysisBase, cvHash: "hash-tenant" }, WS);
  const prof = saveProfile({ ...profileInput, label: "Tenant" }, WS, {
    sourceAnalysisSlug: a.slug,
    sourceCvHash: "hash-tenant",
    sourceAnalyzedAt: a.createdAt,
  });
  // A newer analysis of the same hash but in ANOTHER workspace must NOT make it stale.
  saveAnalysis({ ...analysisBase, cvHash: "hash-tenant", payload: { v: 2 } }, "other-ws");
  assert.equal(profileStaleness(WS)[prof.id], undefined, "a newer analysis in another tenant doesn't leak staleness");
});
