import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resumableAnsweredIds } from "./use-apply-draft";

// The in-progress-draft restore (idea-939d96e9) must only replay a draft onto
// the SCRIPT that recorded it. Source-contract test — the repo pattern for
// wiring a unit-level call can't reach (the restore lives in a mount effect
// behind localStorage). applyDraftFingerprint's own semantics are unit-tested in
// app/_lib/apply-intake.test.ts; this pins that the component actually USES it
// on both sides of the round-trip. Without the check, a job edit / archetype
// registry change / locale switch between abandoning and resuming files answers
// under the wrong step ids and can skip a KO gate positionally — silently
// declining a qualified candidate.
//
// The storage half (read / validate / write) lives in use-apply-draft.ts and the
// script + prefill half in the view, so both are read here.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(HERE, rel), "utf8");
const view = read("ConversationalApply.tsx");
const draftModule = read("use-apply-draft.ts");

test("the draft carries a script fingerprint derived from the live steps + locale", () => {
  assert.match(view, /applyDraftFingerprint/, "the fingerprint comes from the shared intake module, not a local re-derivation");
  assert.match(
    view,
    /applyDraftFingerprint\(steps\.map\(\(s\) => s\.id\), locale\)/,
    "the fingerprint must be built from THIS visit's steps and locale"
  );
  assert.match(view, /useLocale\(\)/, "the locale is the request's, so a language switch is detectable");
  assert.match(draftModule, /fp\?: string/, "ApplyDraft carries the fingerprint (optional: pre-fix drafts are still in browsers)");
});

test("the view feeds that fingerprint to BOTH halves of the round-trip", () => {
  // A restore checked against one fingerprint and a persist stamped with another
  // would discard every draft on the next visit — or, worse, replay a stale one.
  for (const hook of ["useApplyDraftRestore", "useApplyDraftPersist"]) {
    const call = view.slice(view.indexOf(`${hook}({`));
    assert.ok(call.length > 0, `could not locate the ${hook} call`);
    assert.match(
      call.slice(0, 260),
      /draftFingerprint,/,
      `${hook} must be handed this visit's fingerprint`
    );
    assert.match(call.slice(0, 260), /draftStorageKey,/, `${hook} must be handed this visit's storage slot`);
  }
});

test("a fingerprint mismatch DISCARDS the draft instead of replaying it", () => {
  assert.match(draftModule, /d\.fp !== draftFingerprint/, "the restore compares the stored fingerprint against this visit's");
  assert.match(
    draftModule,
    /d\.fp !== draftFingerprint\)\s*\{[\s\S]{0,240}?removeItem\(draftStorageKey\)[\s\S]{0,80}?return;/,
    "a mismatch clears the slot and starts fresh — the existing safe path"
  );
});

test("the persist writes the fingerprint alongside the answers", () => {
  assert.match(
    draftModule,
    /const draft: ApplyDraft = \{[^}]*fp: draftFingerprint[^}]*\}/,
    "a saved draft without a fingerprint would be discarded on every resume"
  );
});

test("a draft that stopped ON a step resumes with that step still answerable", () => {
  // advance() marks a step answered BEFORE awaiting the final POST, and on the
  // last step `idx` never moves (there is no next step) — so a draft written at
  // that instant (the POST failed, or the tab died mid-request) carries an idx
  // pointing at a step its own answeredIds already contains. Restored verbatim,
  // the chat renders that step's controls behind advance()'s idempotence guard
  // and swallows every answer: on the real script the final step is a KNOCKOUT
  // question, so the returning candidate taps Yes/No forever with no response.
  const resumed = resumableAnsweredIds(["cv", "name", "email", "ko_auth"], "ko_auth");
  assert.equal(resumed.has("ko_auth"), false, "the step being resumed ON must be answerable");
  assert.deepEqual([...resumed].sort(), ["cv", "email", "name"], "every EARLIER answer stays double-answer guarded");
});

test("the restored answered set survives a corrupt / legacy answeredIds list", () => {
  assert.deepEqual([...resumableAnsweredIds(undefined, "cv")], [], "a draft with no answeredIds restores an empty set");
  assert.deepEqual([...resumableAnsweredIds(["name", 7, null], undefined)], ["name"], "non-string ids are dropped");
});

test("the view hands the restore hook the step ids it needs to do that", () => {
  assert.match(view, /stepIds: steps\.map\(\(s\) => s\.id\)/, "the restore hook is given THIS visit's script, in order");
  assert.match(
    draftModule,
    /answeredRef\.current = resumableAnsweredIds\(d\.answeredIds, stepIds\[d\.idx\]\)/,
    "…and uses it to keep the resumed step answerable"
  );
});

test("the prefill-beats-stale-draft precedence survives (commit f331436)", () => {
  // Regression fence: the fingerprint check runs BEFORE the merge, and must not
  // have replaced it. mergeDraftAnswers is what keeps a returning lead's seeded
  // KO=true from being wiped by a same-script stale draft — a different bug.
  // The merge stays in the view (it is prefill policy, not storage policy) and
  // runs on the validated draft the hook hands back.
  assert.match(view, /setAnswers\(mergeDraftAnswers\(d\.answers, prefill\?\.answers\)\)/, "the prefill still wins over the draft's keys");
  assert.match(view, /onRestore: \(d\) =>/, "…applied to the draft the restore hook validated");
});
