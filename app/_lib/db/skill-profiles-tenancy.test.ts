import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (E0 Phase 1) — source guard for skill_profiles (durable, candidate-owned
// skill credentials). The public trust lookups are by the unguessable token (a candidate
// presents their credential to anyone) and the mint's idempotent read is by the globally-
// unique submission_id — neither can cross tenants. The issue INSERT stamps workspace_id
// (derived from the submission).
//
// SCOPED MEANS A BOUND PREDICATE, NOT A MENTION. The read check used to accept any
// statement whose text merely CONTAINED "workspace_id", so a cross-tenant sweep that
// happened to SELECT the column (`SELECT workspace_id, profile_json FROM skill_profiles`)
// satisfied it without filtering anything — the hollow shape found in the pipeline
// guards. A read here must either bind `workspace_id = ?` or address a single row by its
// globally-unique token / submission_id.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "skill-profiles.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
const touching = sqlBlocks.filter((s) => /\b(from|into|update)\s+skill_profiles\b/i.test(s));

/** A bound tenant predicate — the only text that actually isolates a tenant. */
const BOUND_SCOPE = /\bworkspace_id\s*=\s*\?/i;
/** The exempt single-row addresses: a globally-unique token or submission id. */
const BY_UNIQUE_ID = /\b(token|submission_id)\s*=\s*\?/i;

test("issueSkillProfile stamps workspace_id; skill_profiles reads are by token/submission_id", () => {
  const inserts = touching.filter((s) => /insert\s+into\s+skill_profiles\b/i.test(s));
  assert.ok(inserts.length >= 1, `expected the issue INSERT, found ${inserts.length}`);
  for (const sql of inserts) {
    assert.ok(/workspace_id/.test(sql), `issueSkillProfile INSERT must stamp workspace_id:\n${sql.trim().slice(0, 220)}`);
  }
  const reads = touching.filter((s) => !/insert\s+into\s+skill_profiles\b/i.test(s));
  for (const sql of reads) {
    const ok = BOUND_SCOPE.test(sql) || BY_UNIQUE_ID.test(sql);
    assert.ok(
      ok,
      `a skill_profiles read is neither scoped by a bound workspace_id = ? nor addressed by token/submission_id:\n${sql.trim().slice(0, 220)}`
    );
  }
});

// Non-vacuity: the matcher must reject the leak shape it exists to catch, so a future
// "simplification" back to a presence test can't leave this guard green but hollow.
test("the guard rejects a workspace_id that is merely SELECTED, never filtered", () => {
  const leak = `SELECT workspace_id, candidate_ref, profile_json FROM skill_profiles WHERE revoked_at IS NULL`;
  assert.equal(BOUND_SCOPE.test(leak), false, "a SELECT-list workspace_id must NOT count as tenant scoping");
  assert.equal(BY_UNIQUE_ID.test(leak), false, "…and it addresses no single row either");
  // `access_token = ?` must not satisfy the token exemption by accident (word boundary).
  assert.equal(BY_UNIQUE_ID.test(`SELECT * FROM skill_profiles WHERE access_token = ?`), false);
  assert.equal(BY_UNIQUE_ID.test(`SELECT * FROM skill_profiles WHERE token = ?`), true);
});
