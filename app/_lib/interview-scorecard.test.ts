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
import { normalizeScorecardEntities } from "./interview-scorecard.ts";

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
