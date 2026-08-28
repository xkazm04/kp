// ONE THREAD — the identity resolvers. These are the rules that let a pipeline entry
// hold the REAL job and the REAL candidate while still knowing which assignment it came
// out of, and they are only trustworthy if BOTH halves hold at once:
//
//   * an entry written since the milestone resolves from its own columns, even though
//     its jobId is now `jd-<slug>` and its candidateId a profile id — nothing about
//     either id says "dev case" any more, which is the whole point;
//   * an entry written BEFORE it resolves from the `dc-`/`ds-` prefixes, because those
//     rows are real hiring history and their meaning cannot be recovered any other way.
//
// A version that only did the first would silently un-ground every legacy candidate's
// case interview; a version that only did the second is what shipped before.
//
// Pure module — no DB, no fixtures. The behaviour that RESTS on these (promote, source)
// is pinned in devcase-promote-identity.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  caseJobIdentity,
  devCaseIdForEntry,
  DEVCASE_FALLBACK_ROLE_FAMILY,
  DEVCASE_PROMOTE_STAGE,
  roleFamilyForCase,
  submissionIdForEntry,
  syntheticCaseJobId,
} from "./devcase-identity.ts";

test("an assignment with a linked job files its candidates on that REAL opening", () => {
  const id = caseJobIdentity({ caseId: "dc_1", jobId: "jd-backend-eng", jobTitle: "Backend Engineer", roleTitle: "Backend" });
  assert.equal(id.jobId, "jd-backend-eng", "the opening, not a minted `dc-` id");
  assert.equal(id.jobTitle, "Backend Engineer", "and the opening's own title");
  assert.equal(id.linked, true, "callers can record WHICH of the two happened");
});

test("an assignment with NO linked job falls back to the synthetic id, and says so", () => {
  // The load-bearing NULL: JD → Job ingest is best-effort, so a case can honestly have
  // no opening. The candidate still needs a job to be grouped under on a board that
  // groups by job, so the minted id survives for exactly this state.
  const id = caseJobIdentity({ caseId: "dc_9", jobId: null, jobTitle: null, roleTitle: "Backend" });
  assert.equal(id.jobId, "dc-dc_9");
  assert.equal(id.jobTitle, "Backend", "the assignment's own role title labels it");
  assert.equal(id.linked, false, "and the fallback is reported, not disguised as a link");
});

test("a blank job id is not a link — whitespace never passes for an opening", () => {
  const id = caseJobIdentity({ caseId: "dc_9", jobId: "   ", jobTitle: null, roleTitle: null });
  assert.equal(id.linked, false);
  assert.equal(id.jobId, syntheticCaseJobId("dc_9"));
  assert.equal(id.jobTitle, "Dev case", "and there is always a label");
});

test("a case with no id at all still produces a usable job id", () => {
  assert.equal(syntheticCaseJobId(null), "dc-case");
  assert.equal(caseJobIdentity({ caseId: null, jobId: null, jobTitle: null, roleTitle: null }).jobId, "dc-case");
});

test("role family is STATED by the opening, then by the need, then the last-resort literal", () => {
  assert.equal(roleFamilyForCase("healthcare_clinical", "software_engineering"), "healthcare_clinical", "the job wins");
  assert.equal(roleFamilyForCase(null, "data_ai"), "data_ai", "the need is consulted when no job states one");
  assert.equal(roleFamilyForCase("  ", "  "), DEVCASE_FALLBACK_ROLE_FAMILY, "blank is not a statement");
  assert.equal(roleFamilyForCase(null, null), DEVCASE_FALLBACK_ROLE_FAMILY);
  // NON-VACUITY: the literal must be the historical one, or every already-promoted
  // entry silently changes family relative to the ones promoted after this change.
  assert.equal(DEVCASE_FALLBACK_ROLE_FAMILY, "software_engineering");
});

test("the promote stage stays the shipped axis's screened column, by name", () => {
  // Named, not removed: docs/features/pipeline/README.md keeps devcase-run on the
  // deliberately name-coupled list. The constant makes the coupling greppable.
  assert.equal(DEVCASE_PROMOTE_STAGE, "Screened");
});

test("a post-milestone entry resolves its assignment from its COLUMNS, not its ids", () => {
  const entry = {
    jobId: "jd-backend-eng",
    candidateId: "profile-abc",
    devCaseId: "dc_1",
    devSubmissionId: "sub_7",
  };
  // Neither id carries a hint any more — this is exactly the state the old prefix
  // parsing returned null for, silently dropping the case-grounded interview.
  assert.equal(devCaseIdForEntry(entry), "dc_1");
  assert.equal(submissionIdForEntry(entry), "sub_7");
});

test("a LEGACY entry still resolves from its prefixes", () => {
  const legacy = { jobId: "dc-dc_legacy", candidateId: "ds-sub_legacy" };
  assert.equal(devCaseIdForEntry(legacy), "dc_legacy");
  assert.equal(submissionIdForEntry(legacy), "sub_legacy");
});

test("the column WINS over a prefix, so a backfilled legacy row cannot resolve two ways", () => {
  const both = { jobId: "dc-dc_old", candidateId: "ds-sub_old", devCaseId: "dc_new", devSubmissionId: "sub_new" };
  assert.equal(devCaseIdForEntry(both), "dc_new");
  assert.equal(submissionIdForEntry(both), "sub_new");
});

test("an ordinary entry resolves to nothing — no assignment is invented for it", () => {
  const ordinary = { jobId: "jd-marketing", candidateId: "profile-xyz" };
  assert.equal(devCaseIdForEntry(ordinary), null);
  assert.equal(submissionIdForEntry(ordinary), null);
  assert.equal(devCaseIdForEntry(null), null);
  assert.equal(submissionIdForEntry(undefined), null);
  assert.equal(devCaseIdForEntry({ jobId: null, candidateId: null }), null);
  // A bare prefix names no case: "dc-" alone must not resolve to the empty string,
  // which would then be looked up as a real case id.
  assert.equal(devCaseIdForEntry({ jobId: "dc-", candidateId: null }), null);
  assert.equal(submissionIdForEntry({ jobId: null, candidateId: "ds-" }), null);
});
