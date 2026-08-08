// The live JD-draft builder (intake-draft.ts) — a deterministic client render
// of the RoleBrief; the FINAL JD stays with the Promote build.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { briefDraftHasContent, briefDraftMarkdown, type DraftStrings } from "./intake-draft.ts";
import type { RoleBrief } from "./rolespec.ts";

const S: DraftStrings = {
  untitled: "Untitled role",
  level: (s) => `${s} level`,
  aboutRole: "About the role",
  outcomes: "What success looks like (first 90 days)",
  responsibilities: "Responsibilities",
  whatBring: "What you'll bring",
  niceToHave: "Nice to have",
  languages: "Languages",
};

const brief: RoleBrief = {
  title: "Data Analyst",
  seniority: "senior",
  spineProvenance: { seniority: "stated" },
  summary: "Reporting keeps slipping.",
  successCriteria: ["Weekly reporting runs itself"],
  responsibilities: ["Own the dashboards"],
  requirements: [
    { skill: "SQL", kind: "must_have", hardness: "prerequisite", weight: 0.8, rationale: "", provenance: "stated", confidence: 0.9 },
    { skill: "dbt", kind: "nice_to_have", hardness: "learnable", weight: 0.4, rationale: "", provenance: "stated", confidence: 0.9 },
  ],
  languages: ["Czech", "English"],
};

test("draft renders the posting shape in section order", () => {
  const md = briefDraftMarkdown(brief, S);
  assert.ok(md.startsWith("# Data Analyst"));
  assert.ok(md.includes("**senior level**"));
  const order = [
    "## About the role",
    "## What success looks like (first 90 days)",
    "## Responsibilities",
    "## What you'll bring",
    "## Nice to have",
    "## Languages",
  ].map((h) => md.indexOf(h));
  assert.ok(order.every((i) => i >= 0), md);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(md.includes("- SQL"));
  assert.ok(md.includes("- dbt"));
});

test("a DEFAULT seniority never prints as a decided level (the provenance law)", () => {
  const md = briefDraftMarkdown({ ...brief, spineProvenance: {} }, S);
  assert.ok(!md.includes("senior level"));
});

test("empty sections collapse; empty brief has no content", () => {
  const md = briefDraftMarkdown({ title: "X" }, S);
  assert.ok(!md.includes("## "));
  assert.equal(briefDraftHasContent(null), false);
  assert.equal(briefDraftHasContent({}), false);
  assert.equal(briefDraftHasContent({ title: "X" }), true);
});
