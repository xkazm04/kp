// ADR-0012 — the role→slate leg against the REAL schema and migrations
// (testing/unit-db.ts must stay the first project import). An AI agent and a
// person sit on ONE board, and are judged by ONE frozen rubric (db/role-rubrics.ts).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createPipelineEntry, getPipelineEntry } from "./pipeline.ts";
import { getRoleRubric, listRoleRubricVersions } from "./role-rubrics.ts";
import { freezeRubricFromBrief, readRoleSlate, slateByPopulation, stampEntryRubricVersion } from "./role-slate.ts";
import { ensureDb } from "./core.ts";
import type { RoleBrief } from "../rolespec.ts";
import type { CandidateEvidence } from "../role-rubric.ts";

after(() => cleanupUnitDb());

const req = (skill: string, kind: string, hardness: string, weight: number) => ({
  skill,
  kind,
  hardness,
  weight,
  rationale: "",
  provenance: "stated",
  confidence: 0.9,
});

function brief(requirements: RoleBrief["requirements"]): RoleBrief {
  return {
    title: "Reporting owner",
    seniority: "senior",
    roleFamily: "data_analytics",
    summary: "Nobody owns the dashboards.",
    successCriteria: ["Weekly reporting runs without manual work"],
    responsibilities: ["Own the dashboard stack"],
    requirements,
    facets: [],
  } as RoleBrief;
}

const BASE_REQUIREMENTS = [req("SQL", "must_have", "prerequisite", 0.8), req("dbt", "nice_to_have", "learnable", 0.4)];
const BASE = brief(BASE_REQUIREMENTS);
const WITH_AIRFLOW = brief([...BASE_REQUIREMENTS, req("Airflow", "must_have", "prerequisite", 0.6)]);

const human = (axes: CandidateEvidence["axes"]): CandidateEvidence => ({ population: "human", axes });
const agent = (axes: CandidateEvidence["axes"]): CandidateEvidence => ({ population: "agent", axes });

let seq = 0;
function job(): string {
  seq += 1;
  return `slate-job-${seq}`;
}

function frozen(jobId: string, b: RoleBrief) {
  const res = freezeRubricFromBrief(jobId, b);
  assert.ok(res.ok, "freeze should succeed");
  return res;
}

// --- population column -----------------------------------------------------

test("an entry created without a population IS a person (the historical truth)", () => {
  const { entry } = createPipelineEntry({
    candidateId: "slate-legacy-1",
    candidateLabel: "Legacy Person",
    jobId: job(),
    jobTitle: "Reporting owner",
  });
  assert.equal(entry.population, "human");
  assert.equal(entry.rubricVersion, null, "an unstamped entry reads as 'unknown standard'");
  const row = ensureDb().prepare(`SELECT population FROM pipeline_entries WHERE id = ?`).get(entry.id) as {
    population: string;
  };
  assert.equal(row.population, "human", "the default comes from the COLUMN, not the mapper");
});

test("an AI agent is a pipeline entry on the same board, not a second funnel", () => {
  const jobId = job();
  createPipelineEntry({ candidateId: "p-1", candidateLabel: "Petra", jobId, jobTitle: "Reporting owner" });
  const { entry: a } = createPipelineEntry({
    candidateId: "a-1",
    candidateLabel: "Reporting Agent",
    jobId,
    jobTitle: "Reporting owner",
    population: "agent",
  });
  assert.equal(a.population, "agent");
  assert.equal(getPipelineEntry(a.id)?.population, "agent");
  const slate = readRoleSlate(jobId);
  assert.equal(slate.members.length, 2, "ONE list holds both populations");
  assert.deepEqual(slateByPopulation(slate, "human").map((m) => m.label), ["Petra"]);
  assert.deepEqual(slateByPopulation(slate, "agent").map((m) => m.label), ["Reporting Agent"]);
});

// --- frozen rubric on HEAD's append-only store -------------------------------

test("freezing from a brief is idempotent on CONTENT: a prose edit does not mint a new version", () => {
  const jobId = job();
  const first = frozen(jobId, BASE);
  assert.ok(first.ok && first.minted);
  assert.equal(first.rubric.version, 1);
  assert.ok(first.rubric.frozenAt, "frozen at promotion");
  assert.equal(first.rubric.source, "brief");

  const proseOnly = frozen(jobId, { ...BASE, summary: "Same requirements, new narrative." });
  assert.ok(proseOnly.ok && !proseOnly.minted, "re-promoting an unchanged brief must not re-score the board");
  assert.equal(proseOnly.rubric.version, 1);

  // POSITIVE CONTROL — a real requirement change mints v2 beside v1.
  const changed = frozen(jobId, WITH_AIRFLOW);
  assert.ok(changed.ok && changed.minted);
  assert.equal(changed.rubric.version, 2);
  assert.equal(getRoleRubric(jobId)?.version, 2);
  assert.deepEqual(listRoleRubricVersions(jobId).map((r) => r.version), [1, 2], "v1 is kept");
});

