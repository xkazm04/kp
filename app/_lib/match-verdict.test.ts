// The Match verdict's facts contract (ADR 0018): what the route accepts and seals.
// Strict about what is present, canonical about what is absent, never prose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { coerceMatchReasonFacts, matchVerdictRationale, type MatchReasonFacts } from "./match-verdict.ts";

const good: MatchReasonFacts = {
  fitTier: "strong",
  best: { labelCode: "skills", percent: 82 },
  worst: { labelCode: "career", percent: 40 },
  matched: ["Java", "Kafka"],
  unproven: ["Go"],
  missing: ["Rust"],
  matchScore: 71,
  scorerVersion: "match-scorer.v1",
};

test("well-formed facts come back canonical; absent optional fields become null / []", () => {
  assert.deepEqual(coerceMatchReasonFacts(good), good);
  assert.deepEqual(coerceMatchReasonFacts({ scorerVersion: "match-scorer.v1" }), {
    fitTier: null,
    best: null,
    worst: null,
    matched: [],
    unproven: [],
    missing: [],
    matchScore: null,
    scorerVersion: "match-scorer.v1",
  });
});

test("anything outside the vocabulary or the bounds is refused", () => {
  const bad: [string, unknown][] = [
    ["not an object", "Strong fit."],
    ["an array", [good]],
    ["an unknown key (a sentence riding along)", { ...good, line: "Strong fit: strongest on Skills (82)." }],
    ["an out-of-vocabulary tier", { ...good, fitTier: "excellent" }],
    ["an out-of-vocabulary dimension slug", { ...good, best: { labelCode: "charisma", percent: 90 } }],
    ["an English label instead of a slug", { ...good, best: { labelCode: "Skills", percent: 82 } }],
    ["an extra key on a dimension", { ...good, best: { labelCode: "skills", percent: 82, label: "Skills" } }],
    ["a fractional percent", { ...good, best: { labelCode: "skills", percent: 82.4 } }],
    ["a percent over 100", { ...good, best: { labelCode: "skills", percent: 101 } }],
    ["a weakest dimension with no strongest", { ...good, best: null }],
    ["a weakest dimension stronger than the strongest", { ...good, worst: { labelCode: "career", percent: 90 } }],
    ["too many skills", { ...good, matched: ["a", "b", "c", "d"] }],
    ["an over-long skill name", { ...good, missing: ["x".repeat(41)] }],
    ["an untrimmed skill name", { ...good, missing: [" Rust"] }],
    ["a blank skill name", { ...good, missing: [""] }],
    ["a repeated skill name", { ...good, matched: ["Java", "Java"] }],
    ["a non-string skill", { ...good, matched: [42] }],
    ["a score out of range", { ...good, matchScore: 140 }],
    ["a non-finite score", { ...good, matchScore: "71" }],
    ["no scorer version", { ...good, scorerVersion: undefined }],
    ["a prose scorer version", { ...good, scorerVersion: "The scorer as of Tuesday" }],
  ];
  for (const [why, value] of bad) assert.equal(coerceMatchReasonFacts(value), null, why);
});

test("the rationale is a byte-stable code string derived from the facts — no names, no prose", () => {
  const line = matchVerdictRationale(good);
  assert.equal(line, "match_fit tier=strong best=skills:82 worst=career:40 skills=2/1/1 score=71 scorer=match-scorer.v1");
  assert.equal(matchVerdictRationale(structuredClone(good)), line, "same facts, same bytes");
  assert.doesNotMatch(line, /Java|Rust|Go\b/, "skill names stay in inputs");
  assert.equal(
    matchVerdictRationale({ ...good, fitTier: null, best: null, worst: null, matchScore: null }),
    "match_fit tier=- best=- worst=- skills=2/1/1 score=- scorer=match-scorer.v1"
  );
});
