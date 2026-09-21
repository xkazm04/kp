import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PRIORITY_LEVELS, sanitizePriorities, isPriorityLevel } from "./role-priorities.ts";

// The colocated tenancy proof for `role_pattern_priorities` — the table the role
// coach's pattern weights live in. tenancy.ts lists it as VERIFIED workspace-scoped,
// and that claim is only worth something if something checks it (tenancy-coverage's
// PROOF COVERAGE test requires this file to exist and to name the table).
//
// The rule is the manifest's own: every statement touching the table BINDS
// workspace_id — a predicate or an INSERT column, never merely mentions it. There is
// NO by-id exemption here, deliberately. A job id is a globally-unique PK, which is
// what earns getJob its carve-out, but these rows are not the job: they are one
// TEAM's private judgement about a role that every team can see (the seeded corpus is
// shared), so a by-job-id read would hand a competitor's weighting to any tenant that
// can open the same corpus role, and a by-job-id write would let them overwrite it.

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(here, "role-priorities-store.ts"), "utf8");
const TABLE = "role_pattern_priorities";

/** Mirrors tenancy-coverage.test.ts's bindsWorkspace: BOUND, not mentioned. */
function bindsWorkspace(sql: string): boolean {
  if (/workspace_id\s*(=|IN\b|IS\b)/i.test(sql)) return true;
  return /INSERT\s+INTO\s+[a-z_]+\s*\([^)]*\bworkspace_id\b[^)]*\)/i.test(sql);
}

const statements = [...SRC.matchAll(/`([^`]*)`/g)]
  .map((m) => m[1])
  .filter((s) => new RegExp(`\\b(from|into|update|join)\\s+${TABLE}\\b`, "i").test(s));

test("every role_pattern_priorities statement binds workspace_id", () => {
  assert.ok(statements.length >= 3, `expected the read + both write paths, found ${statements.length}`);
  for (const sql of statements) {
    assert.ok(
      bindsWorkspace(sql),
      `a ${TABLE} statement does not BIND workspace_id:\n${sql.trim().slice(0, 240)}`,
    );
  }
});

test("the table's primary key is composite, so two teams can tag the same corpus role", () => {
  assert.match(SRC, /PRIMARY KEY \(job_id, workspace_id\)/);
  // A sole job_id PK is the failure this exists to prevent: the seeded corpus is
  // shared, so the SECOND team to tag a corpus role would have silently overwritten
  // the first team's weighting (the group_evals bug, one table over).
  assert.equal(/PRIMARY KEY \(job_id\)/.test(SRC), false);
});

test("sanitizePriorities keeps only well-formed pairs and drops the rest", () => {
  assert.deepEqual(sanitizePriorities({ a: "critical", b: "nonsense", c: "minor" }), { a: "critical", c: "minor" });
  assert.deepEqual(sanitizePriorities(null), {});
  assert.deepEqual(sanitizePriorities(["critical"]), {});
  assert.deepEqual(sanitizePriorities({ "  ": "critical" }), {});
  assert.deepEqual(sanitizePriorities({ [`x`.repeat(200)]: "critical" }), {});
});

test("the three levels are the vocabulary the guard accepts", () => {
  assert.deepEqual([...PRIORITY_LEVELS], ["critical", "important", "minor"]);
  for (const level of PRIORITY_LEVELS) assert.ok(isPriorityLevel(level));
  assert.equal(isPriorityLevel("high"), false);
});
