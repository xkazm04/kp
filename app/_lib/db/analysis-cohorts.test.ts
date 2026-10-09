// The Cohort Studio store (db/analysis-cohorts.ts) on a throwaway DB: the row round-trip,
// the member compare-and-swap, the narrow CV facts, and the erasure scrub that masks a
// member's name on the run sheet and inside the stored comments.
//
// unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";

const store = await import("./analysis-cohorts.ts");
const { saveAnalysis } = await import("./analyses.ts");
const { saveProfile } = await import("./profiles.ts");
const { createPipelineEntry, anonymizeEntry } = await import("./pipeline.ts");
const { ensureDb } = await import("./core.ts");

after(() => cleanupUnitDb());

const WS = "workspace";

function analysisFor(label: string, rawText: string, opts: { jdSlug?: string | null; cvHash?: string | null } = {}) {
  return saveAnalysis(
    {
      candidateLabel: label,
      jdSlug: opts.jdSlug ?? null,
      score: 60,
      roleFamily: "software_engineering",
      seniority: "senior",
      payload: { candidate: { name: label, rawText } },
      cvHash: opts.cvHash ?? null,
    },
    WS
  ).slug;
}

function cohortOf(slugs: Array<[string, string]>) {
  return store.createAnalysisCohort(
    {
      jdSlug: "role-x",
      blind: false,
      reportLang: "cs",
      members: slugs.map(([slug, label]) => ({ memberId: slug, label, membership: "applicant" as const, source: { kind: "analysis" as const, slug } })),
    },
    WS
  );
}

test("a cohort round-trips: queued, its order seed is its id, and a terminal status stamps finished_at", () => {
  const a = analysisFor("Round Trip", "CV text");
  const rec = cohortOf([[a, "Round Trip"]]);
  assert.equal(rec.status, "queued");
  assert.equal(rec.orderSeed, rec.id);
  const read = store.getAnalysisCohort(rec.id, WS);
  assert.deepEqual(read?.members, rec.members);
  assert.equal(read?.reportLang, "cs");
  assert.equal(read?.blind, false);
  assert.ok(store.setAnalysisCohortStatus(rec.id, "running", WS));
  assert.equal(store.getAnalysisCohort(rec.id, WS)?.finishedAt, null);
  assert.ok(store.setAnalysisCohortStatus(rec.id, "done", WS));
  assert.ok(store.getAnalysisCohort(rec.id, WS)?.finishedAt);
  const comments = { cells: [{ memberId: a, dimension: "fit" as const, comment: "Thin evidence." }], notes: { fit: "One rated." }, narrative: null };
  store.setAnalysisCohortComments(rec.id, comments, WS);
  assert.deepEqual(store.getAnalysisCohort(rec.id, WS)?.comments, comments);
});

test("a member update patches the run sheet it reads: a sibling member's write is never lost", () => {
  const a = analysisFor("Cas One", "CV one");
  const b = analysisFor("Cas Two", "CV two");
  const rec = cohortOf([
    [a, "Cas One"],
    [b, "Cas Two"],
  ]);
  assert.ok(store.updateAnalysisCohortMember(rec.id, a, { runState: "analyzing" }, WS));
  // A second writer moves member b with a raw UPDATE the first never saw; the next CAS on
  // a re-reads and keeps it.
  const row = ensureDb().prepare(`SELECT members_json FROM analysis_cohorts WHERE id = ? AND workspace_id = ?`).get(rec.id, WS) as { members_json: string };
  const moved = JSON.parse(row.members_json);
  moved[1].runState = "reused";
  moved[1].analysisSlug = b;
  ensureDb().prepare(`UPDATE analysis_cohorts SET members_json = ? WHERE id = ? AND workspace_id = ?`).run(JSON.stringify(moved), rec.id, WS);
  assert.ok(store.updateAnalysisCohortMember(rec.id, a, { runState: "done", analysisSlug: a }, WS));
  const members = store.getAnalysisCohort(rec.id, WS)?.members ?? [];
  assert.equal(members[0].runState, "done");
  assert.equal(members[1].runState, "reused", "the sibling's write survived");
  assert.equal(store.updateAnalysisCohortMember(rec.id, "not-a-member", { runState: "failed" }, WS), false);
});

test("CV facts say whether a CV text exists — never the text — and profiles carry their lineage", () => {
  const withText = analysisFor("Has Text", "A real CV", { cvHash: "h-text" });
  const erased = analysisFor("No Text", "");
  const facts = store.listAnalysisCohortCvFacts([withText, erased, "missing"], WS);
  assert.equal(facts.get(withText)?.hasCvText, true);
  assert.equal(facts.get(withText)?.cvHash, "h-text");
  assert.equal(facts.get(withText)?.candidateName, "Has Text", "the payload's candidate.name rides beside the facts");
  assert.equal(facts.get(erased)?.hasCvText, false);
  assert.equal(facts.has("missing"), false);
  assert.ok(!("rawText" in (facts.get(withText) as object)));
  const { id } = saveProfile({ label: "Prof Ile", archetype: null, roleFamily: "data_ai", completeness: 1, payload: {} }, WS, {
    sourceAnalysisSlug: withText,
    sourceCvHash: "h-text",
    sourceAnalyzedAt: new Date().toISOString(),
  });
  const p = store.listAnalysisCohortProfileFacts([id], WS).get(id);
  assert.equal(p?.sourceAnalysisSlug, withText);
  assert.equal(p?.roleFamily, "data_ai");
});

test("the reuse rows are this JD's analyses, newest first", () => {
  const older = analysisFor("Reuse Old", "cv", { jdSlug: "reuse-role", cvHash: "r1" });
  const newer = analysisFor("Reuse New", "cv", { jdSlug: "reuse-role", cvHash: "r2" });
  const rows = store.listAnalysisCohortReuseRows("reuse-role", WS);
  assert.deepEqual(new Set(rows.map((r) => r.slug)), new Set([older, newer]));
  for (let i = 1; i < rows.length; i += 1) assert.ok(rows[i - 1].createdAt >= rows[i].createdAt, "newest first");
  assert.equal(store.listAnalysisCohortReuseRows("another-role", WS).length, 0);
});

test("an erasure masks the member's name on the run sheet and inside the stored comments", () => {
  const name = "Zdenka Procházková";
  const slug = analysisFor(name, "Zdenka's CV");
  const other = analysisFor("Other Person", "Other CV");
  const rec = cohortOf([
    [slug, name],
    [other, "Other Person"],
  ]);
  store.setAnalysisCohortComments(
    rec.id,
    { cells: [], notes: {}, narrative: { covers: [slug], leavesOut: 1, text: `${name} leads overall.`, engine: "keyless" } },
    WS
  );
  const { entry } = createPipelineEntry({ candidateId: slug, candidateLabel: name, jobId: "jd-role-x", jobTitle: "Role X", workspaceId: WS });
  anonymizeEntry(entry.id, "erasure", WS);
  const after = store.getAnalysisCohort(rec.id, WS);
  assert.equal(after?.members[0].label, "Zdenka P.");
  assert.equal(after?.members[1].label, "Other Person", "another member keeps their label");
  assert.equal(after?.comments?.narrative?.text, "Zdenka P. leads overall.");
  assert.doesNotMatch(JSON.stringify(after), /Procházková/);
});
