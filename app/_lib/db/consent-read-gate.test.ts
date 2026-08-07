// Read-time consent gate for saved-analysis PII (bug-ui-scan-2026-07-09
// privacy-consent-provenance #3): candidateLabelWithholdsPii must report "withhold"
// the moment the linked entry's consent has EXPIRED — in the window BEFORE the deferred
// anonymize sweep runs — and after anonymization, matched on the same normalized label
// the analyses scrub uses. testing/unit-db.ts MUST be the first project import (isolated
// throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { anonymizeEntry, candidateLabelWithholdsPii, createPipelineEntry, recordEntryConsent } from "./pipeline.ts";
import { maskCandidateName } from "../consent.ts";

after(() => cleanupUnitDb());

const DAY = 86_400_000;

test("candidateLabelWithholdsPii: expired consent withholds BEFORE the sweep; valid consent serves (#3)", () => {
  const { entry } = createPipelineEntry({
    candidateId: "rg-c1",
    candidateLabel: "Read Gate One",
    jobId: "rg-job-1",
    jobTitle: "Reader",
  });
  // Consent granted with a 1-day window (not yet anonymized).
  recordEntryConsent(entry.id, "test", 1);
  const now = Date.now();

  // Still valid → PII is served.
  assert.equal(candidateLabelWithholdsPii("Read Gate One", undefined, now), false);
  // Past expiry but NOT yet swept (anonymized_at still null) → withhold synchronously.
  assert.equal(candidateLabelWithholdsPii("Read Gate One", undefined, now + 2 * DAY), true);
  // Normalized match: casing + whitespace drift still resolves the same entry.
  assert.equal(candidateLabelWithholdsPii("  read gate one  ", undefined, now + 2 * DAY), true);
});

test("candidateLabelWithholdsPii: no linked entry → false; anonymized entry → withhold", () => {
  // A label with no pipeline entry (e.g. recruiter-uploaded analysis) has no consent
  // lifecycle to enforce.
  assert.equal(candidateLabelWithholdsPii("Nobody Here", undefined, Date.now()), false);
  assert.equal(candidateLabelWithholdsPii("", undefined, Date.now()), false);

  const { entry } = createPipelineEntry({
    candidateId: "rg-c2",
    candidateLabel: "Read Gate Two",
    jobId: "rg-job-2",
    jobTitle: "Reader",
  });
  recordEntryConsent(entry.id, "test", 365);
  anonymizeEntry(entry.id, "erasure"); // masks the label AND stamps anonymized_at
  // The analyses row's label is masked to the same value, so the route resolves via it.
  assert.equal(candidateLabelWithholdsPii(maskCandidateName("Read Gate Two"), undefined, Date.now()), true);
});
