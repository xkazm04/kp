// Pins the per-match reasoning cache-KEY contract (idea-80d2c57e): the job is
// content-addressed, not keyed by id alone. The reasoning text literally quotes
// the job's must-have and the candidate's missing skills, so editing a job's
// requirements/title in place (same id) must change the key — otherwise the
// pre-edit verdict is served stale for the full 168h TTL. These tests lock that
// the job axis is now symmetric with the already-content-addressed profile axis.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { reasoningCacheKey, jobKeyPart } from "./reasoning-cache-key.ts";

const base = {
  promptVersion: "match-reasoning-v1",
  candidateKeyPart: "candidate:abc",
  jobId: "job-1",
  jobPayload: { id: "job-1", title: "Backend Engineer", requirements: ["Go", "SQL"] },
};

test("identical inputs hash identically (cache stays usable)", () => {
  assert.equal(reasoningCacheKey({ ...base }), reasoningCacheKey({ ...base }));
});

test("editing the job content (same id) changes the key — the staleness hole this closes", () => {
  const before = reasoningCacheKey({ ...base });
  const afterTitleEdit = reasoningCacheKey({
    ...base,
    jobPayload: { ...base.jobPayload, title: "Senior Backend Engineer" },
  });
  const afterReqEdit = reasoningCacheKey({
    ...base,
    jobPayload: { ...base.jobPayload, requirements: ["Go", "SQL", "Kubernetes"] },
  });
  assert.notEqual(before, afterTitleEdit);
  assert.notEqual(before, afterReqEdit);
  assert.notEqual(afterTitleEdit, afterReqEdit);
});

test("each axis independently affects the key", () => {
  const k0 = reasoningCacheKey({ ...base });
  assert.notEqual(k0, reasoningCacheKey({ ...base, promptVersion: "match-reasoning-v2" }));
  assert.notEqual(k0, reasoningCacheKey({ ...base, candidateKeyPart: "candidate:xyz" }));
  assert.notEqual(k0, reasoningCacheKey({ ...base, jobId: "job-2" }));
  assert.notEqual(k0, reasoningCacheKey({ ...base, jobPayload: { ...base.jobPayload, title: "X" } }));
});

test("MAT1 — the locale is an independent axis (no cross-language cache bleed)", () => {
  // An absent lang defaults to "en", so the legacy/no-lang caller is unchanged…
  assert.equal(reasoningCacheKey({ ...base }), reasoningCacheKey({ ...base, lang: "en" }));
  // …but a cs verdict keys differently, so it can never serve an en session.
  assert.notEqual(reasoningCacheKey({ ...base, lang: "en" }), reasoningCacheKey({ ...base, lang: "cs" }));
});

test("the corpus fingerprint is an independent axis — a verdict can't survive a corpus change", () => {
  // An absent fingerprint defaults to "", so the legacy/no-corpus caller is unchanged…
  assert.equal(reasoningCacheKey({ ...base }), reasoningCacheKey({ ...base, corpusFingerprint: undefined }));
  // …but a corpus-aware key differs from the legacy one, and corpus turnover
  // (a job ingested/removed → new fingerprint) re-keys again, so a verdict
  // computed against one job resolution never serves a different corpus state.
  const legacy = reasoningCacheKey({ ...base });
  const fpA = reasoningCacheKey({ ...base, corpusFingerprint: "fp-a" });
  const fpB = reasoningCacheKey({ ...base, corpusFingerprint: "fp-b" });
  assert.notEqual(legacy, fpA);
  assert.notEqual(fpA, fpB);
});

test("an unresolvable job (null payload) degrades to an id-only key rather than blocking", () => {
  assert.equal(jobKeyPart("job-1", null), "job:job-1");
  assert.equal(jobKeyPart("job-1", undefined), "job:job-1");
  // Two different unresolvable jobs still produce distinct keys.
  assert.notEqual(
    reasoningCacheKey({ ...base, jobPayload: null }),
    reasoningCacheKey({ ...base, jobId: "job-2", jobPayload: null })
  );
});

test("a resolved job key is content-addressed: id plus a content hash", () => {
  const part = jobKeyPart("job-1", base.jobPayload);
  assert.match(part, /^job:job-1:[0-9a-f]{64}$/);
  // Same content → same part (deterministic); changed content → different part.
  assert.equal(part, jobKeyPart("job-1", { ...base.jobPayload }));
  assert.notEqual(part, jobKeyPart("job-1", { ...base.jobPayload, title: "Other" }));
});

test("the resolved job key is distinct from the id-only fallback for the same id", () => {
  // Guards against a resolved record ever colliding with the degraded form.
  assert.notEqual(jobKeyPart("job-1", base.jobPayload), jobKeyPart("job-1", null));
});
