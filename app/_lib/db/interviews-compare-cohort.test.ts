// The compare cohort is CANDIDATES (challenge-r07 voice-interview-api/B): a recruiter's
// kit rehearsal (jobs/[id]/interview-kit/rehearse mints mode 'test' with job_id set)
// must not enter interviewedForJob as a null-labelled "candidate" with its own cost.
// And the director's inputs the compare route reads — the session id and its stored
// agenda — ride the same SELECT. Isolated throwaway DB (unit-db.ts stays first).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { createInterviewSession, completeInterviewSession, interviewedForJob } from "./interviews.ts";
import { ensureDb } from "./core.ts";
import { DEFAULT_WORKSPACE_ID } from "./workspaces.ts";

after(() => cleanupUnitDb());

// An entry id with no pipeline row inherits the default workspace (createInterviewSession),
// so the cohort is read there.
const WS = DEFAULT_WORKSPACE_ID;

test("a completed kit rehearsal (mode test) is absent; a completed candidate session is present", () => {
  const jobId = "job-compare-cohort-J";
  const rehearsal = createInterviewSession({ provider: "openai", mode: "test", jobId, workspaceId: WS, candidateLabel: null });
  const real = createInterviewSession({ provider: "openai", mode: "candidate", jobId, workspaceId: WS, entryId: "entry-real", candidateLabel: "Real Person" });
  completeInterviewSession(rehearsal.id, { transcript: [] });
  completeInterviewSession(real.id, { transcript: [] });

  const out = interviewedForJob(jobId, WS);
  assert.equal(out.length, 1, "only the candidate-mode session is a cohort member");
  assert.equal(out[0].candidateLabel, "Real Person");
  assert.equal(out[0].sessionId, real.id);
});

test("the session id and stored agenda ride the cohort read (null when undirected)", () => {
  const jobId = "job-compare-cohort-agenda";
  const directed = createInterviewSession({ provider: "openai", mode: "candidate", jobId, workspaceId: WS, entryId: "entry-directed" });
  const undirected = createInterviewSession({ provider: "openai", mode: "candidate", jobId, workspaceId: WS, entryId: "entry-undirected" });
  const agenda = { version: 1, durationMin: 30, hardCapMin: 36, closeReserveMin: 3, blocks: [{ id: "b1", kind: "topic", title: "T", budgetMin: 5, competency: "ownership", scored: true, questions: [] }] };
  ensureDb().prepare(`UPDATE interview_sessions SET agenda_json = ? WHERE id = ?`).run(JSON.stringify(agenda), directed.id);
  completeInterviewSession(directed.id, { transcript: [] });
  completeInterviewSession(undirected.id, { transcript: [] });

  const byEntry = new Map(interviewedForJob(jobId, WS).map((c) => [c.entryId, c]));
  assert.equal(byEntry.get("entry-directed")?.sessionId, directed.id);
  assert.deepEqual(byEntry.get("entry-directed")?.agenda, agenda);
  assert.equal(byEntry.get("entry-undirected")?.agenda, null);
});
