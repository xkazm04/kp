import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeImportedQuestions, normalizeIncoming, readImported, MAX_IMPORT_QUESTIONS, MAX_IMPORT_QUESTION_LEN } from "./importMerge.ts";

// Direction 2 — the interview-kit → prep-pack import. These are the guards the
// route relies on: duplicate-import idempotency, order preservation, caps, and the
// defensive reads at the trust boundary. Direction 3 turned the stored shape into
// { question, blockRef? } entries, so `prior` is entries and new imports append as
// unassigned {question}.

const q = (question: string) => ({ question });

test("re-importing the same kit is a no-op (duplicate-import guard)", () => {
  const kit = ["Tell me about a time you shipped under pressure.", "How do you handle disagreement?"];
  const first = mergeImportedQuestions([], kit);
  assert.deepEqual(first, kit.map(q));
  // A second import of the same content must not stack copies.
  const second = mergeImportedQuestions(first, kit);
  assert.deepEqual(second, kit.map(q));
  assert.equal(second.length, kit.length);
});

test("new questions append after prior ones, order preserved", () => {
  const prior = [q("Q1"), q("Q2")];
  const merged = mergeImportedQuestions(prior, ["Q2", "Q3", "Q1", "Q4"]);
  assert.deepEqual(merged, [q("Q1"), q("Q2"), q("Q3"), q("Q4")]);
});

test("the import is capped so a crafted body can't balloon the payload", () => {
  const prior = Array.from({ length: MAX_IMPORT_QUESTIONS - 1 }, (_, i) => q(`p${i}`));
  const merged = mergeImportedQuestions(prior, ["new-a", "new-b", "new-c"]);
  assert.equal(merged.length, MAX_IMPORT_QUESTIONS);
  assert.deepEqual(merged[MAX_IMPORT_QUESTIONS - 1], q("new-a")); // only the first that fit
});

test("normalizeIncoming keeps clean strings, trims, caps length, drops junk", () => {
  const long = "x".repeat(MAX_IMPORT_QUESTION_LEN + 50);
  const out = normalizeIncoming(["  spaced  ", "", "   ", 42, null, { q: 1 }, long]);
  assert.deepEqual(out.slice(0, 1), ["spaced"]);
  assert.equal(out.length, 2); // "spaced" + the (truncated) long one
  assert.equal(out[1].length, MAX_IMPORT_QUESTION_LEN);
});

test("normalizeIncoming returns [] for a non-array body", () => {
  assert.deepEqual(normalizeIncoming(undefined), []);
  assert.deepEqual(normalizeIncoming("not-an-array"), []);
});

test("readImported tolerates a missing / malformed key", () => {
  assert.deepEqual(readImported({}), []);
  assert.deepEqual(readImported({ importedQuestions: "nope" }), []);
  assert.deepEqual(readImported({ importedQuestions: ["a", 1, "b", null] }), ["a", "b"]);
});
