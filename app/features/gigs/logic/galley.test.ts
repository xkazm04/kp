// Pure logic for the proof's reading surfaces (reviewNote.ts, galley.ts, summary.ts): the
// reviewer agent's note read into parts, the margin notes it pins, the summary set for reading.
// Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DraftLintFinding } from "@/app/_lib/gigs/draft-lint.ts";
import { draftParagraphs, letterKey, paragraphSpans, pinNotes } from "./galley.ts";
import { parseReviewNote, quotedPhrases } from "./reviewNote.ts";
import { firstBriefSection, summaryMarkdown, summaryTextOf } from "./summary.ts";

const NOTE =
  "[Pre-send review by a reviewer agent for the operator - training cycle 2026-09-26] WARNINGS - operator decides. Before sending: 1) escape the line breaks in Q21. 2) Drop 'prevents repeats' or fix the refill logic. Checks run: node check.mjs -> OK | opened both PNGs Defects: BLOCKER: the shipped demo.html does not run | draftText claims 'served-question tracking prevents repeats'; 8 of 12 sessions repeated";

test("parseReviewNote reads header, lead, must-dos, checks and defects; nothing is dropped", () => {
  const n = parseReviewNote(NOTE)!;
  assert.equal(n.byAgent, true);
  assert.equal(n.cycle, "2026-09-26");
  assert.equal(n.verdict, "blocker");
  assert.equal(n.blockers, 1);
  assert.deepEqual(n.items, ["escape the line breaks in Q21.", "Drop 'prevents repeats' or fix the refill logic."]);
  assert.deepEqual(n.checks, ["node check.mjs -> OK", "opened both PNGs"]);
  assert.deepEqual(n.defects.map((d) => d.blocker), [true, false]);
  assert.match(n.lead, /^WARNINGS - operator decides\. Before sending:$/);
  const own = parseReviewNote("Looks fine, send it.")!;
  assert.equal(own.header, null);
  assert.equal(own.verdict, "note");
  assert.equal(parseReviewNote("  "), null);
});

test("quotedPhrases finds quoted phrases with a letter in them", () => {
  assert.deepEqual(quotedPhrases("Drop 'prevents repeats' or \"3x2\" and 'x'"), ["prevents repeats", "3x2"]);
});

test("draftParagraphs keeps each paragraph's first line and line count", () => {
  const p = draftParagraphs("Hi,\n\nFirst line\nsecond line\n\n\nLast");
  assert.deepEqual(p, [
    { text: "Hi,", firstLine: 1, lines: 1 },
    { text: "First line\nsecond line", firstLine: 3, lines: 2 },
    { text: "Last", firstLine: 7, lines: 1 },
  ]);
});

test("pinNotes: a lint excerpt lands on its line's paragraph; a quoting reviewer note pins; the rest are loose, never dropped", () => {
  const text = "Hello there.\n\nThe tracker prevents repeats.\nIt costs $500 for the build.";
  const paras = draftParagraphs(text);
  const lint: DraftLintFinding[] = [
    { id: "line:4:reward", severity: "warn", line: 4, messageKey: "rewardMentioned", params: { excerpt: "$500" } },
    { id: "cost:unreported", severity: "info", line: null, messageKey: "costUnreported", params: {} },
  ];
  const { pinned, loose } = pinNotes(paras, lint, parseReviewNote(NOTE));
  assert.deepEqual(pinned.map((n) => [n.key, n.para, n.source, paras[n.para].text.slice(n.start, n.end).toLowerCase()]), [
    ["a", 1, "review", "prevents repeats"],
    ["b", 1, "lint", "$500"],
  ]);
  // The blocker quotes nothing; the second defect quotes a longer phrase this draft does
  // not contain; must-do 1 quotes nothing. All three are listed, none lost.
  assert.deepEqual(loose.map((l) => l.role), ["defect", "defect", "must-do 1"], "a note that quotes nothing in the draft is listed, not lost");
});

test("paragraphSpans cuts plain and marked runs; overlapping notes share a run", () => {
  const text = "The tracker prevents repeats.";
  const n = (key: string, start: number, end: number) => ({ key, para: 0, start, end, source: "review" as const, blocker: false, finding: null, text: "x", role: "defect" });
  const spans = paragraphSpans(text, [n("a", 12, 28), n("b", 21, 28)]);
  assert.deepEqual(spans.map((s) => [s.text, s.mark?.map((m) => m.key) ?? null]), [
    ["The tracker ", null],
    ["prevents ", ["a"]],
    ["repeats", ["a", "b"]],
    [".", null],
  ]);
});

test("letterKey never repeats: a..z then aa", () => {
  assert.deepEqual([0, 1, 25, 26, 27].map(letterKey), ["a", "b", "z", "aa", "ab"]);
});

test("summaryMarkdown: a long plain paragraph becomes a lead and bullets; Markdown and short text are left as written", () => {
  const plain = "Built a calculus tutor prototype (demo.html) with 22 items. Security fix: evalAt now validates input. Partial credit uses tolerance 0.001 (0.998 fails). Screenshots retaken.";
  assert.equal(
    summaryMarkdown(plain),
    "Built a calculus tutor prototype (demo.html) with 22 items.\n\n- Security fix: evalAt now validates input.\n- Partial credit uses tolerance 0.001 (0.998 fails).\n- Screenshots retaken."
  );
  const md = "Built it.\n\n- one\n- **Check first:** two";
  assert.equal(summaryMarkdown(md), md);
  assert.equal(summaryMarkdown("One sentence. And a second one."), "One sentence. And a second one.");
  assert.equal(summaryMarkdown("  "), "");
});

test("firstBriefSection: the first ## section's body, null when there is none", () => {
  assert.equal(firstBriefSection("## What the gig is\nA tutor app.\n\n## What it asks for\n- x"), "A tutor app.");
  assert.equal(firstBriefSection("no headings here"), null);
  assert.equal(firstBriefSection("## Empty\n\n## Next\nbody"), null);
  assert.equal(firstBriefSection(null), null);
});

test("summaryTextOf: the summary as Markdown, else the brief's first section, else the whole listing", () => {
  assert.deepEqual(summaryTextOf("  Did it.  ", "## What\nA thing.", "Listing"), { kind: "summary", text: "Did it." });
  assert.deepEqual(summaryTextOf(null, "# T\n\n## What the gig is\nA thing.\n\n## Next\nx", "Listing"), { kind: "about", text: "A thing." });
  const long = "word ".repeat(400).trim();
  assert.deepEqual(summaryTextOf("   ", null, long), { kind: "listing", text: long });
});
