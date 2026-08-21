// Locks the read-back entity normalizer (scorecard-v5) — the trust-boundary guard
// the transcript modal AND the drawer's interview chapter both run over the stored
// `entities` blob before rendering. The blob is unvalidated JSON on a persisted
// scorecard (a legacy row, a partial synthesis, or a non-Python provider can carry
// any shape), so this pins the two contract cases the direction requires:
//
//   - a read-back WITH a correction survives coercion (trimmed, half-empty pairs and
//     non-string buckets dropped);
//   - NO read-back (null / absent / all-empty) normalizes to null, so absence renders
//     no chrome and a read-back is never fabricated.

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeScorecardEntities, isPlaceholderEvidence, isNotAssessedRating } from "./interview-scorecard.ts";

test("a read-back with a correction survives coercion, trimming and dropping junk", () => {
  const out = normalizeScorecardEntities({
    confirmed: ["PostgreSQL", " Docker ", "", 42],
    corrected: [
      { heard: "Rust", meant: "React" },
      { heard: "", meant: "x" }, // half-empty pair → dropped
      { heard: "Go" }, // missing meant → dropped
      "nonsense",
    ],
    unconfirmed: ["Kubernetes", null],
  });
  assert.deepEqual(out, {
    confirmed: ["PostgreSQL", "Docker"],
    corrected: [{ heard: "Rust", meant: "React" }],
    unconfirmed: ["Kubernetes"],
  });
});

// PARITY FIXTURE — kept byte-identical to the input/expected literals in
// pipeline/jobfit/tests/test_automation.py::test_cross_bucket_dedupe_precedence.
// Both normalizers must dedupe a token appearing in more than one bucket with the
// same precedence: corrected.meant > confirmed > unconfirmed.
test("cross-bucket dedupe: corrected.meant > confirmed > unconfirmed", () => {
  const out = normalizeScorecardEntities({
    // "React" is what a mishear MEANT and is also (redundantly) confirmed + unconfirmed;
    // "Docker" is confirmed AND unconfirmed.
    confirmed: ["React", "Docker", "PostgreSQL"],
    corrected: [{ heard: "Rust", meant: "React" }],
    unconfirmed: ["Docker", "Kubernetes", "React"],
  });
  assert.deepEqual(out, {
    confirmed: ["Docker", "PostgreSQL"], // "React" dropped — it is a corrected.meant
    corrected: [{ heard: "Rust", meant: "React" }],
    unconfirmed: ["Kubernetes"], // "Docker" dropped (confirmed), "React" dropped (meant)
  });
});

test("no read-back normalizes to null (absent, empty, and non-object all yield null)", () => {
  for (const raw of [
    null,
    undefined,
    "not-an-object",
    {},
    { confirmed: [], corrected: [], unconfirmed: [] },
    { confirmed: ["", "   "], corrected: [{ heard: "", meant: "" }], unconfirmed: [null] },
  ]) {
    assert.equal(normalizeScorecardEntities(raw), null, JSON.stringify(raw ?? null));
  }
});

// isPlaceholderEvidence mirrors the Python "Not assessed…" PREFIX contract
// (interview-simulation-comparison #2): the compare grid filters these out so a
// placeholder never renders as a real evidence quote. The old TS filter matched
// only the exact "Not assessed." spelling, letting the "(auto-synthesis
// unavailable)" variant leak through as a rating-3 quote.
test("isPlaceholderEvidence matches every 'Not assessed…' spelling (prefix contract)", () => {
  assert.equal(isPlaceholderEvidence("Not assessed."), true);
  assert.equal(isPlaceholderEvidence("Not assessed (auto-synthesis unavailable)."), true, "the variant the exact-match filter missed");
  assert.equal(isPlaceholderEvidence(""), true, "empty evidence is not a real quote");
  assert.equal(isPlaceholderEvidence(undefined), true);
  assert.equal(isPlaceholderEvidence(null), true);
});

test("isPlaceholderEvidence keeps genuine evidence quotes", () => {
  assert.equal(isPlaceholderEvidence("Walked through a real migration they led."), false);
  assert.equal(isPlaceholderEvidence("Assessed the candidate's system-design tradeoffs."), false, "'Assessed…' is not the 'Not assessed' prefix");
});

// The synthesis encodes "not assessed" as rating 3 + placeholder evidence
// (automation.py: "set its evidence to an empty string and rate it 3", then backfilled
// to "Not assessed."), so NOT-ASSESSED IS ON THE SCALE. Read-side surfaces need a
// predicate for it or an untouched competency renders as a genuine mid score.
test("isNotAssessedRating catches the synthesis's rating-3 + placeholder sentinel", () => {
  assert.equal(isNotAssessedRating(3, "Not assessed."), true);
  assert.equal(isNotAssessedRating(3, "Not assessed (auto-synthesis unavailable)."), true);
});

test("isNotAssessedRating leaves a genuine middling rating alone", () => {
  assert.equal(isNotAssessedRating(3, "Walked through a real migration they led."), false);
  assert.equal(isNotAssessedRating(4, "Not assessed."), false, "only the mid-scale sentinel value");
  assert.equal(isNotAssessedRating(2, "Not assessed."), false);
});

test("isNotAssessedRating does not swallow an unevidenced HUMAN rating of 3", () => {
  // The human scorecard route omits `evidence` when the recruiter left the note blank
  // and simply omits an unrated competency — so a bare 3 there is a real observation.
  assert.equal(isNotAssessedRating(3, undefined), false);
  assert.equal(isNotAssessedRating(3, ""), false);
  assert.equal(isNotAssessedRating(null, "Not assessed."), false);
});
