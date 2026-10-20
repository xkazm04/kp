// The shared quote → turn matcher (app/_lib/quote-match.ts): the lenient defaults the
// transcript modal reads with, and the strict options the interview director verifies
// a `mark_topic_covered` evidence quote with.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchQuoteToTurn, normalizeQuoteText } from "./quote-match.ts";
import { EVIDENCE_QUOTE_MATCH } from "./voice/director.ts";

const TURNS = [
  "Tell me about a system you designed.",
  "So basically, I was leading the migration from our monolith to Kubernetes — it took six months.",
  "Yes.",
  "We cut deploy time from two hours",
  "to about ten minutes, mostly by caching the Docker layers.",
];

test("normalization ignores case, punctuation, diacritics and whitespace", () => {
  assert.equal(normalizeQuoteText("  Příliš   ŽLUŤOUČKÝ kůň — úpěl!  "), "prilis zlutoucky kun upel");
  assert.equal(normalizeQuoteText("Kubernetes, (K8s)."), "kubernetes k8s");
});

test("containment wins, whatever the casing and punctuation", () => {
  assert.equal(matchQuoteToTurn("leading the MIGRATION from our monolith to kubernetes", TURNS), 1);
  assert.equal(matchQuoteToTurn("leading the migration from our monolith to Kubernetes", TURNS, EVIDENCE_QUOTE_MATCH), 1);
});

test("a sentence the recognizer split across two turns still matches", () => {
  assert.equal(matchQuoteToTurn("from two hours to about ten minutes", TURNS, EVIDENCE_QUOTE_MATCH), 3);
});

test("word overlap accepts the model's own rendering of the candidate's words", () => {
  // The realtime model heard the audio; the stored text is the provider's transcription.
  assert.equal(matchQuoteToTurn("I led the migration of the monolith onto Kubernetes", TURNS, EVIDENCE_QUOTE_MATCH), 1);
});

test("a fabricated summary does not match under the director's options", () => {
  assert.equal(matchQuoteToTurn("The candidate demonstrated strong leadership skills", TURNS, EVIDENCE_QUOTE_MATCH), -1);
});

test("the director never accepts a summary that merely CONTAINS a short turn", () => {
  const turns = ["Yes, I did it myself."];
  const summary = "Yes, I did it myself, owning the full Kafka rollout across three teams";
  assert.equal(matchQuoteToTurn(summary, turns), 0, "the lenient (modal) reading accepts the turn inside the quote");
  assert.equal(matchQuoteToTurn(summary, turns, EVIDENCE_QUOTE_MATCH), -1, "the director does not");
});

test("too-short quotes and empty inputs never match", () => {
  assert.equal(matchQuoteToTurn("Yes.", TURNS), -1);
  assert.equal(matchQuoteToTurn("", TURNS), -1);
  assert.equal(matchQuoteToTurn("leading the migration", []), -1);
});
