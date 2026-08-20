// The per-conversation ASR keyword list (asr-keywords.mjs). The rules pinned
// here are the ones that decide whether the recognizer gets biased toward the
// terms this interview will actually contain — the fix for the "React" → "Rust",
// "PostgreSQL" → "později SQL" corruption class that the scorecard would
// otherwise rate as a fabricated skill set.
import test from "node:test";
import assert from "node:assert/strict";
import { ASR_KEYWORD_LIMIT, BASE_ASR_KEYWORDS, buildAsrKeywords, normalizeKeyword } from "./asr-keywords.mjs";

test("job terms come first and displace the floor list at the cap", () => {
  const jobTerms = ["Elixir", "Phoenix", "Ecto"];
  const list = buildAsrKeywords(jobTerms);
  assert.deepEqual(list.slice(0, 3), jobTerms, "the job's own stack leads");
  assert.equal(list.length, ASR_KEYWORD_LIMIT, "the list fills to the platform cap");
  // The floor is deliberately longer than the cap, so job terms cost floor terms —
  // and they cost them off the TAIL, never out of the middle.
  const keptFloor = list.slice(jobTerms.length);
  assert.deepEqual(keptFloor, BASE_ASR_KEYWORDS.slice(0, ASR_KEYWORD_LIMIT - jobTerms.length));
});

test("never exceeds the per-conversation cap, however many job terms arrive", () => {
  const many = Array.from({ length: 200 }, (_, i) => `Skill${i}`);
  assert.equal(buildAsrKeywords(many).length, ASR_KEYWORD_LIMIT);
});

test("dedupes case-insensitively, first spelling wins", () => {
  const list = buildAsrKeywords(["postgresql", "PostgreSQL", "  postgres  "]);
  assert.equal(list[0], "postgresql", "the job's spelling arrives first and stays");
  assert.equal(list.filter((k) => k.toLowerCase() === "postgresql").length, 1, "the floor's PostgreSQL does not double up");
  assert.equal(list[1], "postgres", "a genuinely different term still lands");
});

test("prose and empty requirement rows are rejected, real tech names are not", () => {
  // What recruiters and extraction models actually put in requirement rows.
  assert.equal(normalizeKeyword("5+ years of experience with distributed systems"), null, "too many words");
  assert.equal(normalizeKeyword(""), null);
  assert.equal(normalizeKeyword("   "), null);
  assert.equal(normalizeKeyword(null), null);
  assert.equal(normalizeKeyword("x".repeat(60)), null, "too long to be a term");
  assert.equal(normalizeKeyword("Ability to work independently!"), null, "sentence punctuation is not a term");

  // Terms whose punctuation is part of the name must survive.
  for (const term of ["Next.js", "C#", "C++", ".NET", "CI/CD", "Objective-C", "Spring Boot", "Node.js"]) {
    assert.equal(normalizeKeyword(term), term, `${term} must survive normalization`);
  }
  assert.equal(normalizeKeyword("  Apache   Kafka  "), "Apache Kafka", "trimmed and whitespace-collapsed");
});

test("a job with no usable terms still gets the floor list, never an empty bias", () => {
  const list = buildAsrKeywords(["", null, "excellent communication skills and a proactive mindset"]);
  assert.equal(list.length, ASR_KEYWORD_LIMIT);
  assert.equal(list[0], BASE_ASR_KEYWORDS[0]);
});

test("no term is dropped by the cap before a later source's terms are considered", () => {
  // The cap is applied while walking sources IN ORDER, so a short custom floor
  // is fully consumed rather than truncated by an earlier long job list.
  const list = buildAsrKeywords(["A", "B"], ["C", "D"], 3);
  assert.deepEqual(list, ["A", "B", "C"]);
});
