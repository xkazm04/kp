// Behavioral contract of the role_rubrics store (db/role-rubrics.ts, ADR-0010 §2):
// versions are minted, never edited; a version freezes once; the axes written are the
// axes a scorer can read; and an unreadable row says so instead of scoring nothing.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { RubricAxis } from "../schemas.generated.ts";
import { ensureDb, getRowHealth } from "./core.ts";
import { freezeRoleRubric, getRoleRubric, listRoleRubricVersions, mintRoleRubric } from "./role-rubrics.ts";

after(() => cleanupUnitDb());

const WS = "ws-rubrics";

const axis = (key: string, over: Partial<RubricAxis> = {}): RubricAxis => ({
  key,
  label: key.replace(/^[a-z]+:/, ""),
  origin: "requirement",
  kind: "must_have",
  hardness: "prerequisite",
  weight: 0.5,
  blocking: true,
  provenance: "stated",
  evidenceClass: "requirement_coverage",
  humanEvidence: "analysis",
  agentEvidence: "agent_fit",
  rationale: "",
  ...over,
});

test("minting appends versions 1, 2, 3 — the latest read follows, older versions stay readable as written", () => {
  const job = "job-versions";
  const v1 = mintRoleRubric({ jobId: job, intakeId: "intake-1", axes: [axis("req:go", { weight: 1 })], source: "brief" }, WS);
  const v2 = mintRoleRubric({ jobId: job, intakeId: "intake-1", axes: [axis("req:go"), axis("req:sql")], source: "brief" }, WS);
  const v3 = mintRoleRubric({ jobId: job, axes: [axis("req:rust", { weight: 1 })], source: "manual" }, WS);
  assert.ok(v1.ok && v2.ok && v3.ok);
  assert.deepEqual([v1.rubric.version, v2.rubric.version, v3.rubric.version], [1, 2, 3]);

  const latest = getRoleRubric(job, WS);
  assert.equal(latest?.version, 3);
  assert.equal(latest?.intakeId, null);
  assert.equal(latest?.source, "manual");

  const first = getRoleRubric(job, WS, 1);
  assert.equal(first?.intakeId, "intake-1");
  assert.deepEqual(first?.axes, [axis("req:go", { weight: 1 })]);
  assert.deepEqual(listRoleRubricVersions(job, WS).map((r) => r.version), [1, 2, 3]);
  assert.equal(getRoleRubric(job, WS, 4), null);
});

test("the returned rubric is the stored rubric (mint → read round-trip, unknown keys dropped)", () => {
  const withExtra = { ...axis("req:k8s"), sneaky: "not part of RubricAxis" };
  const minted = mintRoleRubric({ jobId: "job-roundtrip", axes: [withExtra], source: "brief" }, WS);
  assert.ok(minted.ok);
  const read = getRoleRubric("job-roundtrip", WS);
  assert.deepEqual(read, minted.rubric);
  assert.equal("sneaky" in (read!.axes![0] as object), false);
});

test("freezing is once: the first call sets frozen_at, a repeat keeps the ORIGINAL time", () => {
  const job = "job-freeze";
  assert.ok(mintRoleRubric({ jobId: job, axes: [axis("req:go", { weight: 1 })], source: "brief" }, WS).ok);
  const first = freezeRoleRubric(job, 1, WS);
  assert.equal(first.frozen, true);
  assert.ok(first.rubric?.frozenAt);
  const again = freezeRoleRubric(job, 1, WS);
  assert.equal(again.frozen, false);
  assert.equal(again.rubric?.frozenAt, first.rubric?.frozenAt);
  assert.deepEqual(freezeRoleRubric(job, 9, WS), { frozen: false, rubric: null });

  // A frozen version does not stop the next one being minted — that is how a
  // re-derivation happens — and the new version starts unfrozen.
  const v2 = mintRoleRubric({ jobId: job, axes: [axis("req:go", { weight: 1 })], source: "brief" }, WS);
  assert.ok(v2.ok);
  assert.equal(v2.rubric.version, 2);
  assert.equal(v2.rubric.frozenAt, null);
  assert.ok(getRoleRubric(job, WS, 1)?.frozenAt, "minting v2 must not touch v1");
});

