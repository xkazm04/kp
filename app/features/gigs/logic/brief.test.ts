// Pure logic for the research brief (brief.ts): difficulty bars, and the heading ids the
// server's assigner and the renderer's walk share.
// Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { briefHeadingResolver, briefHeadingText, difficultyBars } from "./brief.ts";

test("difficultyBars: unrated fills nothing - it is never drawn as easy", () => {
  assert.deepEqual((["easy", "moderate", "hard", "very_hard", "unrated"] as const).map(difficultyBars), [1, 2, 3, 4, 0]);
});

// ---------------------------------------------------------------------------
// The brief's heading ids: the server's assigner, the renderer's walk, one address space
// ---------------------------------------------------------------------------

/** The heading walk Markdown.tsx performs (fenced code skipped, the same trimmed
 *  `#{1,3}` rule), emitting what its `headingId` hook receives. node:test cannot render
 *  the .tsx component, so the walk is restated here; if Markdown.tsx's rule moves, move
 *  this with it. */
function rendererHeadings(markdown: string): { index: number; level: 1 | 2 | 3; text: string }[] {
  const out: { index: number; level: 1 | 2 | 3; text: string }[] = [];
  let fenced = false;
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const t = line.trim();
    if (t.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const m = /^(#{1,3})\s+(.*)$/.exec(t);
    if (m) out.push({ index: out.length, level: m[1].length as 1 | 2 | 3, text: m[2] });
  }
  return out;
}

test("briefHeadingResolver renders exactly the ids the server's one assigner minted (duplicates, emoji, non-Latin, escapes, fences)", async () => {
  const { parseGigBriefSections } = await import("@/app/_lib/gigs/research.ts");
  const md = [
    "## Overview",
    "Text.",
    "## Overview",
    "### 🚀🚀",
    "## Обзор",
    "```",
    "## not a heading inside a fence",
    "```",
    "## Stored \\*XSS\\* in \\[bio\\]",
    "### **Bold** and `code`",
    "## Overview",
  ].join("\n");
  const sections = parseGigBriefSections(md);
  const resolve = briefHeadingResolver(sections);
  const rendered = rendererHeadings(md).map(resolve);
  assert.deepEqual(rendered, sections.map((s) => s.id), "the renderer and the extractor agree id for id, in order");
  // The instrument fired the paths it exists for.
  assert.ok(rendered.includes("overview-2") && rendered.includes("overview-3"), "duplicate suffixes were exercised");
  assert.equal(rendered.filter((id) => /^section-\d+$/.test(id ?? "")).length, 2, "the emoji and the Cyrillic heading took the positional fallback");
  assert.ok(rendered.every((id) => typeof id === "string"), "every heading got an address");
  // Text agreement is what lets a divergent body degrade instead of mis-addressing.
  for (const [i, h] of rendererHeadings(md).entries()) assert.equal(briefHeadingText(h.text), sections[i].text);
});

test("briefHeadingResolver refuses rather than guesses when the body and its sections disagree", async () => {
  const { parseGigBriefSections } = await import("@/app/_lib/gigs/research.ts");
  const sections = parseGigBriefSections("## One\n## Two");
  const resolve = briefHeadingResolver(sections);
  assert.equal(resolve({ index: 0, level: 2, text: "One" }), "one");
  assert.equal(resolve({ index: 1, level: 2, text: "Changed" }), undefined, "text moved: no id");
  assert.equal(resolve({ index: 1, level: 3, text: "Two" }), undefined, "level moved: no id");
  assert.equal(resolve({ index: 2, level: 2, text: "Three" }), undefined, "past the end: no id");
  // Pure: asking twice (React may render twice) answers the same.
  assert.equal(resolve({ index: 0, level: 2, text: "One" }), "one");
});

test("briefHeadingResolver over a real assembled brief addresses all five fixed sections", async () => {
  const { buildLlmGigBrief } = await import("@/app/_lib/gigs/research.ts");
  const brief = buildLlmGigBrief(
    {
      category: "Web security · Stored XSS",
      title: "Stored XSS in the profile bio",
      difficulty: "hard",
      difficultyReason: "Needs a CSP bypass.",
      effort: { minHours: 12, maxHours: 20, note: null },
      challenges: ["CSP", "Sanitiser"],
      summary: "Find a stored XSS.",
      asks: ["A report"],
    },
    [{ url: "https://example.test/spec", title: "Spec", status: "fetched", reason: null, chars: 1200 }],
    { promptVersion: "gig-brief-v1", createdAt: "2026-09-24T00:00:00.000Z" }
  );
  const ids = rendererHeadings(brief.markdown).map(briefHeadingResolver(brief.sections));
  assert.deepEqual(ids, ["what-the-gig-is", "what-it-asks-for", "difficulty-and-effort", "expected-challenges", "sources-read"]);
  assert.ok(brief.markdown.includes("\n## Sources read\n"), "the page splits the body at this exact line (logic/briefBody.ts)");
});
