// GET /api/interview/compare carries the director's record per voice candidate
// (challenge-r07 voice-interview-api/B): `coverage { byAxis, mustAsksUnasked }` or null,
// and nothing else from the director — no quote, no question text, no block title, no
// agenda, no session id. Human-only rows keep coverage: null. Isolated throwaway DB
// (unit-db.ts stays the first project import); outside a request currentWorkspace()
// resolves the default workspace, which is where these rows are filed.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { GET } from "./route.ts";
import { createInterviewSession, completeInterviewSession, markInterviewStarted } from "../../../_lib/db/interviews.ts";
import { appendInterviewEvents } from "../../../_lib/db/interview-events.ts";
import { ensureDb } from "../../../_lib/db/core.ts";
import { DEFAULT_WORKSPACE_ID } from "../../../_lib/db/workspaces.ts";

after(() => cleanupUnitDb());

const JOB = "job-compare-coverage";
const SECRET_TITLE = "Block title the grid must not carry";
const SECRET_QUESTION = "Which question text must never ride compare?";
const SECRET_QUOTE = "a verbatim candidate quote about sharding";

const CANDIDATE_KEYS = new Set([
  "entryId",
  "candidateLabel",
  "recommendation",
  "summary",
  "scoringModel",
  "confidence",
  "ratings",
  "observedSkills",
  "costUsd",
  "humanScorecards",
  "telemetry",
  "coverage",
]);

function seedDirected() {
  const s = createInterviewSession({
    provider: "openai",
    mode: "candidate",
    jobId: JOB,
    entryId: "entry-directed",
    candidateLabel: "Directed Candidate",
    workspaceId: DEFAULT_WORKSPACE_ID,
  });
  markInterviewStarted(s.id, true);
  const agenda = {
    version: 1,
    durationMin: 30,
    hardCapMin: 36,
    closeReserveMin: 3,
    blocks: [
      { id: "b0", kind: "warmup", title: "Warm-up", budgetMin: 2, competency: null, scored: false, questions: [] },
      { id: "b1", kind: "topic", title: SECRET_TITLE, budgetMin: 8, competency: "Technical depth", scored: true, questions: [SECRET_QUESTION] },
      { id: "b2", kind: "topic", title: "Problems", budgetMin: 8, competency: "Problem-solving", scored: true, questions: [] },
    ],
  };
  ensureDb().prepare(`UPDATE interview_sessions SET agenda_json = ? WHERE id = ?`).run(JSON.stringify(agenda), s.id);
  appendInterviewEvents(
    [
      { sessionId: s.id, attempt: 1, kind: "topic_begun", blockId: "b1", payload: {} },
      { sessionId: s.id, attempt: 1, kind: "topic_covered", blockId: "b1", payload: { quote: SECRET_QUOTE } },
      { sessionId: s.id, attempt: 1, kind: "end_requested", blockId: "b1", payload: { reason: "time" } },
      { sessionId: s.id, attempt: 1, kind: "must_ask_unasked", blockId: "b2", payload: { questionId: "q9", question: SECRET_QUESTION } },
    ],
    DEFAULT_WORKSPACE_ID
  );
  completeInterviewSession(s.id, { transcript: [] });
  ensureDb()
    .prepare(`UPDATE interview_sessions SET scorecard_json = ? WHERE id = ?`)
    .run(
      JSON.stringify({
        recommendation: "advance",
        scoringModel: "experienced",
        ratings: [
          { competency: "Technical depth", rating: 4, evidence: "Designed it." },
          { competency: "Problem-solving", rating: 4, evidence: "Sounded sure." },
        ],
      }),
      s.id
    );
  return s;
}

function seedUndirected() {
  const s = createInterviewSession({
    provider: "openai",
    mode: "candidate",
    jobId: JOB,
    entryId: "entry-undirected",
    candidateLabel: "Undirected Candidate",
    workspaceId: DEFAULT_WORKSPACE_ID,
  });
  completeInterviewSession(s.id, { transcript: [] });
  return s;
}

async function compare() {
  const res = await GET(new NextRequest(`http://localhost/api/interview/compare?job=${JOB}`));
  assert.equal(res.status, 200);
  return (await res.json()) as { candidates: Record<string, unknown>[] };
}

test("each voice candidate carries coverage { byAxis, mustAsksUnasked } or null, and only allow-listed keys", async () => {
  const directed = seedDirected();
  const undirected = seedUndirected();
  const body = await compare();
  const byLabel = new Map(body.candidates.map((c) => [c.candidateLabel, c]));

  const d = byLabel.get("Directed Candidate");
  assert.ok(d, "the directed candidate is in the cohort");
  assert.deepEqual(d.coverage, {
    byAxis: {
      "Technical depth": "covered",
      "Problem-solving": "not_reached",
      Communication: "not_planned",
      "Experience & fit": "not_planned",
      Motivation: "not_planned",
    },
    mustAsksUnasked: 1,
  });
  assert.equal(byLabel.get("Undirected Candidate")?.coverage, null, "undirected is null, never all-not_reached");

  for (const c of body.candidates) {
    for (const k of Object.keys(c)) assert.ok(CANDIDATE_KEYS.has(k) || k === "humanOnly", `unexpected key on the compare wire: ${k}`);
  }
  const wire = JSON.stringify(body);
  for (const secret of [SECRET_TITLE, SECRET_QUESTION, SECRET_QUOTE, directed.id, undirected.id]) {
    assert.ok(!wire.includes(secret), `compare leaked director material: ${secret}`);
  }
});

test("human-only rows keep coverage: null (source pin: the union branch states it)", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const src = readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf8");
  const humanBranch = src.slice(src.indexOf("humanOnly: true"));
  assert.match(humanBranch.slice(0, 600), /coverage: null/, "the human-led branch carries coverage: null");
});
