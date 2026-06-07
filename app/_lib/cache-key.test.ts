// Pins the cache-key serialization contract (idea-c2c4b498): different inputs
// must never produce the same digest. The old key concatenated fields with
// literal markers (`|jdt=`, `|cot=`, …) and no length framing, so content that
// itself contained a marker could shift bytes across a field boundary and
// collide — serving one candidate's analysis for a different input. The fix
// length-frames every field; these tests lock that two inputs which differ only
// in WHERE a marker falls stay distinct.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCacheKey, PROMPT_VERSION, type CacheKeyInput } from "./cache-key.ts";

const base: CacheKeyInput = {
  cvBytes: Buffer.from("cv-bytes"),
  jobDescriptionText: "",
  jobDescriptionFileBytes: null,
  companyText: "",
  companyFileBytes: null,
  grounding: false,
};

test("identical inputs hash identically (cache stays usable)", () => {
  assert.equal(computeCacheKey({ ...base }), computeCacheKey({ ...base }));
});

test("the boundary collision is gone: marker in JD text vs separate company input", () => {
  // Under the old delimiter-only scheme these two produced a byte-identical
  // pre-hash stream and collided:
  //   A: jdt = "p|jdf=|cot=q", company = ""
  //   B: jdt = "p",            company = "q|jdf=|cot="
  // Both used to serialize to `…|jdt=p|jdf=|cot=q|jdf=|cot=|cof=|cv=…`.
  const a = computeCacheKey({ ...base, jobDescriptionText: "p|jdf=|cot=q", companyText: "" });
  const b = computeCacheKey({ ...base, jobDescriptionText: "p", companyText: "q|jdf=|cot=" });
  assert.notEqual(a, b);
});

test("moving one character across the JD/company boundary changes the key", () => {
  const a = computeCacheKey({ ...base, jobDescriptionText: "ab", companyText: "" });
  const b = computeCacheKey({ ...base, jobDescriptionText: "a", companyText: "b" });
  assert.notEqual(a, b);
});

test("each field independently affects the key", () => {
  const k0 = computeCacheKey({ ...base });
  assert.notEqual(k0, computeCacheKey({ ...base, jobDescriptionText: "jd" }));
  assert.notEqual(k0, computeCacheKey({ ...base, companyText: "co" }));
  assert.notEqual(k0, computeCacheKey({ ...base, cvBytes: Buffer.from("other") }));
  assert.notEqual(k0, computeCacheKey({ ...base, jobDescriptionFileBytes: Buffer.from("file") }));
  assert.notEqual(k0, computeCacheKey({ ...base, companyFileBytes: Buffer.from("file") }));
  assert.notEqual(k0, computeCacheKey({ ...base, grounding: true }));
});

test("text content equal to a file's bytes does not collide across the text/file boundary", () => {
  const a = computeCacheKey({ ...base, jobDescriptionText: "shared", jobDescriptionFileBytes: null });
  const b = computeCacheKey({ ...base, jobDescriptionText: "", jobDescriptionFileBytes: Buffer.from("shared") });
  assert.notEqual(a, b);
});

test("leading/trailing whitespace in text fields is normalized (trim is part of the key)", () => {
  assert.equal(
    computeCacheKey({ ...base, jobDescriptionText: "  jd  " }),
    computeCacheKey({ ...base, jobDescriptionText: "jd" })
  );
});

test("PROMPT_VERSION is bumped to retire the old (collision-prone) keys", () => {
  // The framing change must invalidate prior cache entries; the version is how
  // lookupPromptCache rejects them.
  assert.ok(PROMPT_VERSION.startsWith("v4-"), `expected a v4 prompt version, got ${PROMPT_VERSION}`);
});
