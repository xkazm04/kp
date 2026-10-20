// Store-level cases for the interview-session transition table: a revoke is terminal
// for every late write, and an erasure is not overwritten by a late scorecard.
// Isolated throwaway DB (testing/unit-db.ts must be the FIRST project import).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import {
  attachInterviewScorecard,
  completeInterviewSession,
  createInterviewSession,
  getInterviewSessionById,
  markInterviewStarted,
  revokeInterviewSession,
  setInterviewAgenda,
  setInterviewSessionProvider,
} from "./interviews.ts";
import { anonymizeEntry, createPipelineEntry } from "./pipeline.ts";

after(() => cleanupUnitDb());

const TRANSCRIPT = [
  { role: "interviewer" as const, text: "Please introduce yourself." },
  { role: "candidate" as const, text: "Hi, I am the candidate." },
];

function newSession(entryId?: string) {
  return createInterviewSession({
    provider: "openai",
    mode: "candidate",
    entryId,
    candidateLabel: "Transition Candidate",
    jobId: "job-transitions",
    jobTitle: "QA Engineer",
  });
}

test("markInterviewStarted does not reopen a revoked session", () => {
  const s = newSession();
  assert.equal(revokeInterviewSession(s.id), true);
  const before = getInterviewSessionById(s.id)!;
  assert.equal(markInterviewStarted(s.id, true), false, "a revoked link cannot go live again");
  const afterRow = getInterviewSessionById(s.id)!;
  assert.equal(afterRow.status, "revoked");
  assert.equal(afterRow.startedAt, before.startedAt, "started_at is untouched");
});

test("a completion keeps a revoke that landed after the caller's read, and reports the stored status", () => {
  const s = newSession();
  assert.equal(markInterviewStarted(s.id, true), true);
  // The route read 'in_progress' and decided 'completed'; the recruiter revokes in between.
  assert.equal(revokeInterviewSession(s.id), true);
  const res = completeInterviewSession(s.id, { status: "completed", transcript: TRANSCRIPT });
  assert.equal(res.applied, true, "the transcript is still evidence and is persisted");
  assert.equal(res.status, "revoked", "the result reports the STORED status, not the caller's stale pre-read");
  const row = getInterviewSessionById(s.id)!;
  assert.equal(row.status, "revoked");
  assert.equal(row.transcript?.length, TRANSCRIPT.length);
});

test("a late scorecard does not overwrite an erasure that landed during scoring", () => {
  const { entry } = createPipelineEntry({
    candidateId: "cand-transition-erase",
    candidateLabel: "Erased Person",
    jobId: "job-transitions",
    jobTitle: "QA Engineer",
  });
  const s = newSession(entry.id);
  markInterviewStarted(s.id, true);
  completeInterviewSession(s.id, { transcript: TRANSCRIPT });
  // The route is now inside `await runInterviewScorecard(...)`; the erasure lands.
  anonymizeEntry(entry.id, "erasure");
  const res = attachInterviewScorecard(s.id, { recommendation: "reject", summary: "quotes the erased candidate" });
  assert.equal(res.applied, false, "the erased row refuses the late scorecard");
  const row = getInterviewSessionById(s.id)!;
  assert.equal(row.scorecard, null, "scorecard_json stays NULL");
});

test("the scorecard happy path is unchanged", () => {
  const s = newSession();
  markInterviewStarted(s.id, true);
  completeInterviewSession(s.id, { transcript: TRANSCRIPT });
  const res = attachInterviewScorecard(s.id, { recommendation: "advance" });
  assert.equal(res.applied, true);
  assert.deepEqual(getInterviewSessionById(s.id)!.scorecard, { recommendation: "advance" });
});

test("post-connect writes refuse a session revoked after connect started", () => {
  const s = newSession();
  assert.equal(markInterviewStarted(s.id, true), true);
  // Kit build / provider connect is in flight; the recruiter revokes.
  assert.equal(revokeInterviewSession(s.id), true);
  const agenda = { blocks: [] } as unknown as Parameters<typeof setInterviewAgenda>[1];
  assert.equal(setInterviewAgenda(s.id, agenda), false, "the agenda write does not land on a revoked row");
  assert.equal(setInterviewSessionProvider(s.id, "elevenlabs", "openai"), false, "nor does the failover write");
  const row = getInterviewSessionById(s.id)!;
  assert.equal(row.status, "revoked");
  assert.equal(row.agenda, null, "nothing was written");
  assert.equal(row.provider, "openai");
  assert.equal(row.failoverFrom, null);
});

test("source guard: every status write's WHERE is rendered from the transition table", () => {
  const src = readFileSync(fileURLToPath(new URL("./interviews.ts", import.meta.url)), "utf8");
  // Every statement that writes status, from the SET to the end of its template literal.
  const statusWrites = src.match(/UPDATE interview_sessions SET status[^`]*/g) ?? [];
  assert.ok(statusWrites.length >= 4, `expected the status writers, found ${statusWrites.length}`);
  for (const sql of statusWrites) {
    const target = /SET\s+status\s*=\s*'([a-z_]+)'/i.exec(sql)?.[1];
    const guard = /\$\{(statusFromGuard|finalizeFromGuard)\("([a-z_]+)"\)\}/.exec(sql) ??
      /\$\{(finalizeFromGuard)\(([a-zA-Z_.]+)\)\}/.exec(sql);
    assert.ok(guard, `a status write must render its guard from the table:\n${sql}`);
    if (target) assert.equal(guard![2], target, `the guard is the from-set of the write's own target:\n${sql}`);
  }
  // Comments may describe the old guard; the code may not carry it.
  const code = src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l))
    .join("\n");
  assert.ok(!/status\s*!=\s*'completed'/.test(code), "no hand-written `status != 'completed'` guard survives");
});
