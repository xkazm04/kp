// Behavioral coverage for the one-call drawer bundle + the entity-scoped analysis
// join (perfect-board Direction 2). The headline: two SAME-NAMED candidates in
// one workspace must NOT inherit each other's analysis history. Analyses carry no
// entry/candidate FK — only a free-text label + a jd_slug — so the join uses the
// strict (label + jd_slug↔jobId) identity contract the canonical match score
// uses; a same-named stranger analyzed for a DIFFERENT role no longer leaks in.
//
// unit-db.ts MUST be the first project import.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import { saveAnalysis } from "./db/analyses.ts";
import { recordOutbox } from "./db/devcase.ts";
import { candidateDrawerBundle } from "./candidate-timeline.ts";

after(() => cleanupUnitDb());

test("same-named candidates on different JD-backed jobs do NOT inherit each other's analyses", () => {
  const NAME = "Jan Novák"; // two real, distinct people who happen to share a name
  // Two entries, same label, DIFFERENT JD-backed jobs (jobId `jd-<slug>`).
  const a = createPipelineEntry({ candidateId: "cand-fe", candidateLabel: NAME, jobId: "jd-frontend", jobTitle: "Frontend Engineer" });
  const b = createPipelineEntry({ candidateId: "cand-be", candidateLabel: NAME, jobId: "jd-backend", jobTitle: "Backend Engineer" });
  assert.ok(a.created && b.created);

  // One analysis per person, keyed to THEIR role's jd_slug (same shared label).
  const feAnalysis = saveAnalysis({ candidateLabel: NAME, jdSlug: "frontend", score: 81, roleFamily: "engineering", seniority: "mid", payload: {} });
  const beAnalysis = saveAnalysis({ candidateLabel: NAME, jdSlug: "backend", score: 62, roleFamily: "engineering", seniority: "mid", payload: {} });

  const bundleA = candidateDrawerBundle(a.entry.id);
  assert.ok(bundleA, "the entry resolves");
  const analysisSlugsA = bundleA!.items.filter((i) => i.kind === "analysis").map((i) => i.slug);
  assert.deepEqual(analysisSlugsA, [feAnalysis.slug], "the frontend entry sees ONLY its own job's analysis");
  assert.ok(!analysisSlugsA.includes(beAnalysis.slug), "the backend stranger's analysis must NOT leak in");
  // Job axis confirmed the identity ⇒ full confidence, no by-name caveat.
  assert.equal(bundleA!.items.find((i) => i.kind === "analysis")!.labelOnly, false);

  const bundleB = candidateDrawerBundle(b.entry.id);
  const analysisSlugsB = bundleB!.items.filter((i) => i.kind === "analysis").map((i) => i.slug);
  assert.deepEqual(analysisSlugsB, [beAnalysis.slug], "the backend entry sees ONLY its own job's analysis");
});

test("a corpus-job entry (no JD slug) flags its label-only analyses as reduced-confidence", () => {
  const NAME = "Petr Svoboda";
  // A non-JD-backed job — jobId is not `jd-<slug>`, so there's no job axis to
  // confirm identity; a label match is inherently by-name.
  const c = createPipelineEntry({ candidateId: "cand-corpus", candidateLabel: NAME, jobId: "corpus-role-7", jobTitle: "Ops Lead" });
  const an = saveAnalysis({ candidateLabel: NAME, jdSlug: "some-other-jd", score: 70, roleFamily: "ops", seniority: "senior", payload: {} });

  const bundle = candidateDrawerBundle(c.entry.id);
  const analysis = bundle!.items.find((i) => i.kind === "analysis" && i.slug === an.slug);
  assert.ok(analysis, "a corpus entry still surfaces its label matches");
  assert.equal(analysis!.labelOnly, true, "but flags them reduced-confidence (matched by name only)");
});

test("comms appear EXACTLY ONCE — in the comms letters, never duplicated as timeline items", () => {
  const e = createPipelineEntry({ candidateId: "cand-comm", candidateLabel: "Eva Dvořák", jobId: "jd-frontend", jobTitle: "Frontend Engineer" });
  recordOutbox({ recipient: "eva@example.com", subject: "Thanks for applying", body: "We received your application.", kind: "rejection", channel: "email", status: "queued", ref: e.entry.id });

  const bundle = candidateDrawerBundle(e.entry.id);
  assert.equal(bundle!.comms.length, 1, "the letter shows up in the comms section");
  assert.equal(bundle!.comms[0].subject, "Thanks for applying");
  // The timeline items no longer carry a comm kind at all — so a comm can never be
  // rendered twice (once as a letter, once in history).
  assert.equal(bundle!.items.some((i) => (i.kind as string) === "comm"), false, "no comm item duplicates the letter");
});

test("the bundle carries every drawer section in one payload", () => {
  const e = createPipelineEntry({ candidateId: "cand-shape", candidateLabel: "Shape Test", jobId: "jd-frontend", jobTitle: "Frontend Engineer" });
  const bundle = candidateDrawerBundle(e.entry.id);
  assert.ok(bundle, "resolves");
  assert.ok(Array.isArray(bundle!.items) && Array.isArray(bundle!.events) && Array.isArray(bundle!.comms), "items/events/comms are arrays");
  // createPipelineEntry logs an "added" event — proving events ride the same bundle.
  assert.ok(bundle!.events.some((ev) => ev.kind === "added"), "pipeline events ride the bundle");
  assert.equal(bundle!.interview, null, "no interview yet");
  assert.equal(bundle!.humanScorecard, null, "no human scorecard yet");
  assert.equal(candidateDrawerBundle("does-not-exist"), null, "an unknown entry is null (route → 404)");
});
