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
  lang: "en",
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
  // The output locale is part of the key: an en analysis must not be served for
  // a cs request (it would show English narrative under a Czech UI).
  assert.notEqual(k0, computeCacheKey({ ...base, lang: "cs" }));
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

test("PROMPT_VERSION is bumped to retire the old (pre-i18n) keys", () => {
  // Adding `lang` to the key must invalidate prior cache entries; the version is
  // how lookupPromptCache rejects them.
  assert.ok(PROMPT_VERSION.startsWith("v5-"), `expected a v5 prompt version, got ${PROMPT_VERSION}`);
});

test("structured job context distinguishes the key; its absence keeps the legacy key (role-intake Phase 0)", () => {
  const without = computeCacheKey({ ...base, jobDescriptionText: "jd" });
  const withStruct = computeCacheKey({ ...base, jobDescriptionText: "jd", jobStructureJson: '{"id":"jd-x"}' });
  // A structured-job run must not be served for a prose-only run…
  assert.notEqual(without, withStruct);
  // …and editing the structure (re-ingest) must invalidate.
  assert.notEqual(withStruct, computeCacheKey({ ...base, jobDescriptionText: "jd", jobStructureJson: '{"id":"jd-y"}' }));
  // Append-only contract: absent and empty behave like the pre-field key, so the
  // existing cache stays valid for runs without a structured job.
  assert.equal(without, computeCacheKey({ ...base, jobDescriptionText: "jd", jobStructureJson: "" }));
});
