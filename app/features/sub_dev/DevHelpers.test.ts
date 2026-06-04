import test from "node:test";
import assert from "node:assert/strict";

// Relative import (no "@/" alias hooks needed): DevHelpers' only dependency is a
// type-only DevTypes import, which Node's type stripping erases entirely.
const { caseToMarkdown } = await import("./DevHelpers.ts");

test("caseToMarkdown composes the candidate-facing document, in order", () => {
  const md = caseToMarkdown(
    {
      title: "Stabilize the ingest path",
      brief: "Error budget burned 4x.\nDiagnose and fix.",
      repoSeed: "A three-repo bundle.",
      tasks: ["Root-cause both symptoms", "Fix the\noffset ordering"],
      timeboxHours: 6,
    },
    { title: "Senior Backend Engineer", seniority: "senior" }
  );
  const lines = md.split("\n");
  assert.equal(lines[0], "# Stabilize the ingest path");
  assert.ok(md.includes("**Senior Backend Engineer · senior · ~6h timebox**"));
  // section order: Brief → What you're handed → Tasks
  assert.ok(md.indexOf("## Brief") < md.indexOf("## What you're handed"));
  assert.ok(md.indexOf("## What you're handed") < md.indexOf("## Tasks"));
  // an ordered-list item must stay on one line for the renderer
  assert.ok(md.includes("2. Fix the offset ordering"));
});

test("caseToMarkdown never includes internal material (probes / rubric / decision spaces)", () => {
  const md = caseToMarkdown(
    {
      title: "T",
      brief: "b",
      tasks: ["t"],
      coverProbes: [{ id: "p1", kind: "legacy_trap", where: "old.py", reveals: "SECRET-REVEALS", decisionSpace: ["SECRET-OPTION"] }],
      rubricDimensions: [{ name: "judgment", label: "Judgment", weight: 0.25 }],
      timeboxHours: 4,
    },
    null
  );
  assert.ok(!md.includes("SECRET-REVEALS"));
  assert.ok(!md.includes("SECRET-OPTION"));
  assert.ok(!/probe/i.test(md));
  assert.ok(!/judgment/i.test(md));
});

test("caseToMarkdown degrades gracefully on an empty case", () => {
  const md = caseToMarkdown({}, null);
  assert.equal(md, "# Assignment");
});
