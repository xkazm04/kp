import { test, after } from "node:test";
import assert from "node:assert/strict";
// The relevance contract lives in an import-free sibling, so it needs no fixture.
import { filterRelevantAlerts } from "./rediscovery-relevance.ts";
// rediscover.ts DOES pull in better-sqlite3 + the db barrel, so testing/unit-db.ts
// must be imported before it (it sets KP_DB_PATH before db-path freezes DB_PATH) —
// the same fixture order rediscovery-sweep-bounds.test.ts uses to load this module.
const { cleanupUnitDb } = await import("./testing/unit-db.ts");
const { pickPrior } = await import("./rediscover.ts");

after(() => cleanupUnitDb());

type RediscoveryAlert = {
  id: string;
  jobId: string;
  jobTitle: string;
  candidateId: string;
  label: string;
  archetype: string;
  score: number;
  prior: { kind: string; label: string };
  createdAt: string;
};

const alert = (id: string, jobId: string, candidateId: string): RediscoveryAlert => ({
  id,
  jobId,
  jobTitle: `Role ${jobId}`,
  candidateId,
  label: `Cand ${candidateId}`,
  archetype: "bau",
  score: 78,
  prior: { kind: "rejected", label: "Rejected · Other" },
  createdAt: "2026-06-14T00:00:00.000Z",
});

test("keeps an alert whose role is still published and candidate not pipelined", () => {
  const out = filterRelevantAlerts(
    [alert("a1", "jobA", "candX")],
    (jobId) => jobId === "jobA",
    () => false
  );
  assert.equal(out.length, 1);
});

test("drops an alert whose role is no longer published", () => {
  const out = filterRelevantAlerts(
    [alert("a1", "jobA", "candX")],
    () => false, // nothing published
    () => false
  );
  assert.deepEqual(out, []);
});

test("drops an alert once the candidate is active in that role", () => {
  const out = filterRelevantAlerts(
    [alert("a1", "jobA", "candX")],
    () => true,
    (jobId, candidateId) => jobId === "jobA" && candidateId === "candX"
  );
  assert.deepEqual(out, []);
});

test("the pipelined check is scoped to the alert's OWN role", () => {
  // candX is active in jobB, but the alert is for jobA — still relevant.
  const out = filterRelevantAlerts(
    [alert("a1", "jobA", "candX")],
    () => true,
    (jobId, candidateId) => jobId === "jobB" && candidateId === "candX"
  );
  assert.equal(out.length, 1);
});

// ---- pickPrior: the prior that justifies resurfacing must be ANOTHER role ----
//
// The whole premise is "people rejected/closed ELSEWHERE who clear the bar for this
// one". The `elsewhere` branch always required `h.jobId !== jobId`; the rejected/
// closed branches did not — so a candidate the team rejected FROM THIS VERY ROLE was
// resurfaced as a silver medalist FOR it, chipped "Rejected · <this role's own
// title>" and floated by the depth boost they earned inside it. Reachable on every
// genuine go-live (publish raises alerts, and a closed→re-published role keeps its
// rejects) and on every Rediscover-panel open.
const outcome = (jobId: string, status: string, stage = "Interview", jobTitle = `Role ${jobId}`) => ({
  jobId,
  jobTitle,
  stage,
  status,
});

test("pickPrior: a rejection from THIS role is not a rediscovery prior", () => {
  assert.equal(pickPrior([outcome("jobA", "rejected")], "jobA"), null);
});

test("pickPrior: a candidate who DECLINED this very role is not resurfaced for it", () => {
  assert.equal(pickPrior([outcome("jobA", "declined")], "jobA"), null);
});

test("pickPrior: role_closed on THIS role is not a prior (re-publish reinstates those entries instead)", () => {
  assert.equal(pickPrior([outcome("jobA", "role_closed")], "jobA"), null);
});

test("pickPrior: a rejection from ANOTHER role still qualifies, labelled with that role", () => {
  const prior = pickPrior([outcome("jobB", "rejected", "Offer", "Beta Role")], "jobA");
  assert.ok(prior);
  assert.equal(prior!.kind, "rejected");
  assert.equal(prior!.label, "Rejected · Beta Role");
  assert.equal(prior!.stage, "Offer");
  assert.equal(prior!.depth, 3, "the depth boost comes from the OTHER role's terminal stage");
});

test("pickPrior: a same-role reject never lends its depth to another role's prior", () => {
  // Rejected at Offer in THIS role, screened out in another. The qualifying prior is
  // the other role's — the same-role entry must contribute neither the label nor the
  // ordering boost.
  const prior = pickPrior(
    [outcome("jobA", "rejected", "Offer", "Alpha Role"), outcome("jobB", "rejected", "Screened", "Beta Role")],
    "jobA"
  );
  assert.ok(prior);
  assert.equal(prior!.label, "Rejected · Beta Role");
  assert.equal(prior!.depth, 1, "boost is the OTHER role's depth (Screened), not this role's Offer");
});

test("pickPrior: an active entry in another role is an 'elsewhere' prior with no depth boost", () => {
  const prior = pickPrior([outcome("jobB", "active", "Offer", "Beta Role")], "jobA");
  assert.ok(prior);
  assert.equal(prior!.kind, "elsewhere");
  assert.equal(prior!.depth, 0, "a LIVE entry never lends ordering depth");
});

test("filters a mixed batch, preserving order", () => {
  const alerts = [
    alert("a1", "jobA", "candX"), // kept
    alert("a2", "jobClosed", "candY"), // dropped: unpublished
    alert("a3", "jobA", "candZ"), // dropped: pipelined
  ];
  const out = filterRelevantAlerts(
    alerts,
    (jobId) => jobId === "jobA",
    (jobId, candidateId) => candidateId === "candZ"
  );
  assert.deepEqual(out.map((a) => a.id), ["a1"]);
});
