// ADR-0009 — the role→slate leg against the REAL schema and the REAL migrations
// (testing/unit-db.ts must stay the first project import, as in every other db
// test here). Covers the two claims the goal rests on: an AI agent and a person
// sit on ONE board, and they are judged by ONE frozen rubric.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { createPipelineEntry, getPipelineEntry } from "./pipeline.ts";
import { freezeRoleRubric, getActiveRubric, getRubricVersion, listRubricVersions } from "./role-rubrics.ts";
import { readRoleSlate, slateByPopulation, stampEntryRubricVersion } from "./role-slate.ts";
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
  };
}

const BASE_REQUIREMENTS = [req("SQL", "must_have", "prerequisite", 0.8), req("dbt", "nice_to_have", "learnable", 0.4)];
const BASE = brief(BASE_REQUIREMENTS);

let seq = 0;
function job(): string {
  seq += 1;
  return `slate-job-${seq}`;
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
  assert.equal(entry.rubricVersion, null, "an unstamped entry reads as 'unknown standard', not as the current one");
  // The default must come from the COLUMN, not from the mapper papering over a
  // NULL — otherwise a direct SQL insert would produce a null population.
  const row = ensureDb().prepare(`SELECT population FROM pipeline_entries WHERE id = ?`).get(entry.id) as {
    population: string;
  };
  assert.equal(row.population, "human");
});

test("an AI agent is a pipeline entry on the same board, not a second funnel", () => {
  const jobId = job();
  createPipelineEntry({ candidateId: "p-1", candidateLabel: "Petra", jobId, jobTitle: "Reporting owner" });
  const { entry: agent } = createPipelineEntry({
    candidateId: "a-1",
    candidateLabel: "Reporting Agent",
    jobId,
    jobTitle: "Reporting owner",
    population: "agent",
  });
  assert.equal(agent.population, "agent");
  assert.equal(getPipelineEntry(agent.id)?.population, "agent", "the population survives a round trip through the store");
  const slate = readRoleSlate(jobId);
  assert.equal(slate.members.length, 2, "ONE list holds both populations");
  assert.deepEqual(slateByPopulation(slate, "human").map((m) => m.label), ["Petra"]);
  assert.deepEqual(slateByPopulation(slate, "agent").map((m) => m.label), ["Reporting Agent"]);
});

// --- frozen rubric ---------------------------------------------------------

test("freezing is idempotent on CONTENT: a prose edit does not mint a new standard", () => {
  const jobId = job();
  const first = freezeRoleRubric(jobId, BASE);
  assert.equal(first.minted, true);
  assert.equal(first.rubric.version, 1);
  assert.equal(first.rubric.source, "intake_promote");

  const proseOnly = freezeRoleRubric(jobId, { ...BASE, summary: "Same requirements, new narrative." });
  assert.equal(proseOnly.minted, false, "re-promoting an unchanged brief must not re-score the board");
  assert.equal(proseOnly.rubric.version, 1);

  // POSITIVE CONTROL — a real requirement change MUST mint version 2, otherwise
  // the assertion above is satisfied by a freeze that never mints anything.
  const changed = freezeRoleRubric(jobId, brief([...BASE_REQUIREMENTS, req("Airflow", "must_have", "prerequisite", 0.6)]));
  assert.equal(changed.minted, true);
  assert.equal(changed.rubric.version, 2);
  assert.equal(changed.rubric.source, "brief_edit");
  assert.equal(getActiveRubric(jobId)?.version, 2);
  assert.deepEqual(listRubricVersions(jobId).map((r) => r.version), [1, 2], "v1 is kept, not overwritten");
});

test("a brief with no graded requirements cannot freeze a rubric onto a role", () => {
  assert.throws(() => freezeRoleRubric(job(), brief([])), /at least one graded requirement/);
});

test("a rubric whose stored JSON no longer matches its hash is refused, not trusted", () => {
  const jobId = job();
  freezeRoleRubric(jobId, BASE);
  // Tamper with the criteria underneath the content address — the shape a
  // hand-edited or half-migrated row would have.
  ensureDb()
    .prepare(`UPDATE role_rubrics SET criteria_json = ? WHERE job_id = ? AND version = 1`)
    .run(JSON.stringify([{ skill: "Nothing", kind: "must_have", hardness: "learnable", weight: 1 }]), jobId);
  assert.throws(() => getActiveRubric(jobId), /fails its own content hash/);
});

// --- the unified evaluation ------------------------------------------------