test("append-only is enforced by SQLite, not by the absence of an update function", () => {
  const job = "job-append-only";
  assert.ok(mintRoleRubric({ jobId: job, axes: [axis("req:go", { weight: 1 })], source: "brief" }, WS).ok);
  const db = ensureDb();
  const refuse = (sql: string, ...args: unknown[]) =>
    assert.throws(() => db.prepare(sql).run(...args), /append-only/, `expected the trigger to refuse: ${sql}`);

  refuse(`UPDATE role_rubrics SET axes_json = '[]' WHERE workspace_id = ? AND job_id = ?`, WS, job);
  refuse(`UPDATE role_rubrics SET version = 7 WHERE workspace_id = ? AND job_id = ?`, WS, job);
  refuse(`UPDATE role_rubrics SET source = 'manual' WHERE workspace_id = ? AND job_id = ?`, WS, job);
  refuse(`UPDATE role_rubrics SET workspace_id = 'ws-other' WHERE workspace_id = ? AND job_id = ?`, WS, job);

  assert.equal(freezeRoleRubric(job, 1, WS).frozen, true);
  refuse(`UPDATE role_rubrics SET frozen_at = NULL WHERE workspace_id = ? AND job_id = ?`, WS, job);
  refuse(`UPDATE role_rubrics SET frozen_at = '2099-01-01T00:00:00.000Z' WHERE workspace_id = ? AND job_id = ?`, WS, job);
});

test("refusals are returned with a reason and write nothing", () => {
  const job = "job-refusals";
  const cases: [Parameters<typeof mintRoleRubric>[0], string][] = [
    [{ jobId: job, axes: [], source: "brief" }, "empty"],
    [{ jobId: job, axes: [{ ...axis("req:go"), humanEvidence: "vibes" }], source: "brief" }, "invalid_axis"],
    [{ jobId: job, axes: [{ key: "req:go" }], source: "brief" }, "invalid_axis"],
    [{ jobId: job, axes: [axis("  ")], source: "brief" }, "invalid_axis"],
    [{ jobId: job, axes: [axis("req:go"), axis("req:go")], source: "brief" }, "duplicate_axis_key"],
    [{ jobId: job, axes: [axis("req:go", { weight: 1.5 })], source: "brief" }, "invalid_weight"],
    [{ jobId: job, axes: [axis("req:go", { weight: -0.1 })], source: "brief" }, "invalid_weight"],
    [{ jobId: "  ", axes: [axis("req:go")], source: "brief" }, "invalid_input"],
    [{ jobId: job, axes: [axis("req:go")], source: "llm" as never }, "invalid_input"],
  ];
  for (const [input, reason] of cases) {
    const res = mintRoleRubric(input, WS);
    assert.equal(res.ok, false, `expected a refusal for ${JSON.stringify(input)}`);
    if (!res.ok) assert.equal(res.reason, reason, res.detail);
  }
  assert.deepEqual(listRoleRubricVersions(job, WS), [], "a refused mint must not consume a version");
});

test("a stored axes column that stopped parsing reads as axes: null and is recorded, never as an empty rubric", () => {
  const job = "job-unreadable";
  const minted = mintRoleRubric({ jobId: job, axes: [axis("req:go", { weight: 1 })], source: "brief" }, WS);
  assert.ok(minted.ok);
  const db = ensureDb();
  // Simulate drift the way it really arrives — a row written under an older axis shape
  // — by swapping the trigger out for the length of one write.
  db.exec(`DROP TRIGGER trg_role_rubrics_append_only`);
  db.prepare(`UPDATE role_rubrics SET axes_json = ? WHERE id = ?`).run(JSON.stringify([{ key: "req:go", humanEvidence: "cv" }]), minted.rubric.id);
  const read = getRoleRubric(job, WS);
  assert.equal(read?.version, 1);
  assert.equal(read?.axes, null);
  assert.ok(
    getRowHealth().issues.some((i) => i.id === minted.rubric.id && i.reason === "invalid"),
    "the unreadable column must be counted in the row-health ledger"
  );
});
