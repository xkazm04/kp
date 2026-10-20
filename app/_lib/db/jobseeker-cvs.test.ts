// The CV memory on an isolated DB: one row per (seeker, text), whitespace does not make
// a new CV, a re-read replaces the draft, last_used_at moves on reuse, the list carries
// no text, and making a CV active writes the profile the way an import does.
//
// unit-db.ts must be the first project import (it sets KP_DB_PATH before any store opens).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cvContentHash,
  findJobseekerCvByText,
  getJobseekerCv,
  isActiveCv,
  JOBSEEKER_CV_KEEP,
  listJobseekerCvs,
  makeJobseekerCvActive,
  recordJobseekerCv,
  touchJobseekerCv,
} from "./jobseeker-cvs.ts";
import { getJobseekerProfile, mergePreferences, upsertJobseekerProfile } from "./jobseeker-profiles.ts";
import { EMPTY_PREFERENCES } from "../jobseeker/types.ts";
import type { ProfilePayload } from "../../features/shared/profileTypes.ts";

after(() => cleanupUnitDb());

const draftOf = (name: string) => ({ displayName: name }) as unknown as ProfilePayload;
const pause = () => new Promise((r) => setTimeout(r, 5));

test("the content hash ignores whitespace layout but not words", () => {
  assert.equal(cvContentHash("Ada Lovelace\n\n  Engineer\t"), cvContentHash("Ada Lovelace Engineer"));
  assert.notEqual(cvContentHash("Ada Lovelace Engineer"), cvContentHash("Ada Lovelace Engineers"));
  assert.match(cvContentHash("x"), /^[0-9a-f]{64}$/);
});

test("the same text is one row per seeker; a re-read replaces its draft and moves last_used_at", async () => {
  const ws = "ws-unique";
  const first = recordJobseekerCv({ userId: null, sourceText: "Grace Hopper\nCOBOL", draft: draftOf("Grace"), draftSource: "deterministic", fileName: "grace.pdf", byteSize: 1234 }, ws);
  await pause();
  const again = recordJobseekerCv({ userId: null, sourceText: "Grace   Hopper COBOL  ", draft: draftOf("Grace H."), draftSource: "llm" }, ws);
  assert.equal(again.id, first.id, "whitespace-only differences are the same CV");
  assert.equal(again.draftSource, "llm");
  assert.equal((again.draft as unknown as { displayName: string }).displayName, "Grace H.");
  assert.equal(again.fileName, "grace.pdf", "an absent file name keeps the stored one");
  assert.equal(again.byteSize, 1234);
  assert.equal(again.createdAt, first.createdAt);
  assert.ok(again.lastUsedAt > first.lastUsedAt, "a re-read moves last_used_at");
  assert.equal(listJobseekerCvs(null, ws).length, 1);

  // A different seat on the same workspace keeps its own row for the same text.
  const other = recordJobseekerCv({ userId: "u-9", sourceText: "Grace Hopper COBOL", draft: draftOf("G"), draftSource: "llm" }, ws);
  assert.notEqual(other.id, first.id);
  assert.equal(listJobseekerCvs(null, ws).length, 1);
});

test("touch bumps last_used_at and reorders the list, newest use first", async () => {
  const ws = "ws-order";
  const a = recordJobseekerCv({ userId: "u-1", sourceText: "CV A", draft: draftOf("A"), draftSource: "llm", fileName: "a.pdf" }, ws);
  await pause();
  const b = recordJobseekerCv({ userId: "u-1", sourceText: "CV B", draft: draftOf("B"), draftSource: "llm", fileName: "b.pdf" }, ws);
  assert.deepEqual(listJobseekerCvs("u-1", ws).map((c) => c.id), [b.id, a.id]);
  await pause();
  assert.equal(touchJobseekerCv(a.id, "u-1", ws), true);
  const listed = listJobseekerCvs("u-1", ws);
  assert.deepEqual(listed.map((c) => c.id), [a.id, b.id]);
  assert.ok(listed[0]!.lastUsedAt > a.lastUsedAt);
  for (const row of listed) {
    assert.ok(!("sourceText" in row) && !("draft" in row), "the list is metadata only");
  }
});

test("the store keeps at most JOBSEEKER_CV_KEEP per seeker, dropping the least recently used", () => {
  const ws = "ws-keep";
  for (let i = 0; i < JOBSEEKER_CV_KEEP + 3; i++) {
    recordJobseekerCv({ userId: null, sourceText: `CV number ${i}`, draft: draftOf(`n${i}`), draftSource: "deterministic" }, ws);
  }
  assert.equal(listJobseekerCvs(null, ws).length, JOBSEEKER_CV_KEEP);
  assert.ok(findJobseekerCvByText(null, `CV number ${JOBSEEKER_CV_KEEP + 2}`, ws), "the newest survives");
});

test("making a CV active writes the profile as an import does, keeps preferences, and marks it active", async () => {
  const ws = "ws-active";
  upsertJobseekerProfile({ userId: null, profile: draftOf("Old"), preferences: EMPTY_PREFERENCES, cvSourceText: "Old CV" }, ws);
  const seeded = getJobseekerProfile(null, ws)!;
  mergePreferences(seeded.id, { targetTitles: ["AI Engineer"] }, ws);

  const older = recordJobseekerCv({ userId: null, sourceText: "Earlier CV\ntext", draft: draftOf("Earlier"), draftSource: "llm" }, ws);
  await pause();
  const { profile, cv: made } = makeJobseekerCvActive(getJobseekerCv(older.id, null, ws)!, null, ws);
  assert.equal(profile.id, seeded.id, "the same profile row, not a second one");
  assert.equal((profile.profile as unknown as { displayName: string }).displayName, "Earlier");
  assert.equal(profile.cvSourceText, "Earlier CV\ntext");
  assert.equal(profile.cvHash, createHash("sha256").update("Earlier CV\ntext", "utf8").digest("hex"), "the profile's cvHash keeps the import's raw-text rule");
  assert.deepEqual(profile.preferences.targetTitles, ["AI Engineer"], "preferences survive a CV switch");
  assert.ok(made.lastUsedAt > older.lastUsedAt, "activation answers the moved last_used_at");
  assert.equal(getJobseekerCv(older.id, null, ws)!.lastUsedAt, made.lastUsedAt);
  assert.equal(isActiveCv(older, profile), true);
  assert.equal(isActiveCv(older, { cvSourceText: "Old CV" }), false);
  assert.equal(isActiveCv(older, null), false);
});
