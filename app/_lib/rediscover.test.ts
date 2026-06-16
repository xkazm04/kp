import { test } from "node:test";
import assert from "node:assert/strict";
// Import the import-free module directly (not rediscover.ts, which pulls in
// better-sqlite3 + the db barrel and won't load under the strip-types runner).
import { filterRelevantAlerts } from "./rediscovery-relevance.ts";

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
