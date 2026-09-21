// Tenant scope — proof for job_postings (the imported posting corpus, db/job-postings.ts).
//
// The surface is operator-internal with NO public token, so the rule is the strict one:
// EVERY query touching job_postings — point reads included — must filter or stamp
// workspace_id. A leaked posting id must not resolve another team's imported material,
// and one team's import must never appear in another team's `distinctRolePostings`
// sample. The exemption list here is deliberately EMPTY.
//
// Two halves: the source guard (every statement binds the column) and a behavioral
// drive of the real store across two workspaces (what the SQL actually does).
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { distinctRolePostings, getJobPosting, insertJobPosting, listJobPostings } from "./job-postings.ts";

after(() => cleanupUnitDb());

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "job-postings.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

const TOUCHES = /\b(from|into|update|join)\s+job_postings\b/i;

/** workspace_id must be BOUND — a predicate or an INSERT column — never merely
 *  mentioned (a SELECT-list column name is the hollow-guard shape). */
function bindsWorkspace(sql: string): boolean {
  if (/workspace_id\s*(=|IN\b|IS\b)/i.test(sql)) return true;
  return /INSERT\s+INTO\s+[a-z_]+\s*\([^)]*\bworkspace_id\b[^)]*\)/i.test(sql);
}

test("job_postings: every query is workspace-scoped (no by-id exemptions)", () => {
  const touching = sqlBlocks.filter((s) => TOUCHES.test(s));
  assert.ok(touching.length >= 4, `expected >=4 job_postings queries, found ${touching.length}`);
  for (const sql of touching) {
    assert.ok(bindsWorkspace(sql), `a job_postings query does not BIND workspace_id:\n${sql.trim().slice(0, 240)}`);
  }
});

test("job_postings: the dedupe UNIQUE read is scoped too — one team cannot suppress another's import", () => {
  // The conflict read-back is the easiest place to lose the tenant: it looks like a
  // content-addressed cache lookup, which is exactly what jobs/gemini_cache are.
  const conflict = sqlBlocks.find((s) => /SELECT id FROM job_postings WHERE content_hash/i.test(s));
  assert.ok(conflict, "the ON CONFLICT read-back is missing");
  assert.match(conflict!, /content_hash = \? AND workspace_id = \?/);
});

// ---- behavioral ------------------------------------------------------------

const A = "ws-tenant-a";
const B = "ws-tenant-b";

test("nothing crosses: list, get, insert and the stratified sample all stop at the tenant", () => {
  const a = insertJobPosting(
    { source: "paste", title: "Backend Engineer", company: "Alpha", roleFamily: "software", bodyText: "Team A's own ad." },
    A
  );
  const b = insertJobPosting(
    { source: "paste", title: "Data Analyst", company: "Beta", roleFamily: "data", bodyText: "Team B's own ad." },
    B
  );

  assert.deepEqual(listJobPostings(A, { limit: 100 }).map((p) => p.id), [a.id]);
  assert.deepEqual(listJobPostings(B, { limit: 100 }).map((p) => p.id), [b.id]);

  // A leaked id does not resolve in the other tenant.
  assert.equal(getJobPosting(a.id, B), null);
  assert.equal(getJobPosting(b.id, A), null);
  assert.equal(getJobPosting(a.id, A)?.company, "Alpha");

  // The sample is a per-team sample.
  assert.deepEqual(distinctRolePostings(A, 10).map((p) => p.id), [a.id]);
  assert.deepEqual(distinctRolePostings(B, 10).map((p) => p.id), [b.id]);

  // A search that would match the other tenant's row returns nothing.
  assert.deepEqual(listJobPostings(A, { q: "Beta", limit: 100 }), []);
  assert.deepEqual(listJobPostings(B, { roleFamily: "software", limit: 100 }), []);
});

test("the same advertisement in two workspaces is two rows, each visible only to its own team", () => {
  const body = "The identical advertisement, imported by both teams.";
  const first = insertJobPosting({ source: "paste", title: "Shared Ad", bodyText: body }, A);
  const second = insertJobPosting({ source: "paste", title: "Shared Ad", bodyText: body }, B);
  assert.equal(first.inserted, true);
  assert.equal(second.inserted, true, "B's import must not collide with A's row");
  assert.notEqual(first.id, second.id);
  assert.equal(getJobPosting(second.id, A), null);
});
