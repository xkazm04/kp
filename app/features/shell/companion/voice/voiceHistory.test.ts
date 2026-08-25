// Pure unit coverage for the voice pair's reading model: the answers-only
// projection, the question join, the clamp, and the pinned-to-latest rule.
// No React, no DOM — `node --test` via the alias loader.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampVoiceIndex,
  latestVoiceIndex,
  nextVoicePosition,
  stepVoiceIndex,
  voiceEntries,
  type VoiceSourceTurn,
} from "./voiceHistory.ts";

const turn = (id: string, role: string, content: string): VoiceSourceTurn => ({ id, role, content });

const THREAD: VoiceSourceTurn[] = [
  turn("u1", "user", "who needs me"),
  turn("a1", "assistant", "Three decisions."),
  turn("u2", "user", "and the pipeline"),
  turn("a2", "assistant", "Two roles are aging."),
  turn("a3", "assistant", "I could re-run the screening."),
];

test("voiceEntries: assistant turns only, oldest first", () => {
  const entries = voiceEntries(THREAD);
  assert.deepEqual(
    entries.map((e) => e.id),
    ["a1", "a2", "a3"]
  );
});

test("voiceEntries: each answer carries the nearest question BEFORE it", () => {
  const entries = voiceEntries(THREAD);
  assert.equal(entries[0].prompt, "who needs me");
  assert.equal(entries[1].prompt, "and the pipeline");
  // Two consecutive assistant turns share the question that opened them — the
  // second is a follow-up, not an answer to something that was never asked.
  assert.equal(entries[2].prompt, "and the pipeline");
});

test("voiceEntries: an answer with no question before it carries null", () => {
  const entries = voiceEntries([turn("a0", "assistant", "I am Candi.")]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].prompt, null);
});

test("voiceEntries: a blank user turn does not displace the real question", () => {
  const entries = voiceEntries([
    turn("u1", "user", "who needs me"),
    turn("u2", "user", "   "),
    turn("a1", "assistant", "Three decisions."),
  ]);
  assert.equal(entries[0].prompt, "who needs me");
});

test("voiceEntries: an unknown role is neither an entry nor a question", () => {
  const entries = voiceEntries([turn("s1", "system", "thread opened"), turn("a1", "assistant", "Hello.")]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].prompt, null);
});

test("voiceEntries: meta rides through, defaulting to null rather than undefined", () => {
  const [withMeta, without] = voiceEntries([
    { id: "a1", role: "assistant", content: "x", meta: { source: "llm" } },
    { id: "a2", role: "assistant", content: "y" },
  ]);
  assert.deepEqual(withMeta.meta, { source: "llm" });
  assert.equal(without.meta, null);
});

test("clampVoiceIndex: an empty list points at nothing", () => {
  assert.equal(clampVoiceIndex(0, 0), -1);
  assert.equal(clampVoiceIndex(0, 5), -1);
  assert.equal(latestVoiceIndex(0), -1);
});

test("clampVoiceIndex: out of range collapses to the nearest real entry", () => {
  assert.equal(clampVoiceIndex(3, -9), 0);
  assert.equal(clampVoiceIndex(3, 9), 2);
  assert.equal(clampVoiceIndex(3, 1), 1);
  assert.equal(clampVoiceIndex(3, Number.NaN), 2, "a non-number reads as the latest, never as 0");
});

test("stepVoiceIndex: the ends are real — no wrap", () => {
  assert.equal(stepVoiceIndex(3, 0, -1), 0, "older than the first is still the first");
  assert.equal(stepVoiceIndex(3, 2, 1), 2, "newer than the last is still the last");
  assert.equal(stepVoiceIndex(3, 1, -1), 0);
  assert.equal(stepVoiceIndex(3, 1, 1), 2);
  assert.equal(stepVoiceIndex(0, 0, 1), -1);
});

test("nextVoicePosition: pinned readers follow the newest answer", () => {
  const entries = voiceEntries(THREAD);
  assert.equal(nextVoicePosition(entries, { id: "a1", pinned: true }), 2);
  assert.equal(nextVoicePosition(entries, { id: null, pinned: false }), 2, "nothing held yet -> latest");
});

test("nextVoicePosition: an unpinned reader keeps their place BY ID", () => {
  const entries = voiceEntries(THREAD);
  assert.equal(nextVoicePosition(entries, { id: "a1", pinned: false }), 0);
  // The same held answer after two more replies landed: still index 0, and the
  // point of joining by id rather than by number.
  const grown = voiceEntries([...THREAD, turn("u3", "user", "more"), turn("a4", "assistant", "More.")]);
  assert.equal(nextVoicePosition(grown, { id: "a1", pinned: false }), 0);
});

test("nextVoicePosition: a held answer that no longer exists falls back to the newest", () => {
  const entries = voiceEntries(THREAD);
  assert.equal(nextVoicePosition(entries, { id: "optimistic-7", pinned: false }), 2);
  assert.equal(nextVoicePosition([], { id: "a1", pinned: false }), -1);
});
