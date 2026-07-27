import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The in-progress-draft restore (idea-939d96e9) must only replay a draft onto
// the SCRIPT that recorded it. Source-contract test — the repo pattern for
// wiring a unit-level call can't reach (the restore lives in a mount effect
// behind localStorage). applyDraftFingerprint's own semantics are unit-tested in
// app/_lib/apply-intake.test.ts; this pins that the component actually USES it
// on both sides of the round-trip. Without the check, a job edit / archetype
// registry change / locale switch between abandoning and resuming files answers
// under the wrong step ids and can skip a KO gate positionally — silently
// declining a qualified candidate.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, "ConversationalApply.tsx"), "utf8");

test("the draft carries a script fingerprint derived from the live steps + locale", () => {
  assert.match(src, /applyDraftFingerprint/, "the fingerprint comes from the shared intake module, not a local re-derivation");
  assert.match(
    src,
    /applyDraftFingerprint\(steps\.map\(\(s\) => s\.id\), locale\)/,
    "the fingerprint must be built from THIS visit's steps and locale"
  );
  assert.match(src, /useLocale\(\)/, "the locale is the request's, so a language switch is detectable");
  assert.match(src, /fp\?: string/, "ApplyDraft carries the fingerprint (optional: pre-fix drafts are still in browsers)");
});

test("a fingerprint mismatch DISCARDS the draft instead of replaying it", () => {
  assert.match(src, /d\.fp !== draftFingerprint/, "the restore compares the stored fingerprint against this visit's");
  assert.match(
    src,
    /d\.fp !== draftFingerprint\)\s*\{[\s\S]{0,240}?removeItem\(draftStorageKey\)[\s\S]{0,80}?return;/,
    "a mismatch clears the slot and starts fresh — the existing safe path"
  );
});

test("the persist writes the fingerprint alongside the answers", () => {
  assert.match(
    src,
    /const draft: ApplyDraft = \{[^}]*fp: draftFingerprint[^}]*\}/,
    "a saved draft without a fingerprint would be discarded on every resume"
  );
});

test("the prefill-beats-stale-draft precedence survives (commit f331436)", () => {
  // Regression fence: the fingerprint check runs BEFORE the merge, and must not
  // have replaced it. mergeDraftAnswers is what keeps a returning lead's seeded
  // KO=true from being wiped by a same-script stale draft — a different bug.
  assert.match(src, /setAnswers\(mergeDraftAnswers\(d\.answers, prefill\?\.answers\)\)/, "the prefill still wins over the draft's keys");
});
