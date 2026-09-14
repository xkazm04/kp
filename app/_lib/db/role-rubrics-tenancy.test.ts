// Tenant scope — proof for role_rubrics (a role's frozen, versioned rubric,
// db/role-rubrics.ts, ADR-0010 §2).
//
// Operator-internal with NO public token, so the rule is the strict one: EVERY
// statement touching role_rubrics — point reads included — must bind workspace_id.
// The exemption list is deliberately EMPTY.
//
// Three halves: the source guard (every statement binds the column), the schema the
// store's OWN migration really creates (read back from sqlite_master — not a
// hand-copied inline CREATE, which would prove a schema nobody runs), and a behavioral
// drive of the real store across two workspaces.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { RubricAxis } from "../schemas.generated.ts";
import { ensureDb } from "./core.ts";
import { freezeRoleRubric, getRoleRubric, listRoleRubricVersions, mintRoleRubric } from "./role-rubrics.ts";

after(() => cleanupUnitDb());

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "role-rubrics.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

const TOUCHES = /\b(from|into|update|join)\s+role_rubrics\b/i;

/** workspace_id must be BOUND — a predicate or an INSERT column — never merely
 *  mentioned (a SELECT-list column name is the hollow-guard shape). */
function bindsWorkspace(sql: string): boolean {
  if (/workspace_id\s*(=|IN\b|IS\b)/i.test(sql)) return true;
  return /INSERT\s+INTO\s+[a-z_]+\s*\([^)]*\bworkspace_id\b[^)]*\)/i.test(sql);
}

test("role_rubrics: every statement binds workspace_id (no by-id exemptions)", () => {
  const touching = sqlBlocks.filter((s) => TOUCHES.test(s));
  // MAX(version) read, INSERT, latest read, by-version read, list, freeze UPDATE.
  assert.ok(touching.length >= 6, `expected >=6 role_rubrics statements, found ${touching.length}`);
  for (const sql of touching) {
    assert.ok(bindsWorkspace(sql), `a role_rubrics statement does not BIND workspace_id:\n${sql.trim().slice(0, 240)}`);
  }
});

const axis = (key: string, weight = 1): RubricAxis => ({
  key,
  label: key,
  origin: "requirement",
  kind: "must_have",
  hardness: "prerequisite",
  weight,
  blocking: true,
  provenance: "stated",
  evidenceClass: "requirement_coverage",
  humanEvidence: "analysis",
  agentEvidence: "agent_fit",
  rationale: "",
});

test("the store's own migration creates the table with the workspace-first version UNIQUE", () => {
  // Touch the store so ITS migration runs — nothing in this file creates the table.
  assert.equal(getRoleRubric("job-none", "ws-schema"), null);
  const db = ensureDb();
  const cols = (db.prepare(`PRAGMA table_info(role_rubrics)`).all() as { name: string; notnull: number }[]).map(
    (c) => [c.name, c.notnull] as const
  );
  assert.deepEqual(cols, [
    ["id", 0],
    ["workspace_id", 1],
    ["job_id", 1],
    ["intake_id", 0],
    ["version", 1],
    ["axes_json", 1],
    ["source", 1],
    ["created_at", 1],
    ["frozen_at", 0],
  ]);
  // The UNIQUE that numbers versions must lead with the tenant: (job_id, version) alone
  // would let one team's v1 for a shared-corpus job block every other team's v1.
  const uniques = (db.prepare(`PRAGMA index_list(role_rubrics)`).all() as { name: string; unique: number }[]).filter(
    (i) => i.unique === 1
  );
  const shapes = uniques.map((i) =>
    (db.prepare(`PRAGMA index_info("${i.name}")`).all() as { name: string }[]).map((c) => c.name).join(",")
  );
  assert.ok(shapes.includes("workspace_id,job_id,version"), `expected UNIQUE (workspace_id, job_id, version), got ${JSON.stringify(shapes)}`);
  const trigger = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'role_rubrics'`).get();
  assert.ok(trigger, "the append-only trigger was not created by the store's migration");
});

const A = "ws-tenant-a";
const B = "ws-tenant-b";

test("nothing crosses: mint, read, list and freeze all stop at the tenant", () => {
  const a = mintRoleRubric({ jobId: "job-private-a", axes: [axis("req:go")], source: "brief" }, A);
  assert.ok(a.ok);

  assert.equal(getRoleRubric("job-private-a", B), null);
  assert.equal(getRoleRubric("job-private-a", B, 1), null);
  assert.deepEqual(listRoleRubricVersions("job-private-a", B), []);

  // Another team cannot freeze this team's rubric by naming its job + version.
  const foreign = freezeRoleRubric("job-private-a", 1, B);
  assert.deepEqual(foreign, { frozen: false, rubric: null });
  assert.equal(getRoleRubric("job-private-a", A)?.frozenAt, null, "a cross-tenant freeze must not touch the row");
});

test("a shared-corpus job: each team numbers its own versions from 1 and reads only its own axes", () => {
  const shared = "job-shared-corpus";
  const a = mintRoleRubric({ jobId: shared, axes: [axis("req:java")], source: "job" }, A);
  const b = mintRoleRubric({ jobId: shared, axes: [axis("req:kotlin")], source: "job" }, B);
  assert.ok(a.ok && b.ok);
  assert.equal(a.rubric.version, 1);
  assert.equal(b.rubric.version, 1, "B's first rubric for the shared job must not collide with A's");

  assert.deepEqual(getRoleRubric(shared, A)?.axes?.map((x) => x.key), ["req:java"]);
  assert.deepEqual(getRoleRubric(shared, B)?.axes?.map((x) => x.key), ["req:kotlin"]);

  const a2 = mintRoleRubric({ jobId: shared, axes: [axis("req:scala")], source: "manual" }, A);
  assert.ok(a2.ok);
  assert.equal(a2.rubric.version, 2);
  assert.deepEqual(listRoleRubricVersions(shared, B).map((r) => r.version), [1], "A's second version is not B's");
});
