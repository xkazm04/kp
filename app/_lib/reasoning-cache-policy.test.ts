// Pins the per-match reasoning cache-invalidation contract (idea-4d3bf96f):
// only an authoritative LLM verdict may be frozen in the 168h prompt cache. A
// deterministic-template fallback — emitted when the LLM provider is down — must
// NOT be cached, or a recruiter would be served a low-quality rationale for a
// week with no way to upgrade once the provider returns.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { isCacheableReasoning, narrativeLangFor, CACHEABLE_REASONING_SOURCE } from "./reasoning-cache-policy.ts";

test("an llm-sourced verdict is cacheable", () => {
  assert.equal(isCacheableReasoning({ source: "llm", reasoning: {} }), true);
});

test("a deterministic fallback is NOT cacheable (the staleness trap)", () => {
  assert.equal(isCacheableReasoning({ source: "deterministic", reasoning: {} }), false);
});

test("an unknown / missing source is treated as non-cacheable (fail closed)", () => {
  assert.equal(isCacheableReasoning({ reasoning: {} }), false);
  assert.equal(isCacheableReasoning({ source: "gemini" }), false);
  assert.equal(isCacheableReasoning({ source: "" }), false);
});

test("non-object payloads never cache", () => {
  assert.equal(isCacheableReasoning(null), false);
  assert.equal(isCacheableReasoning(undefined), false);
  assert.equal(isCacheableReasoning("llm"), false);
  assert.equal(isCacheableReasoning(42), false);
});

test("the cacheable source is the LLM tag emitted by reasoning_cli", () => {
  // Guards against the constant drifting away from reasoning_cli's source values
  // ('llm' | 'deterministic'); only the authoritative one is cacheable.
  assert.equal(CACHEABLE_REASONING_SOURCE, "llm");
});

// narrativeLang is what MatchReasoningPanel compares against the reader's locale
// to decide whether to show "shown in {language}". It must describe the ANSWER,
// not the request: the deterministic template is English-only, so a cs request
// that fell back must say "en" or the note is suppressed over English prose.
test("narrativeLangFor: an llm answer is in the engine language", () => {
  assert.equal(narrativeLangFor({ source: "llm", reasoning: {} }, "cs"), "cs");
  assert.equal(narrativeLangFor({ source: "llm", reasoning: {} }, "en"), "en");
});

test("narrativeLangFor: a deterministic fallback is English whatever was asked for", () => {
  assert.equal(narrativeLangFor({ source: "deterministic", reasoning: {} }, "cs"), "en");
  assert.equal(narrativeLangFor({ reasoning: {} }, "cs"), "en");
  assert.equal(narrativeLangFor(null, "cs"), "en");
});

// --- the engine now STATES the language, and TS reads it ------------------------
// reasoning_cli emits `narrativeLang` from match_reasoning.narrative_lang_for — the
// side that actually produced the words. Deriving it from `source` was a second place
// inferring a property of the text from a sibling field, and that inference is exactly
// what the honest "shown in {language}" note had already been broken by once.
test("narrativeLangFor: the engine's stated language wins over the derivation", () => {
  // The case the derivation cannot get right on its own: an LLM answer whose engine
  // lang argument disagrees with what the CLI was actually told to write in.
  assert.equal(narrativeLangFor({ source: "llm", narrativeLang: "de", reasoning: {} }, "cs"), "de");
  // …and the reverse: a payload the engine says is English, despite source "llm".
  assert.equal(narrativeLangFor({ source: "llm", narrativeLang: "en", reasoning: {} }, "cs"), "en");
});

test("narrativeLangFor: an unsupported or malformed stated language is ignored", () => {
  // The field comes off a subprocess's stdout; an unknown code would render as no
  // language at all in the panel, so it must fall through to the derivation.
  for (const bogus of ["klingon", "", "EN", "cs-CZ", 42, null, {}]) {
    assert.equal(
      narrativeLangFor({ source: "llm", narrativeLang: bogus, reasoning: {} }, "cs"),
      "cs",
      `stated ${JSON.stringify(bogus)} must not be forwarded`
    );
  }
});

test("narrativeLangFor: a pre-field cached payload still derives correctly", () => {
  // Verdicts cached before the field existed live on for the full 168h TTL.
  assert.equal(narrativeLangFor({ source: "llm", reasoning: {} }, "fr"), "fr");
  assert.equal(narrativeLangFor({ source: "deterministic", reasoning: {} }, "fr"), "en");
});

test("the accepted narrative languages are exactly the app's locales", async () => {
  // The set is re-declared in reasoning-cache-policy.ts to keep that module
  // dependency-free; this is the pin that stops the copy drifting from the source of
  // truth (and from pipeline/jobfit/i18n.py LANG_NAMES, which normalize_lang uses).
  const { LOCALES } = await import("../../i18n/locales.ts");
  for (const locale of LOCALES) {
    assert.equal(
      narrativeLangFor({ source: "deterministic", narrativeLang: locale, reasoning: {} }, "en"),
      locale,
      `${locale} must be accepted as a stated narrative language`
    );
  }
});
