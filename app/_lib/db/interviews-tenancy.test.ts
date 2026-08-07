import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (E0 Phase 1) — source guard for interview_sessions (voice AI-interview
// sessions). The by-job enumeration (interviewedForJob) filters workspace_id and the
// create INSERT stamps it (derived from the entry); every other op is keyed by the
// globally-unique id / candidate token / entry_id and can't cross tenants.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "interviews.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

const IS = /\b(from|into|update)\s+interview_sessions\b/i;
const KEY = /\b(id|token|entry_id)\s*(=\s*\?|in\s*\()/i; // by-id/token/entry_id point/list op (word-boundary excludes job_id)

test("interview_sessions: the by-job enumeration + create INSERT are workspace-scoped (by-id/token/entry_id exempt)", () => {
  const touching = sqlBlocks.filter((s) => IS.test(s));
  assert.ok(touching.length >= 8, `expected >=8 interview_sessions queries, found ${touching.length}`);
  const mustScope = touching.filter((s) => !KEY.test(s)); // interviewedForJob (job_id) + the INSERT
  assert.ok(mustScope.length >= 2, `expected the by-job read + INSERT, found ${mustScope.length}`);
  for (const sql of mustScope) {
    assert.ok(/workspace_id/.test(sql), `an interview_sessions query is NOT workspace-scoped:\n${sql.trim().slice(0, 220)}`);
  }
});
