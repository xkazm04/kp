// IMPORT ORDER IS LOAD-BEARING: unit-db must precede any module that reaches db-path.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getJobseekerCv, listJobseekerCvs, recordJobseekerCv, findJobseekerCvByText, touchJobseekerCv } from "./jobseeker-cvs.ts";
import type { ProfilePayload } from "../../features/shared/profileTypes.ts";

after(() => cleanupUnitDb());

// Tenant scope — source guard for the jobseeker_cvs table (the jobseeker-profiles-
// tenancy.test.ts shape). Every SQL statement touching the table binds workspace_id, so
// an unscoped query fails CI instead of handing one workspace's CVs to another. NO
// by-id carve-out. On top of the tenant, every READ and UPDATE also binds the seeker
// (`user_id IS ?`): one seat on a shared workspace must not list or use another's CVs.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "jobseeker-cvs.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

/** A bound tenant predicate: `WHERE workspace_id = ?` / `AND workspace_id = ?`. */
const BOUND_SCOPE = /\bworkspace_id\s*=\s*\?/i;
/** An INSERT stamps the tenant by naming the column in its column list. */
const STAMPS_SCOPE = /\bworkspace_id\b/i;
/** The seeker predicate. */
const BOUND_SEEKER = /\buser_id\s+IS\s+\?/i;

function isInsert(sql: string): boolean {
  return /\binsert\s+(or\s+\w+\s+)?into\s+jobseeker_cvs\b/i.test(sql);
}

const touching = sqlBlocks.filter((s) => /\b(from|into|update|delete\s+from)\s+jobseeker_cvs\b/i.test(s));

test("every SELECT/UPDATE/DELETE/INSERT on the jobseeker_cvs table carries workspace_id", () => {
  assert.ok(touching.length >= 9, `expected >=9 jobseeker_cvs queries, found ${touching.length}`);
  for (const sql of touching) {
    const required = isInsert(sql) ? STAMPS_SCOPE : BOUND_SCOPE;
    assert.ok(required.test(sql), `a jobseeker_cvs query is NOT workspace-scoped:\n${sql.trim().slice(0, 200)}`);
  }
});

test("every read and write beyond a just-minted row also binds the seeker (user_id IS ?)", () => {
  // The one exception is the re-read of the row this same transaction just wrote by id.
  const reReadById = /^SELECT \* FROM jobseeker_cvs WHERE id = \? AND workspace_id = \?$/;
  for (const sql of touching) {
    if (isInsert(sql) || reReadById.test(sql.trim())) continue;
    assert.ok(BOUND_SEEKER.test(sql), `a jobseeker_cvs query does not bind the seeker:\n${sql.trim().slice(0, 200)}`);
  }
});

test("the guard rejects a workspace_id that is merely SELECTED, never filtered", () => {
  const leak = `SELECT id, workspace_id FROM jobseeker_cvs ORDER BY last_used_at DESC LIMIT ?`;
  assert.equal(BOUND_SCOPE.test(leak), false);
  assert.equal(BOUND_SEEKER.test(leak), false);
});

// Behaviour: the same text, two workspaces, two seekers — four separate rows, and no
// door answers one seeker's row to another.
const draft = { displayName: "Ada" } as unknown as ProfilePayload;

test("another workspace and another seeker never see, find, use or touch the row", () => {
  const mine = recordJobseekerCv({ userId: null, sourceText: "Same CV text", draft, draftSource: "llm" }, "ws-a");
  const theirs = recordJobseekerCv({ userId: null, sourceText: "Same CV text", draft, draftSource: "llm" }, "ws-b");
  const seat = recordJobseekerCv({ userId: "u-2", sourceText: "Same CV text", draft, draftSource: "llm" }, "ws-a");
  assert.notEqual(mine.id, theirs.id);
  assert.notEqual(mine.id, seat.id);

  assert.equal(getJobseekerCv(mine.id, null, "ws-b"), null, "a leaked id does not resolve in another workspace");
  assert.equal(getJobseekerCv(mine.id, "u-2", "ws-a"), null, "nor for another seeker of the same workspace");
  assert.equal(touchJobseekerCv(mine.id, null, "ws-b"), false);
  assert.equal(touchJobseekerCv(mine.id, "u-2", "ws-a"), false);

  assert.deepEqual(listJobseekerCvs(null, "ws-a").map((c) => c.id), [mine.id]);
  assert.deepEqual(listJobseekerCvs("u-2", "ws-a").map((c) => c.id), [seat.id]);
  assert.deepEqual(listJobseekerCvs(null, "ws-b").map((c) => c.id), [theirs.id]);
  assert.equal(findJobseekerCvByText(null, "Same CV text", "ws-a")?.id, mine.id);
  assert.equal(findJobseekerCvByText("u-3", "Same CV text", "ws-a"), null);
});
