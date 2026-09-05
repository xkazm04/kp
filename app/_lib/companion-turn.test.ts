// The route's message clamp, the derived thread title, the transcript window and
// the grounding summary — the four decisions the companion route makes before it
// spends anything. Pure by construction (companion-turn.ts imports nothing), so
// this runs without a database or next/server.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampCompanionMessage,
  coerceVoiceReply,
  companionRequestId,
  deriveThreadTitle,
  MAX_COMPANION_MESSAGE_CHARS,
  MAX_COMPANION_VOICE_CHARS,
  parseCompanionRequestId,
  pipelineSummary,
  promptEligibleTurns,
  transcriptWindow,
} from "./companion-turn.ts";

test("clamp bounds an oversized message at the CLI's own ceiling", () => {
  const long = "x".repeat(MAX_COMPANION_MESSAGE_CHARS + 500);
  assert.equal(clampCompanionMessage(long).length, MAX_COMPANION_MESSAGE_CHARS);
});

test("clamp trims, and refuses anything that is not a non-empty string", () => {
  assert.equal(clampCompanionMessage("  hello  "), "hello");
  for (const bad of ["", "   ", null, undefined, 42, {}, ["hi"]]) {
    assert.equal(clampCompanionMessage(bad), "", `expected "" for ${JSON.stringify(bad)}`);
  }
});

test("a derived title cuts on a word boundary and never exceeds the column", () => {
  const short = "Who is waiting on me?";
  assert.equal(deriveThreadTitle(short), short);
  const long = deriveThreadTitle(`${"word ".repeat(40)}end`);
  assert.ok(long.length <= 60, `title was ${long.length} chars`);
  assert.ok(!long.endsWith(" "), "title should not end in whitespace");
  assert.ok(long.endsWith("word"), "title should cut on a word boundary");
});

test("a title collapses whitespace so a pasted paragraph does not become a multi-line name", () => {
  assert.equal(deriveThreadTitle("two\n\nlines   here"), "two lines here");
});

test("the transcript window keeps the LAST twelve turns, oldest first", () => {
  const turns = Array.from({ length: 20 }, (_, i) => ({ role: "user", content: `m${i}` }));
  const win = transcriptWindow(turns);
  assert.equal(win.length, 12);
  assert.equal(win[0].content, "m8");
  assert.equal(win[11].content, "m19");
});

test("the grounding summary counts only ACTIVE entries and carries their top candidates", () => {
  const summary = pipelineSummary([
    { stage: "Screen", status: "active", jobTitle: "Backend engineer", matchScore: 80, candidateLabel: "Alice A" },
    { stage: "Screen", status: "active", jobTitle: "Backend engineer", matchScore: 60, candidateLabel: "Bob B" },
    { stage: "Offer", status: "active", jobTitle: "Designer", matchScore: null, candidateLabel: "Cara C" },
    { stage: "Screen", status: "rejected", jobTitle: "Backend engineer", matchScore: 99, candidateLabel: "Zed Z" },
  ]);
  assert.equal(summary.activeEntries, 3);
  assert.deepEqual(summary.byStage, { Screen: 2, Offer: 1 });
  assert.deepEqual(summary.topRoles, [
    {
      role: "Backend engineer",
      entries: 2,
      // Sorted by score desc — the comparison table's raw material (decision 2026-08-24).
      candidates: [
        { label: "Alice A", matchScore: 80, stage: "Screen" },
        { label: "Bob B", matchScore: 60, stage: "Screen" },
      ],
    },
    { role: "Designer", entries: 1, candidates: [{ label: "Cara C", matchScore: null, stage: "Offer" }] },
  ]);
  // Mean over the two entries that HAVE a score; the unscored one is not a zero.
  assert.equal(summary.meanMatchScore, 70);
  assert.ok(!JSON.stringify(summary).includes("99"), "a rejected entry must not reach the model");
  assert.ok(!JSON.stringify(summary).includes("Zed"), "a rejected candidate must not reach the model");
});

// The spoken channel's boundary (V1). It crosses the same two frontiers `blocks`
// does — a spawned process's stdout and a `meta_json` column written by an older
// build — so it is shaped here rather than trusted.

test("a well-formed spoken reply survives the boundary with its provenance", () => {
  assert.deepEqual(coerceVoiceReply({ text: "  Four are waiting.  ", source: "model" }), {
    text: "Four are waiting.",
    source: "model",
  });
});

