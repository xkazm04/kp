import test from "node:test";
import assert from "node:assert/strict";

// Relative import (no "@/" alias hooks needed): DevHelpers' only dependency is a
// type-only DevTypes import, which Node's type stripping erases entirely.
const { caseToMarkdown, findingsSource, approveFallbackFor } = await import("./DevHelpers.ts");
// The real approve gate, so the code literal the review panel keys off can't drift
// away from the one the route returns. Pure + import-free by design.
const { enforceProbeGate } = await import("../../../_lib/devcase-probe-audit.ts");
// The policy cap, read from the generated taxonomy rather than re-typed: the number
// this document prints is the one the cap says, whatever the cap becomes.
const { DEVCASE_MAX_TIMEBOX_HOURS } = await import("../../../_lib/devcase-timebox.ts");

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
  assert.ok(md.includes(`**Senior Backend Engineer · senior · ~${DEVCASE_MAX_TIMEBOX_HOURS}h timebox**`), md);
  // section order: Brief → What you're handed → Tasks
  assert.ok(md.indexOf("## Brief") < md.indexOf("## What you're handed"));
  assert.ok(md.indexOf("## What you're handed") < md.indexOf("## Tasks"));
  // an ordered-list item must stay on one line for the renderer
  assert.ok(md.includes("2. Fix the offset ordering"));
});

test("caseToMarkdown prints the CLAMPED timebox, the same number the design card shows", () => {
  // The saved-assignment reader printed `kase.timeboxHours` raw while the design
  // card one step earlier printed timeboxHoursForDisplay() of the same field. A
  // reviewer who typed 6 saw "~2h" on approval and "~6h timebox" in the document
  // they can copy to a candidate — and the document is the artifact that actually
  // travels. One producer for the number now (app/_lib/devcase-timebox.ts), which
  // is where the policy cap lives.
  const md = caseToMarkdown({ title: "T", brief: "b", timeboxHours: 6 }, null);
  assert.ok(md.includes(`~${DEVCASE_MAX_TIMEBOX_HOURS}h timebox`), md);
  assert.ok(!md.includes("~6h"), "the unclamped number must never reach the candidate-facing document");
  // A missing/garbage value falls back to the cap rather than vanishing or inventing one.
  assert.ok(caseToMarkdown({ title: "T" }, null).includes(`~${DEVCASE_MAX_TIMEBOX_HOURS}h timebox`));
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
  // An empty case still states a timebox: timeboxHoursForDisplay answers the policy
  // cap for a missing value ("the largest thing any candidate can actually be
  // handed"), which is exactly what the design card already shows unconditionally.
  // Silence here would be the only place in the flow that promises nothing.
  const md = caseToMarkdown({}, null);
  assert.equal(md, `# Assignment

**~${DEVCASE_MAX_TIMEBOX_HOURS}h timebox**`);
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

// ---- D2: the three helpers the review drawer, the voice panel and the need form
// ---- decide with, extracted so they can be asserted instead of read.

const { caseEdits, observedMean, isSupportedRepoRef } = await import("./DevHelpers.ts");

test("caseEdits sends only what actually changed", () => {
  const kase = { title: "T", brief: "B", tasks: ["a", "b"], timeboxHours: 2 };
  const same = caseEdits(kase, { title: "T", brief: "B", tasks: ["a", "b"], timeboxHours: 2 });
  assert.deepEqual(same.edits, {});
  assert.equal(same.blocked, null);

  const changed = caseEdits(kase, { title: " T2 ", brief: "B", tasks: ["a", "b", "c"], timeboxHours: 1 });
  assert.deepEqual(changed.edits, { title: "T2", tasks: ["a", "b", "c"], timeboxHours: 1 });
  assert.equal(changed.blocked, null);
  // A blanked title/brief is not an edit: the field falls back to the stored value
  // (the same rule the panel's live preview uses), so Approve never sends an empty one.
  assert.deepEqual(caseEdits(kase, { title: "  ", brief: "  ", tasks: ["a", "b"], timeboxHours: 2 }).edits, {});
});

test("caseEdits REFUSES a full task-list clear instead of dropping it silently", () => {
  // The four-branch diff this replaces guarded the tasks edit with
  // `editedTasks.length > 0`, so emptying the textarea produced NO tasks key at all:
  // the reviewer watched the candidate-safe preview lose every task, pressed Approve,
  // and the assignment went out with the tasks still on it. An assignment with no
  // tasks is not a thing we hand a candidate either, so the clear is REFUSED — named
  // on screen — rather than sent.
  const kase = { title: "T", brief: "B", tasks: ["a"], timeboxHours: 2 };
  const cleared = caseEdits(kase, { title: "T", brief: "B", tasks: [], timeboxHours: 2 });
  assert.equal(cleared.blocked, "tasksCleared");
  assert.equal("tasks" in cleared.edits, false, "a refused clear must never reach the wire");
  // A case that never had tasks is not "cleared" — nothing to refuse.
  assert.equal(caseEdits({ title: "T" }, { title: "T", brief: "", tasks: [], timeboxHours: null }).blocked, null);
});

test("observedMean averages only the ratings that were really assessed", () => {
  // The synthesis rates an untouched competency 3/5 with "Not assessed…" evidence.
  // Averaging those drags a partial interview toward a middling 3 that looks like a
  // judgement and is not one.
  const sc = {
    ratings: [
      { competency: "a", rating: 5, evidence: "shipped the migration" },
      { competency: "b", rating: 3, evidence: "Not assessed in this conversation." },
      { competency: "c", rating: 4, evidence: "walked the failure path" },
    ],
  };
  assert.equal(observedMean(sc as never), 4.5);
  // Nothing assessed is null, never 3.
  assert.equal(observedMean({ ratings: [{ competency: "a", rating: 3, evidence: "Not assessed." }] } as never), null);
  assert.equal(observedMean({ ratings: [] } as never), null);
  assert.equal(observedMean(null), null);
});

test("isSupportedRepoRef warns on exactly the refs the grounding cannot fetch", () => {
  assert.equal(isSupportedRepoRef(""), true, "no codebase is a valid choice, not a warning");
  assert.equal(isSupportedRepoRef("   "), true);
  assert.equal(isSupportedRepoRef("https://github.com/owner/repo"), true);
  assert.equal(isSupportedRepoRef("http://www.github.com/owner/repo.git"), true);
  assert.equal(isSupportedRepoRef("owner/repo"), true, "a bare owner/repo is the documented short form");
  assert.equal(isSupportedRepoRef("https://gitlab.com/owner/repo"), false);
  assert.equal(isSupportedRepoRef("https://bitbucket.org/o/r"), false);
  assert.equal(isSupportedRepoRef("owner/repo/extra"), false);
  assert.equal(isSupportedRepoRef("not a url"), false);
});
