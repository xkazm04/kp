// Erasure destroys the CV's content identity, not just its PII.
//
// cv_hash (SHA-256 of the CV bytes) is a pseudonymous identifier: it links every
// record holding the same file. anonymizeEntry scrubbed the linked analyses' label
// and payload but left analyses.cv_hash, and anonymizeProfile left
// profiles.source_cv_hash. The same file uploaded again after an erasure then
// joined straight back to the erased record: the footprint listed the scrubbed
// analysis, a profile build for the new upload was refused as "already exists" and
// pointed at the erased profile, and the staleness join offered to rebuild the
// erased profile from the new analysis. Registry: candidate-identity-and-staleness /
// content-addressed-document-identity ("it does not survive anonymisation, and
// must not").
//
// testing/unit-db.ts MUST stay the first project import.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { saveAnalysis, listAnalysesByCvHash } from "./analyses.ts";
import { saveProfile, findProfileIdBySourceCvHash, profileStaleness } from "./profiles.ts";
import { anonymizeEntry, createPipelineEntry } from "./pipeline.ts";
import { ensureDb } from "./core.ts";

after(() => cleanupUnitDb());

const W = "ws-anon-cv-identity";
const HASH = "hash-erased-cv";
const base = { score: 70, roleFamily: "engineering_backend", seniority: "senior", payload: { candidate: { name: "Jana Novakova" } } };

function eraseOneCandidate() {
  const analysis = saveAnalysis({ ...base, candidateLabel: "Jana Novakova", jdSlug: "jd-anon-1", cvHash: HASH }, W);
  const profile = saveProfile(
    { label: "Jana Novakova", archetype: "backend", roleFamily: null, completeness: 60, payload: { displayName: "Jana Novakova" } },
    W,
    { sourceAnalysisSlug: analysis.slug, sourceCvHash: HASH, sourceAnalyzedAt: analysis.createdAt }
  );
  const { entry } = createPipelineEntry({
    candidateId: profile.id,
    candidateLabel: "Jana Novakova",
    jobId: "job-anon-1",
    jobTitle: "Backend engineer",
    stage: "Accepted",
    workspaceId: W,
  });
  const erased = anonymizeEntry(entry.id, "erasure", W);
  assert.ok(erased?.anonymizedAt, "precondition: the entry is anonymized");
  return { analysis, profile };
}

const { analysis, profile } = eraseOneCandidate();

test("the scrubbed analysis no longer carries the CV's content hash", () => {
  const row = ensureDb().prepare(`SELECT cv_hash FROM analyses WHERE slug = ?`).get(analysis.slug) as { cv_hash: string | null };
  assert.equal(row.cv_hash, null);
});

test("the anonymized profile no longer carries the CV's content hash", () => {
  const row = ensureDb()
    .prepare(`SELECT source_cv_hash FROM profiles WHERE id = ? AND workspace_id = ?`)
    .get(profile.id, W) as { source_cv_hash: string | null };
  assert.equal(row.source_cv_hash, null);
});

test("the same file uploaded after erasure does not join back to the erased record", () => {
  const again = saveAnalysis({ ...base, candidateLabel: "cv.pdf", jdSlug: "jd-anon-2", cvHash: HASH }, W);
  // Footprint: no "also analyzed" link to the scrubbed analysis.
  assert.deepEqual(
    listAnalysesByCvHash(HASH, W, again.slug).map((r) => r.slug),
    [],
    "the footprint must not list the erased candidate's analysis"
  );
  // Profile build: not refused as "already exists" onto the erased profile.
  assert.equal(findProfileIdBySourceCvHash(HASH, W), null);
  // Staleness: the erased profile is not offered a rebuild from the new analysis.
  assert.equal(Object.hasOwn(profileStaleness(W), profile.id), false);
});
