import test from "node:test";
import assert from "node:assert/strict";

import { partitionCohortByConsent, type ConsentExclusion } from "./group-eval-cohort.ts";

// A group evaluation ships every member's LABEL, salary expectation and CV-derived
// verdict to a model and then persists the whole comparison. Cohort selection used to
// consult nothing: an anonymized person (a GDPR erasure) and a person whose consent to
// be processed had lapsed were compared, narrated and sealed exactly like anyone else.
// The suppression predicate already exists for outreach (suppressedCandidateIds in
// rediscovery-alert-store.ts, workspace-global and fail-closed); this is the pure half
// that applies it to the compared field and REPORTS what it removed, so the modal can
// say "2 excluded (consent)" instead of the field silently shrinking.

const cand = (entryId: string, candidateId: string | null) => ({
  entryId,
  candidateId,
  label: `Candidate ${entryId}`,
  matchScore: 70,
});

test("an anonymized member is dropped from the compared field and reported as excluded", () => {
  const cohort = [cand("e1", "c1"), cand("e2", "c2"), cand("e3", "c3")];
  const suppressed = new Map<string, ConsentExclusion["reason"]>([["c2", "anonymized"]]);

  const { compared, excluded } = partitionCohortByConsent(cohort, suppressed);

  assert.deepEqual(
    compared.map((c) => c.entryId),
    ["e1", "e3"],
    "the erased person must not reach the model, the narrative or the sealed record",
  );
  assert.deepEqual(excluded, [{ entryId: "e2", candidateId: "c2", reason: "anonymized" }]);
});

test("a lapsed-consent member is dropped with its own reason", () => {
  const cohort = [cand("e1", "c1"), cand("e2", "c2")];
  const suppressed = new Map<string, ConsentExclusion["reason"]>([["c1", "consent_expired"]]);

  const { compared, excluded } = partitionCohortByConsent(cohort, suppressed);

  assert.deepEqual(compared.map((c) => c.entryId), ["e2"]);
  assert.deepEqual(excluded, [{ entryId: "e1", candidateId: "c1", reason: "consent_expired" }]);
  assert.notEqual(excluded[0].reason, "anonymized", "the two suppressions are distinct facts, not one 'excluded'");
});

test("an unsuppressed cohort is returned untouched (same members, same order)", () => {
  const cohort = [cand("e1", "c1"), cand("e2", null), cand("e3", "c3")];
  const { compared, excluded } = partitionCohortByConsent(cohort, new Map());
  assert.deepEqual(compared.map((c) => c.entryId), ["e1", "e2", "e3"]);
  assert.deepEqual(excluded, [], "nothing suppressed means nothing to disclose");
});

test("a member with no durable candidate identity is kept, not silently dropped", () => {
  // A manually added pipeline row has no candidateId, so there is no identity to
  // resolve consent against. Dropping it would quietly shrink the field on a
  // technicality; consent suppression is keyed to a PERSON and this row names none.
  const cohort = [cand("e1", null), cand("e2", "c2")];
  const { compared, excluded } = partitionCohortByConsent(cohort, new Map([["c2", "anonymized" as const]]));
  assert.deepEqual(compared.map((c) => c.entryId), ["e1"]);
  assert.deepEqual(excluded, [{ entryId: "e2", candidateId: "c2", reason: "anonymized" }]);
});

test("every entry sharing a suppressed identity is excluded, not just the first", () => {
  // The same person can hold two pipeline entries in one role (a re-add). Suppression
  // is keyed to candidate_id, so BOTH rows go — otherwise the duplicate carries the
  // erased person's label straight back into the comparison.
  const cohort = [cand("e1", "c1"), cand("e2", "c1"), cand("e3", "c3")];
  const { compared, excluded } = partitionCohortByConsent(cohort, new Map([["c1", "anonymized" as const]]));
  assert.deepEqual(compared.map((c) => c.entryId), ["e3"]);
  assert.equal(excluded.length, 2);
});

test("partitionCohortByConsent does not mutate the cohort it was handed", () => {
  const cohort = [cand("e1", "c1"), cand("e2", "c2")];
  partitionCohortByConsent(cohort, new Map([["c1", "anonymized" as const]]));
  assert.equal(cohort.length, 2, "the caller's array is an input, not a work buffer");
});
