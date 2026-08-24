// The route's message clamp, the derived thread title, the transcript window and
// the grounding summary — the four decisions the companion route makes before it
// spends anything. Pure by construction (companion-turn.ts imports nothing), so
// this runs without a database or next/server.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampCompanionMessage,
  deriveThreadTitle,
  MAX_COMPANION_MESSAGE_CHARS,
  pipelineSummary,
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

test("an empty board summarises to nothing rather than to zeros that read as facts", () => {
  const summary = pipelineSummary([]);
  assert.equal(summary.activeEntries, 0);
  assert.deepEqual(summary.byStage, {});
  assert.deepEqual(summary.topRoles, []);
  assert.equal(summary.meanMatchScore, null);
});