test("a person and an AI agent on one slate carry the SAME evaluation fields", () => {
  const jobId = job();
  const { rubric } = freezeRoleRubric(jobId, BASE);
  const { entry: human } = createPipelineEntry({
    candidateId: "h-2",
    candidateLabel: "Petra",
    jobId,
    jobTitle: "Reporting owner",
    rubricVersion: rubric.version,
  });
  const { entry: agent } = createPipelineEntry({
    candidateId: "a-2",
    candidateLabel: "Reporting Agent",
    jobId,
    jobTitle: "Reporting owner",
    population: "agent",
    rubricVersion: rubric.version,
  });
  const evidence = new Map<string, CandidateEvidence>([
    [human.id, { covered: ["SQL", "dbt"], source: "cv" }],
    [agent.id, { covered: ["SQL", "dbt"], source: "agent_fit" }],
  ]);
  const slate = readRoleSlate(jobId, evidence);
  const [a, h] = [
    slate.members.find((m) => m.entryId === agent.id)!,
    slate.members.find((m) => m.entryId === human.id)!,
  ];
  assert.equal(h.evaluation!.mustCoverage, a.evaluation!.mustCoverage);
  assert.equal(h.evaluation!.niceCoverage, a.evaluation!.niceCoverage);
  assert.deepEqual(Object.keys(h.evaluation!).sort(), Object.keys(a.evaluation!).sort());
  assert.equal(h.evaluation!.criteriaHash, a.evaluation!.criteriaHash, "one rubric judged both");
  // The only declared difference is WHERE the evidence came from.
  assert.equal(h.evaluation!.source, "cv");
  assert.equal(a.evaluation!.source, "agent_fit");
  assert.deepEqual(slate.staleMemberIds, [], "both were evaluated against the active version");
});

test("an unevaluated slate member reads as 'not evaluated', never as a zero", () => {
  const jobId = job();
  freezeRoleRubric(jobId, BASE);
  const { entry } = createPipelineEntry({
    candidateId: "h-3",
    candidateLabel: "Unassessed Person",
    jobId,
    jobTitle: "Reporting owner",
  });
  const slate = readRoleSlate(jobId);
  const member = slate.members.find((m) => m.entryId === entry.id)!;
  assert.equal(member.evaluation, null);
  assert.equal(member.evaluatedAgainstVersion, null);
  // POSITIVE CONTROL — the same member DOES evaluate once evidence exists, so
  // the null above reflects missing evidence rather than a broken read path.
  const withEvidence = readRoleSlate(jobId, new Map([[entry.id, { covered: ["SQL"], source: "cv" } as CandidateEvidence]]));
  assert.equal(withEvidence.members.find((m) => m.entryId === entry.id)!.evaluation!.mustCoverage, 1);
});

test("a new rubric version marks earlier evaluations STALE instead of re-attributing them", () => {
  const jobId = job();
  const v1 = freezeRoleRubric(jobId, BASE).rubric;
  const { entry } = createPipelineEntry({
    candidateId: "h-4",
    candidateLabel: "Scored Under v1",
    jobId,
    jobTitle: "Reporting owner",
    rubricVersion: v1.version,
  });
  const evidence = new Map<string, CandidateEvidence>([[entry.id, { covered: ["SQL"], source: "cv" }]]);
  assert.deepEqual(readRoleSlate(jobId, evidence).staleMemberIds, [], "current under v1");

  const v2 = freezeRoleRubric(jobId, brief([...BASE_REQUIREMENTS, req("Airflow", "must_have", "prerequisite", 0.6)])).rubric;
  const after2 = readRoleSlate(jobId, evidence);
  assert.equal(after2.rubric!.version, v2.version);
  assert.deepEqual(after2.staleMemberIds, [entry.id], "the v1 evaluation is flagged, not silently promoted");
  // Crucially, the member is still judged against the criteria it was ACTUALLY
  // produced under — under v2's extra must_have it would read 0.57, not 1.
  const member = after2.members.find((m) => m.entryId === entry.id)!;
  assert.equal(member.evaluatedAgainstVersion, v1.version);
  assert.equal(member.evaluation!.rubricVersion, v1.version);
  assert.equal(member.evaluation!.mustCoverage, 1, "re-read against v1's single must_have");
  assert.equal(member.evaluation!.criteriaHash, getRubricVersion(jobId, v1.version)!.criteriaHash);

  // Re-scoring stamps the new version and clears the stale flag.
  assert.equal(stampEntryRubricVersion(entry.id, v2.version), true);
  const after3 = readRoleSlate(jobId, evidence);
  assert.deepEqual(after3.staleMemberIds, []);
  assert.equal(
    after3.members.find((m) => m.entryId === entry.id)!.evaluation!.mustCoverage < 1,
    true,
    "under v2 the same evidence no longer covers every must_have"
  );
});

// --- tenancy ---------------------------------------------------------------

test("a job id is not an authority to read or stamp another team's slate", () => {
  const jobId = job();
  freezeRoleRubric(jobId, BASE);
  const { entry } = createPipelineEntry({
    candidateId: "h-5",
    candidateLabel: "Ours",
    jobId,
    jobTitle: "Reporting owner",
  });
  const foreign = readRoleSlate(jobId, new Map(), "other-workspace");
  assert.deepEqual(foreign.members, [], "no members leak across tenants");
  assert.equal(foreign.rubric, null, "no rubric leaks across tenants");
  assert.equal(stampEntryRubricVersion(entry.id, 1, "other-workspace"), false, "a foreign stamp writes nothing");
  assert.equal(getPipelineEntry(entry.id)?.rubricVersion, null);
  // POSITIVE CONTROL — the same reads succeed on the owning workspace, so the
  // emptiness above is scoping and not a broken query.
  assert.equal(readRoleSlate(jobId).members.length, 1);
  assert.equal(stampEntryRubricVersion(entry.id, 1), true);
});