test("a brief with no graded requirements freezes no rubric (refused, not thrown)", () => {
  const jobId = job();
  const res = freezeRubricFromBrief(jobId, brief([]));
  assert.equal(res.ok, false);
  assert.equal(getRoleRubric(jobId), null);
});

// --- the unified evaluation ------------------------------------------------

test("a person and an AI agent on one slate carry the SAME evaluation fields", () => {
  const jobId = job();
  const res = frozen(jobId, BASE);
  assert.ok(res.ok);
  const v = res.rubric.version;
  const { entry: h } = createPipelineEntry({ candidateId: "h-2", candidateLabel: "Petra", jobId, jobTitle: "R", rubricVersion: v });
  const { entry: a } = createPipelineEntry({
    candidateId: "a-2",
    candidateLabel: "Reporting Agent",
    jobId,
    jobTitle: "R",
    population: "agent",
    rubricVersion: v,
  });
  const axes = { "req:sql": { score: 1 }, "req:dbt": { score: 1 } };
  const slate = readRoleSlate(jobId, new Map([[h.id, human(axes)], [a.id, agent(axes)]]));
  const he = slate.members.find((m) => m.entryId === h.id)!.evaluation!;
  const ae = slate.members.find((m) => m.entryId === a.id)!.evaluation!;
  assert.equal(he.blockingCoverage, ae.blockingCoverage);
  assert.equal(he.otherCoverage, ae.otherCoverage);
  assert.deepEqual(Object.keys(he).sort(), Object.keys(ae).sort());
  assert.equal(he.rubricVersion, ae.rubricVersion, "one rubric judged both");
  // The only difference is the evidence adapter.
  assert.equal(he.basis.find((b) => b.axis === "req:sql")!.source, "analysis");
  assert.equal(ae.basis.find((b) => b.axis === "req:sql")!.source, "agent_fit");
  assert.deepEqual(slate.staleMemberIds, []);
});

test("an unevaluated slate member reads as 'not evaluated', never as a zero", () => {
  const jobId = job();
  frozen(jobId, BASE);
  const { entry } = createPipelineEntry({ candidateId: "h-3", candidateLabel: "Unassessed", jobId, jobTitle: "R" });
  const member = readRoleSlate(jobId).members.find((m) => m.entryId === entry.id)!;
  assert.equal(member.evaluation, null);
  assert.equal(member.evaluatedAgainstVersion, null);
  // POSITIVE CONTROL — evidence makes the same member evaluate.
  const withEvidence = readRoleSlate(jobId, new Map([[entry.id, human({ "req:sql": { score: 1 } })]]));
  assert.equal(withEvidence.members.find((m) => m.entryId === entry.id)!.evaluation!.blockingCoverage, 1);
});

test("a new rubric version marks earlier evaluations STALE instead of re-attributing them", () => {
  const jobId = job();
  const v1 = frozen(jobId, BASE);
  assert.ok(v1.ok);
  const { entry } = createPipelineEntry({
    candidateId: "h-4",
    candidateLabel: "Scored Under v1",
    jobId,
    jobTitle: "R",
    rubricVersion: v1.rubric.version,
  });
  const evidence = new Map([[entry.id, human({ "req:sql": { score: 1 } })]]);
  assert.deepEqual(readRoleSlate(jobId, evidence).staleMemberIds, []);

  const v2 = frozen(jobId, WITH_AIRFLOW);
  assert.ok(v2.ok);
  const after2 = readRoleSlate(jobId, evidence);
  assert.equal(after2.rubric!.version, v2.rubric.version);
  assert.deepEqual(after2.staleMemberIds, [entry.id], "the v1 evaluation is flagged, not silently promoted");
  const member = after2.members.find((m) => m.entryId === entry.id)!;
  assert.equal(member.evaluation!.rubricVersion, v1.rubric.version, "re-read against its OWN version");
  assert.equal(member.evaluation!.blockingCoverage, 1);

  assert.equal(stampEntryRubricVersion(entry.id, v2.rubric.version), true);
  const after3 = readRoleSlate(jobId, evidence);
  assert.deepEqual(after3.staleMemberIds, []);
  const re = after3.members.find((m) => m.entryId === entry.id)!.evaluation!;
  assert.ok(re.blockingCoverage < 1, "under v2 the same evidence no longer covers every blocking axis");
  assert.deepEqual(re.unmetBlocking, ["req:airflow"]);
});

// --- tenancy ---------------------------------------------------------------

test("a job id is not an authority to read or stamp another team's slate", () => {
  const jobId = job();
  frozen(jobId, BASE);
  const { entry } = createPipelineEntry({ candidateId: "h-5", candidateLabel: "Ours", jobId, jobTitle: "R" });
  const foreign = readRoleSlate(jobId, new Map(), "other-workspace");
  assert.deepEqual(foreign.members, []);
  assert.equal(foreign.rubric, null);
  assert.equal(stampEntryRubricVersion(entry.id, 1, "other-workspace"), false);
  assert.equal(getPipelineEntry(entry.id)?.rubricVersion, null);
  // POSITIVE CONTROL
  assert.equal(readRoleSlate(jobId).members.length, 1);
  assert.equal(stampEntryRubricVersion(entry.id, 1), true);
});
