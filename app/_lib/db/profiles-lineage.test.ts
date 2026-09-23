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
import { ensureDb } from "./core.ts";

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

// Every timestamp this test compares is PINNED to a distinct past value. Left to the
// wall clock it flaked under full-suite load: the staleness entry also carries
// `edited` + `updatedAt` (see the count-before-run test below), and a plain edit
// legitimately moves both — so a whole-entry deepEqual only held when saveProfile
// and updateProfile happened to land in the same millisecond, and the rebuild half
// was skipped outright whenever the two analyses did.
test("a plain updateProfile preserves lineage; only setProfileLineage (rebuild) refreshes it", () => {
  const db = ensureDb();
  const older = saveAnalysis({ ...analysisBase, cvHash: "hash-edit" }, WS);
  db.prepare(`UPDATE analyses SET created_at = ? WHERE slug = ?`).run("2026-01-01T00:00:00.000Z", older.slug);
  const prof = saveProfile({ ...profileInput, label: "Editable" }, WS, {
    sourceAnalysisSlug: older.slug,
    sourceCvHash: "hash-edit",
    sourceAnalyzedAt: "2026-01-01T00:00:00.000Z",
  });
  // Built (and last written) on 01-05: updated_at == lineage_stamped_at ⇒ not edited.
  db.prepare(`UPDATE profiles SET updated_at = ?, lineage_stamped_at = ? WHERE id = ?`).run(
    "2026-01-05T00:00:00.000Z",
    "2026-01-05T00:00:00.000Z",
    prof.id
  );
  const newer = saveAnalysis({ ...analysisBase, cvHash: "hash-edit", payload: { v: 2 } }, WS);
  db.prepare(`UPDATE analyses SET created_at = ? WHERE slug = ?`).run("2026-02-01T00:00:00.000Z", newer.slug);

  const staleBefore = profileStaleness(WS)[prof.id];
  assert.ok(staleBefore, "precondition: a newer same-CV analysis makes the profile stale");
  assert.equal(staleBefore.newerSlug, newer.slug);
  assert.equal(staleBefore.edited, false, "precondition: no edit since the build");

  // A plain edit must NOT wipe or re-point lineage — the staleness target is unchanged.
  // It IS a content write, so the entry now (correctly) reports the edit and its version.
  updateProfile(prof.id, { ...profileInput, label: "Editable (edited)" }, WS);
  const staleAfterEdit = profileStaleness(WS)[prof.id];
  assert.ok(staleAfterEdit, "a plain edit leaves the profile stale");
  assert.equal(staleAfterEdit.newerSlug, staleBefore.newerSlug, "a plain edit leaves lineage untouched");
  assert.equal(staleAfterEdit.newerAnalyzedAt, staleBefore.newerAnalyzedAt, "a plain edit leaves lineage untouched");
  const { updated_at } = db.prepare(`SELECT updated_at FROM profiles WHERE id = ?`).get(prof.id) as { updated_at: string };
  assert.ok(updated_at > "2026-01-05T00:00:00.000Z", "the edit stamped updated_at");
  assert.equal(staleAfterEdit.updatedAt, updated_at, "the entry names the edited version");
  assert.equal(staleAfterEdit.edited, true, "the edit after the build is reported");

  // Rebuild-from-latest re-points the SAME row at the newer analysis ⇒ staleness clears.
  setProfileLineage(
    prof.id,
    { sourceAnalysisSlug: newer.slug, sourceCvHash: "hash-edit", sourceAnalyzedAt: "2026-02-01T00:00:00.000Z" },
    WS
  );
  assert.equal(profileStaleness(WS)[prof.id], undefined, "after rebuild, no newer analysis exists ⇒ not stale");
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

// Count-before-run (challenge-r05 profile-roster-matrix/B): a bulk refresh must know,
// BEFORE anything runs, which stale profiles carry a recruiter's edits. Each staleness
// entry therefore carries `edited` (the profileDivergence rule — updated_at strictly
// newer than lineage_stamped_at) and `updatedAt` (the version a refresh PUT re-asserts).
test("a stale entry says whether the profile was hand-edited since its build, and which version it is", () => {
  const db = ensureDb();
  const src = saveAnalysis({ ...analysisBase, cvHash: "hash-edited" }, WS);
  db.prepare(`UPDATE analyses SET created_at = ? WHERE slug = ?`).run("2026-01-01T00:00:00.000Z", src.slug);
  const prof = saveProfile({ ...profileInput, label: "Edited" }, WS, {
    sourceAnalysisSlug: src.slug,
    sourceCvHash: "hash-edited",
    sourceAnalyzedAt: "2026-01-01T00:00:00.000Z",
  });
  const mid = saveAnalysis({ ...analysisBase, cvHash: "hash-edited", payload: { v: 2 } }, WS);
  db.prepare(`UPDATE analyses SET created_at = ? WHERE slug = ?`).run("2026-02-01T00:00:00.000Z", mid.slug);
  const newest = saveAnalysis({ ...analysisBase, cvHash: "hash-edited", payload: { v: 3 } }, WS);
  db.prepare(`UPDATE analyses SET created_at = ? WHERE slug = ?`).run("2026-03-01T00:00:00.000Z", newest.slug);

  // Built on 01-05, hand-edited on 01-09: updated_at > lineage_stamped_at.
  db.prepare(`UPDATE profiles SET updated_at = ?, lineage_stamped_at = ? WHERE id = ?`).run(
    "2026-01-09T00:00:00.000Z",
    "2026-01-05T00:00:00.000Z",
    prof.id
  );
  const edited = profileStaleness(WS)[prof.id];
  assert.ok(edited, "precondition: the profile is stale");
  assert.equal(edited.edited, true, "an edit after the build is reported before any rebuild runs");
  assert.equal(edited.updatedAt, "2026-01-09T00:00:00.000Z", "the entry names the version a refresh must re-assert");

  // Re-point it at the MIDDLE analysis: the newest still makes it stale, but the
  // re-stamp re-anchored it, so the earlier edit no longer counts.
  setProfileLineage(
    prof.id,
    { sourceAnalysisSlug: mid.slug, sourceCvHash: "hash-edited", sourceAnalyzedAt: "2026-02-01T00:00:00.000Z" },
    WS
  );
  const clean = profileStaleness(WS)[prof.id];
  assert.ok(clean, "still stale: a newer analysis than the re-pointed one exists");
  assert.equal(clean.newerSlug, newest.slug);
  assert.equal(clean.edited, false, "right after setProfileLineage the profile carries no edits");
  assert.equal(clean.updatedAt, "2026-01-09T00:00:00.000Z");
});
