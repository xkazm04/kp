import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (E0 Phase 1) — source guard for interview_sessions (voice AI-interview
// sessions). The by-job enumeration (interviewedForJob) filters workspace_id and the
// create INSERT stamps it (derived from the entry).
//
// The exemption used to also cover `entry_id` (wave 18b narrowed it): an entry id is
// not a capability — it is an internal identifier that recruiter surfaces pass around
// freely — so an entry_id read that takes no workspace answers "did this candidate sit
// an interview" for ANY tenant. `interviewStatusByEntries` was exactly that, and it
// feeds the Schedule indicator and the GDPR self-service "what we hold" projection.
// What stays exempt is the by-`id` and by-`token` POINT read: the candidate token is
// the credential itself, used by public surfaces that have no session and no tenant.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "interviews.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

const IS = /\b(from|into|update)\s+interview_sessions\b/i;
const KEY = /\b(id|token)\s*=\s*\?/i; // by-id/token point op (word-boundary excludes job_id/entry_id)

test("interview_sessions: the by-job + by-entry reads and the create INSERT are workspace-scoped (by-id/token point reads exempt)", () => {
  const touching = sqlBlocks.filter((s) => IS.test(s));
  assert.ok(touching.length >= 8, `expected >=8 interview_sessions queries, found ${touching.length}`);
  const mustScope = touching.filter((s) => !KEY.test(s)); // interviewedForJob (job_id) + INSERT + every entry_id read
  assert.ok(mustScope.length >= 5, `expected the by-job read + INSERT + the entry_id reads, found ${mustScope.length}`);
  for (const sql of mustScope) {
    assert.ok(/workspace_id/.test(sql), `an interview_sessions query is NOT workspace-scoped:\n${sql.trim().slice(0, 220)}`);
  }
});

// The BEHAVIOURAL half, added when the minutes debit turned out to be reading a
// different tenant than its gate. A source guard proving the INSERT stamps
// `workspace_id` says nothing about WHAT it stamps — and what it stamped for an
// entry-less session (every voice simulation) was the DEFAULT team, while
// /api/interview/simulate had gated the caller's. Surfacing `workspaceId` on the
// session, and taking the caller's team when there is no entry to inherit from, is
// what makes the gate and the debit agree.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { createInterviewSession, getInterviewSessionById } from "./interviews.ts";
import { createPipelineEntry } from "./pipeline.ts";
import { DEFAULT_WORKSPACE_ID } from "./workspaces.ts";
import { after } from "node:test";

after(() => cleanupUnitDb());

const WS_B = "team-interviews-b";

test("an entry-less session (a simulation) is stamped with the CALLER's team", () => {
  const sim = createInterviewSession({ provider: "openai", mode: "test", durationMin: 8, workspaceId: WS_B });
  assert.equal(sim.workspaceId, WS_B, "the tenant the gate checked is the tenant the debit will charge");
  assert.equal(getInterviewSessionById(sim.id)?.workspaceId, WS_B, "and it survives the round trip through the row");
});

test("a session WITH an entry still inherits the entry's team, not the caller's", () => {
  // The candidate's own team is authoritative: a recruiter acting from elsewhere
  // must not move the interview (or its minutes) onto their board.
  const { entry } = createPipelineEntry({
    candidateId: "cand-iv",
    candidateLabel: "Iva",
    jobId: "job-iv",
    jobTitle: "Backend",
    workspaceId: WS_B,
  });
  const real = createInterviewSession({ provider: "openai", mode: "candidate", entryId: entry.id, workspaceId: DEFAULT_WORKSPACE_ID });
  assert.equal(real.workspaceId, WS_B, "the entry wins over the caller");
});

test("neither argument given falls back to the default team, as before", () => {
  const legacy = createInterviewSession({ provider: "openai", mode: "test" });
  assert.equal(legacy.workspaceId, DEFAULT_WORKSPACE_ID);
});
