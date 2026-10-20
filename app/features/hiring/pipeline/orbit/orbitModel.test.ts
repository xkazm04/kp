// The Orbit's model: who is drawn where, why an empty role is empty, the lenses, and the owner's ladder
// order (scored by score desc, unscored by first name asc).
//
// Runner: Node's built-in test runner with type stripping - npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Entry, StageDef } from "../../../shared/pipelineTypes.ts";
import { buildOrbit, cityOf, firstName, groupsFor, ladderOf, ladderPeople, NONE, searchOrbit, type OrbitJob } from "./orbitModel.ts";

const AXIS: StageDef[] = [
  { id: "Accepted", label: "Accepted", role: "entry" },
  { id: "Screened", label: "Screened", role: "screening" },
  { id: "Interview", label: "Interview", role: "interview" },
  { id: "Offer", label: "Offer", role: "offer" },
  { id: "Hired", label: "Hired", role: "terminal" },
];

let n = 0;
function entry(p: Partial<Entry>): Entry {
  n++;
  return {
    id: `e${n}`, candidateId: null, candidateLabel: `Person ${n}`, archetype: null, roleFamily: "software_engineering",
    jobId: "job-1", jobTitle: "Backend Engineer", stage: "Accepted", matchScore: null, status: "active",
    approvalKind: null, approvalDetail: null, createdAt: "2026-09-01T00:00:00Z", stageChangedAt: null, ...p,
  };
}

const JOBS: OrbitJob[] = [
  { id: "job-1", title: "Backend Engineer", roleFamily: "software_engineering", location: "Praha – Michle", seniority: "senior", status: "published", targetHires: 2 },
  { id: "job-2", title: "Branch Advisor", roleFamily: "frontline_service", location: "Brno", seniority: "junior", status: null, targetHires: null },
  { id: "job-3", title: "Draft Role", roleFamily: "frontline_service", location: "Praha", seniority: "junior", status: "draft", targetHires: 1 },
  { id: "job-4", title: "Closed Role", roleFamily: "data_ai", location: "Ostrava", seniority: "lead", status: "closed", targetHires: 1 },
];

const build = (entries: Entry[], jobs: OrbitJob[] | null = JOBS) =>
  buildOrbit({ entries, jobs, axis: AXIS, isStale: (e) => e.stage === "Screened", score: (e) => e.matchScore });

test("every active person on the axis is drawn once; an off-axis one is not", () => {
  const m = build([entry({}), entry({ stage: "Screened" }), entry({ stage: "Retired column" })]);
  assert.equal(m.people.length, 2);
  const role = m.roleByKey.get("job-1");
  assert.equal(role?.act, 2);
  assert.deepEqual(role?.st.map((s) => s.n), [1, 1, 0, 0, 0]);
});

test("waiting is a recognised approval kind; aging is the caller's clock; the terminal stage never ages", () => {
  const m = build([entry({ approvalKind: "decision" }), entry({ approvalKind: "typo" }), entry({ stage: "Screened" }), entry({ stage: "Hired" })]);
  const role = m.roleByKey.get("job-1");
  assert.equal(role?.wait, 1, "an unknown kind is not a human gate");
  assert.equal(role?.aging, 1);
  assert.equal(role?.hired, 1);
  assert.deepEqual(role?.waitKinds, { decision: 1 });
});

test("an empty role says why it is empty; a closed empty role is not drawn", () => {
  const m = build([entry({})]);
  assert.equal(m.roleByKey.get("job-2")?.absence, "vacant", "status null = open for applications");
  assert.equal(m.roleByKey.get("job-3")?.absence, "draft");
  assert.equal(m.roleByKey.has("job-4"), false);
  assert.equal(m.closedEmpty, 1);
  assert.equal(m.roleByKey.get("job-1")?.absence, null);
});

test("no job list: roles still come from the entries, with no location to group by", () => {
  const m = build([entry({})], null);
  assert.equal(m.roles.length, 1);
  assert.equal(groupsFor(m, "city")[0].key, NONE);
});

test("lenses: family, city (Prague districts folded), seniority in ladder order", () => {
  const m = build([entry({}), entry({ jobId: "job-2", jobTitle: "Branch Advisor", roleFamily: "frontline_service" })]);
  assert.deepEqual(groupsFor(m, "family").map((g) => g.key).sort(), ["frontline_service", "software_engineering"]);
  assert.deepEqual(groupsFor(m, "city").map((g) => g.key).sort(), ["Brno", "Praha"]);
  assert.deepEqual(groupsFor(m, "seniority").map((g) => g.key), ["junior", "senior"]);
  assert.equal(cityOf("Praha – Kyje"), "Praha");
  assert.equal(cityOf("Remote (CZ)"), "Remote (CZ)");
});

test("a group sums its roles and counts its empty ones by reason", () => {
  const m = build([entry({ approvalKind: "calendar" }), entry({ jobId: "job-2", jobTitle: "Branch Advisor", roleFamily: "frontline_service" })]);
  const front = groupsFor(m, "family").find((g) => g.key === "frontline_service");
  assert.equal(front?.act, 1);
  assert.equal(front?.live, 1);
  assert.deepEqual(front?.abs, { vacant: 0, draft: 1 });
  assert.equal(groupsFor(m, "family")[0].key, "software_engineering", "the group with someone waiting leads");
});

test("the ladder: scored by score desc, then unscored by first name asc", () => {
  const m = build([
    entry({ candidateLabel: "Zuzana Nová", matchScore: null }),
    entry({ candidateLabel: "Adam Král", matchScore: 60 }),
    entry({ candidateLabel: "Eva Malá", matchScore: 91 }),
    entry({ candidateLabel: "Barbora Černá", matchScore: null }),
    entry({ candidateLabel: "Čeněk Dvořák", matchScore: null, stage: "Screened" }),
  ]);
  const role = m.roleByKey.get("job-1")!;
  const rungs = ladderOf(role, AXIS, "cs");
  assert.deepEqual(rungs[0].people.map((p) => p.name), ["Eva Malá", "Adam Král", "Barbora Černá", "Zuzana Nová"]);
  assert.equal(rungs.length, 5, "every stage is a rung, empty or not");
  const one = ladderOf(role, AXIS, "cs", "Screened");
  assert.deepEqual(one.map((r) => r.stage.id), ["Screened"]);
  assert.deepEqual(ladderPeople(rungs).map((p) => p.name).slice(-1), ["Čeněk Dvořák"]);
  assert.equal(firstName("  Eva   Malá "), "Eva");
});

test("search folds diacritics and finds roles and people", () => {
  const m = build([entry({ candidateLabel: "Čeněk Dvořák" })]);
  assert.equal(searchOrbit(m, "cenek")[0]?.type, "person");
  assert.equal(searchOrbit(m, "branch")[0]?.type, "role");
  assert.deepEqual(searchOrbit(m, "   "), []);
});
