// The credential card's data -> parts mapping (Gate 2 kit view), pinned.
// Runner: Node's built-in test runner with type stripping.  npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { skillBody, skillFigures, skillStaleKey, skillVerdict, type SkillKitCard, type SkillKitState } from "./skillKitModel.ts";

const card = (state: SkillKitState, over: Partial<Extract<SkillKitCard, { kind: "card" }>> = {}): Extract<SkillKitCard, { kind: "card" }> => ({
  kind: "card",
  state,
  showsScores: state === "verified" || state === "stale",
  transferScore: 71.6,
  confidencePct: 82,
  issued: "3 Sept 2026",
  version: "1.0",
  staleReason: null,
  axes: [{ name: "judgment", label: "Judgment", score: 70 }],
  ...over,
});

test("the verdict's SHAPE follows today's colour: green ok, amber caution, red fail, stone unknown", () => {
  assert.equal(skillVerdict("verified").mark, "ok");
  assert.equal(skillVerdict("stale").mark, "caution");
  assert.equal(skillVerdict("tampered").mark, "fail");
  // revoked and unverifiable were neutral stone, never the red accusation: they stay neutral
  assert.equal(skillVerdict("revoked").mark, "unknown");
  assert.equal(skillVerdict("unverifiable").mark, "unknown");
  assert.equal(skillVerdict("incomplete").mark, "unknown");
});

test("exactly the three withheld states carry their own body copy under the verdict", () => {
  assert.equal(skillVerdict("revoked").body, "revokedBody");
  assert.equal(skillVerdict("tampered").body, "tamperedBody");
  assert.equal(skillVerdict("unverifiable").body, "unverifiableBody");
  for (const s of ["verified", "stale", "incomplete"] as const) assert.equal(skillVerdict(s).body, null);
});

test("numbers show only for a trusted state; 'issued without a summary' only for incomplete", () => {
  assert.equal(skillBody(card("verified")), "scores");
  assert.equal(skillBody(card("stale")), "scores");
  assert.equal(skillBody(card("incomplete")), "summary");
  for (const s of ["revoked", "tampered", "unverifiable"] as const) assert.equal(skillBody(card(s)), "none");
});

test("a stale credential names why; nothing else gets the stale note", () => {
  assert.equal(skillStaleKey(card("stale", { staleReason: "methodology" })), "staleMethodology");
  assert.equal(skillStaleKey(card("stale", { staleReason: "age" })), "staleAge");
  assert.equal(skillStaleKey(card("verified", { staleReason: "age" })), null);
});

test("the headline figures print as today's card does", () => {
  assert.deepEqual(skillFigures(card("verified")), { transfer: 72, confidencePct: 82 });
});
