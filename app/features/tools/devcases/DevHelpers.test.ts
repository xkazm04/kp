import test from "node:test";
import assert from "node:assert/strict";

// Relative import (no "@/" alias hooks needed): DevHelpers' only dependency is a
// type-only DevTypes import, which Node's type stripping erases entirely.
const { caseToMarkdown, findingsSource, approveFallbackFor } = await import("./DevHelpers.ts");
// The real approve gate, so the code literal the review panel keys off can't drift
// away from the one the route returns. Pure + import-free by design.
const { enforceProbeGate } = await import("../../../_lib/devcase-probe-audit.ts");

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

test("findingsSource reads the EVALUATE step, not the combined run source", () => {
  // The combined source is "partial" for ANY mix. A run whose evaluate step really
  // called the LLM produced a real LLM verdict — telling the recruiter to "re-run
  // with the LLM" would relabel it a template artifact.
  assert.equal(findingsSource({ source: "partial", perStepSources: { reflect: "deterministic", evaluate: "llm" } }), "llm");
  // …and the converse: an LLM-heavy run whose evaluate step fell back is a template read.
  assert.equal(findingsSource({ source: "partial", perStepSources: { reflect: "llm", evaluate: "deterministic" } }), "deterministic");
  // Bundles saved before the per-step envelope carry no map — fall back to the run source.
  assert.equal(findingsSource({ source: "llm" }), "llm");
  assert.equal(findingsSource({ source: "deterministic", perStepSources: {} }), "deterministic");
  // Nothing known is null, never a confident "template".
  assert.equal(findingsSource({}), null);
});

test("the review panel's probe-gate fallback keys off the code the gate really returns", () => {
  // A case with no load-bearing probes is what the gate refuses, and the refusal
  // must reach the reviewer as the probe verdict — not the generic "Approve failed."
  const refusal = enforceProbeGate([{ kind: "legacy_trap" }], false);
  assert.equal(refusal.ok, false);
  const code = refusal.ok === false ? refusal.code : null;
  assert.equal(approveFallbackFor(code, { probeGate: "PROBE", generic: "GENERIC" }), "PROBE");
  // Every other failure keeps the caller's generic message.
  assert.equal(approveFallbackFor(undefined, { probeGate: "PROBE", generic: "GENERIC" }), "GENERIC");
  assert.equal(approveFallbackFor("db_busy", { probeGate: "PROBE", generic: "GENERIC" }), "GENERIC");
  // A passing gate raises nothing to fall back from.
  assert.equal(enforceProbeGate([{ kind: "k", where: "a.py", reveals: "r", decisionSpace: ["x", "y"] }], false).ok, true);
});