test("an unknown provenance reads as derived rather than as a composition for the ear", () => {
  // "model" is a claim about how the text was written, and only the CLI can make
  // it. Anything else — absent, misspelled, injected — is the humbler answer.
  assert.equal(coerceVoiceReply({ text: "x.", source: "handwritten" })?.source, "derived");
  assert.equal(coerceVoiceReply({ text: "x." })?.source, "derived");
});

test("a spoken reply is bounded to one synthesis chunk at the boundary too", () => {
  const long = "a".repeat(MAX_COMPANION_VOICE_CHARS + 200);
  assert.equal(coerceVoiceReply({ text: long, source: "model" })?.text.length, MAX_COMPANION_VOICE_CHARS);
});

test("no spoken reply is null, not an empty utterance", () => {
  // A turn stored before V1 carries none. Null is what lets the dock fall back
  // to the prose; an empty string would be an utterance with nothing in it.
  for (const raw of [undefined, null, {}, { text: "   " }, { text: 4 }, [], "text", { text: "", source: "model" }]) {
    assert.equal(coerceVoiceReply(raw), null, `expected null for ${JSON.stringify(raw)}`);
  }
});

test("an empty board summarises to nothing rather than to zeros that read as facts", () => {
  const summary = pipelineSummary([]);
  assert.equal(summary.activeEntries, 0);
  assert.deepEqual(summary.byStage, {});
  assert.deepEqual(summary.topRoles, []);
  assert.equal(summary.meanMatchScore, null);
});

// ---- what the model is allowed to READ BACK -------------------------------
//
// An outage reply ("I could not reach a model") is a real turn: it is what she
// said, so the dock keeps showing it. It is NOT history the next prompt should
// stand on — replayed as transcript, the first answer after a key is finally
// configured reads as if she is still broken, because the last thing in her
// context is her own apology. The brain already refuses to remember these as
// episodes (companion_cli.py::_worth_remembering); the window is the other half.

test("an outage reply is kept on screen but never replayed into the prompt", () => {
  const turns = [
    { role: "user", content: "who is waiting on me?" },
    { role: "assistant", content: "I could not reach a model.", source: "deterministic" as const },
    { role: "user", content: "try again" },
    { role: "assistant", content: "Two candidates are waiting.", source: "llm" as const },
  ];
  assert.deepEqual(promptEligibleTurns(turns), [turns[0], turns[2], turns[3]]);
  assert.deepEqual(transcriptWindow(turns), [
    { role: "user", content: "who is waiting on me?" },
    { role: "user", content: "try again" },
    { role: "assistant", content: "Two candidates are waiting." },
  ]);
});

test("only an assistant's deterministic turn is dropped, and only on its own say-so", () => {
  // A USER turn has no `source` and is never a candidate for the drop; an
  // assistant turn stored before the field existed (undefined) is history we
  // cannot prove is an outage, so it stays — dropping it would silently shorten
  // every old conversation.
  const kept = [
    { role: "user", content: "u" },
    { role: "assistant", content: "old reply" },
    { role: "assistant", content: "llm reply", source: "llm" as const },
  ];
  assert.deepEqual(promptEligibleTurns(kept), kept);
});

test("the window is taken AFTER the drop, so a purged tail still fills it", () => {
  const turns = [
    ...Array.from({ length: 20 }, (_, i) => ({ role: "assistant", content: `outage ${i}`, source: "deterministic" as const })),
    { role: "user", content: "real" },
  ];
  const win = transcriptWindow(turns, 12);
  assert.deepEqual(win, [{ role: "user", content: "real" }]);
});

// ---- the ledger's name for one turn ---------------------------------------

test("a companion request id names the turn, and parses back to it", () => {
  const id = companionRequestId("cthread-abc-1", "cturn-def-2");
  assert.equal(id, "companion:cthread-abc-1:cturn-def-2");
  assert.deepEqual(parseCompanionRequestId(id), { threadId: "cthread-abc-1", turnId: "cturn-def-2" });
});

test("a LEGACY bare thread id still resolves to its conversation", () => {
  // Rows written before this stamped the thread id alone. They are real spend
  // and must keep rendering; only the turn is unknown.
  assert.deepEqual(parseCompanionRequestId("cthread-abc-1"), { threadId: "cthread-abc-1", turnId: null });
});

test("anything that is not a companion id is left to the task resolver", () => {
  for (const other of ["", "   ", null, undefined, "task-l9x2k1-a8f3qz", "companion:", "cturn-abc-1"]) {
    assert.equal(parseCompanionRequestId(other), null, `expected null for ${JSON.stringify(other)}`);
  }
});
