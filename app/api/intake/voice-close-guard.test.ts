// Source + unit guard for the CLOSE of an intake dialog — the two rules that
// were both broken at once when a requestor confirmed the read-back by voice:
//
//   1. The `<<END>>` sentinel is engine wire contract and must be stripped at
//      the route boundary of BOTH planes. /voice-turn's reply is handed to the
//      transport with "say this exactly, verbatim", so an unstripped token was
//      spoken aloud as the closing line and persisted into the transcript.
//   2. /voice-complete must accept a session that /voice-turn JUST closed —
//      the closing extraction sweep and the hang-up recovery POST both arrive
//      after the flip to `complete`. Only `promoted` is frozen.
//
// Source-guard style (mirrors attachments-guard.test.ts / rate-limit-contract
// .test.ts): node:test cannot resolve the "@/" alias, so the route halves are
// asserted over the source text; the pure helper is imported directly.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripEndSentinel } from "./reply-sentinel.ts";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const voiceTurn = read("./[id]/voice-turn/route.ts");
const message = read("./[id]/message/route.ts");
const voiceComplete = read("./[id]/voice-complete/route.ts");

test("stripEndSentinel: the sentinel never survives, on either engine path", () => {
  // The scripted keyless close (pipeline/jobfit/intake.py::_close_reply), both languages.
  assert.equal(
    stripEndSentinel("Thanks for confirming. The brief is closed and ready to promote. <<END>>"),
    "Thanks for confirming. The brief is closed and ready to promote."
  );
  assert.equal(
    stripEndSentinel("Děkuji za potvrzení. Zadání je uzavřené. <<END>>"),
    "Děkuji za potvrzení. Zadání je uzavřené."
  );
  // Mid-utterance / repeated occurrences collapse to a single space, never a join.
  assert.equal(stripEndSentinel("Done here.<<END>>Anything else?"), "Done here. Anything else?");
  assert.equal(stripEndSentinel("a <<END>> b <<END>>"), "a b");
  // Ordinary copy is untouched (no over-eager trimming of real punctuation).
  assert.equal(stripEndSentinel("So: Go, or Rust — which?"), "So: Go, or Rust — which?");
});

test("voice-turn: the spoken reply is stripped before it is stored, spoken or returned", () => {
  assert.match(voiceTurn, /import \{ stripEndSentinel \}/);
  assert.ok(voiceTurn.includes("const reply = stripEndSentinel(turn.reply);"), "must strip the engine reply");
  // The stripped copy is what reaches the transcript AND the transport.
  assert.ok(voiceTurn.includes('{ role: "interviewer" as const, text: reply, at: now }'));
  assert.ok(!/text:\s*turn\.reply/.test(voiceTurn), "the raw engine reply must not be persisted");
  assert.ok(!/reply:\s*turn\.reply/.test(voiceTurn), "the raw engine reply must not be returned to the transport");
});

test("message: the text plane strips through the same shared helper", () => {
  assert.match(message, /import \{ stripEndSentinel \}/);
  assert.ok(message.includes("const reply = stripEndSentinel(exchange.reply);"));
  assert.ok(!/text:\s*exchange\.reply/.test(message), "the raw engine reply must not be persisted");
});

test("voice-complete: a just-closed session still gets its final sweep; only promoted is frozen", () => {
  assert.ok(
    voiceComplete.includes('if (intake.status !== "open" && intake.status !== "complete")'),
    "the closing extraction + hang-up recovery arrive AFTER /voice-turn flips the session to complete"
  );
  // The refusal that remains is the promoted freeze (the JD exists).
  const guardAt = voiceComplete.indexOf('intake.status !== "open" && intake.status !== "complete"');
  assert.match(voiceComplete.slice(guardAt, guardAt + 300), /status:\s*409/);
  // Nothing in this route may CLOSE a session — the close travels through
  // /voice-turn (spoken confirm) or the text plane.
  assert.ok(!/status:\s*"complete"\s*as const/.test(voiceComplete));
});
