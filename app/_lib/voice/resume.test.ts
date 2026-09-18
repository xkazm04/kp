// buildResumeContext (voice/resume.ts): what a reconnect after a drop continues from,
// read off the director's record. Null when there is nothing to resume; otherwise the
// earlier attempts' most recent 40 turns (oldest first), where the agenda stood, and
// the live seconds already spent — never counting the gap between attempts.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { ensureDb } from "../db/core.ts";
import { appendInterviewEvents, type NewInterviewEvent } from "../db/interview-events.ts";
import { createInterviewSession, markInterviewStarted } from "../db/interviews.ts";
import { buildResumeContext, RESUME_PRIOR_TURNS } from "./resume.ts";

after(() => cleanupUnitDb());

const WS = "team-resume";

function live() {
  const s = createInterviewSession({ provider: "openai", mode: "test", durationMin: 20, workspaceId: WS });
  assert.ok(markInterviewStarted(s.id, true));
  return s;
}

const iso = (minute: number) => new Date(Date.parse("2026-09-18T10:00:00.000Z") + minute * 60_000).toISOString();

function write(rows: NewInterviewEvent[], minute: number) {
  appendInterviewEvents(rows, WS, iso(minute));
}

test("a first connect has nothing to resume", () => {
  const s = live();
  assert.equal(buildResumeContext(s.id, WS), null, "no events at all");
  write([{ sessionId: s.id, attempt: 1, seq: 0, kind: "turn", payload: { role: "interviewer", text: "Hello" } }], 0);
  assert.equal(buildResumeContext(s.id, WS), null, "turns of the CURRENT attempt are not earlier turns");
});

test("a reconnect carries the earlier attempts' turns, the agenda position and the live time", () => {
  const s = live();
  write(
    [
      { sessionId: s.id, attempt: 1, seq: 0, kind: "turn", payload: { role: "interviewer", text: "Welcome." } },
      { sessionId: s.id, attempt: 1, kind: "topic_begun", blockId: "b1", payload: {} },
    ],
    0,
  );
  write([{ sessionId: s.id, attempt: 1, seq: 1, kind: "turn", payload: { role: "candidate", text: "I built the billing service." } }], 3);
  write([{ sessionId: s.id, attempt: 1, kind: "topic_covered", blockId: "b1", payload: { quote: "I built the billing service" } }], 4);
  write([{ sessionId: s.id, attempt: 1, kind: "topic_begun", blockId: "b2", payload: {} }], 5);
  write([{ sessionId: s.id, attempt: 1, seq: 2, kind: "turn", payload: { role: "interviewer", text: "Tell me about a bug." } }], 6);
  // The drop, then a reconnect 20 minutes later: /connect counts the attempt first.
  assert.ok(markInterviewStarted(s.id, true));

  // The agenda the director steers by (WP1a writes it at connect); set it directly here.
  const agenda = {
    version: 1,
    durationMin: 20,
    hardCapMin: 24,
    closeReserveMin: 4,
    blocks: [
      { id: "b1", kind: "topic", title: "Backend", budgetMin: 6, competency: null, scored: true, questions: [] },
      { id: "b2", kind: "topic", title: "Debugging", budgetMin: 6, competency: null, scored: true, questions: [] },
    ],
  };
  ensureDb().prepare(`UPDATE interview_sessions SET agenda_json = ? WHERE id = ?`).run(JSON.stringify(agenda), s.id);

  const ctx = buildResumeContext(s.id, WS);
  assert.ok(ctx);
  assert.equal(ctx.attempt, 2, "the attempt being resumed INTO");
  assert.deepEqual(
    ctx.priorTurns.map((t) => [t.seq, t.role, t.text]),
    [
      [0, "interviewer", "Welcome."],
      [1, "candidate", "I built the billing service."],
      [2, "interviewer", "Tell me about a bug."],
    ],
  );
  assert.equal(ctx.activeBlockId, "b2");
  assert.deepEqual(ctx.coveredBlockIds, ["b1"]);
  assert.equal(ctx.elapsedSec, 6 * 60, "first → last event of the dropped attempt");
});

test("only the most recent 40 earlier turns ride along, oldest first, across attempts", () => {
  const s = live();
  const rows: NewInterviewEvent[] = [];
  for (let seq = 0; seq < 30; seq++) rows.push({ sessionId: s.id, attempt: 1, seq, kind: "turn", payload: { role: "candidate", text: `a1-${seq}` } });
  write(rows, 0);
  assert.ok(markInterviewStarted(s.id, true)); // attempt 2
  const rows2: NewInterviewEvent[] = [];
  for (let seq = 0; seq < 30; seq++) rows2.push({ sessionId: s.id, attempt: 2, seq, kind: "turn", payload: { role: "candidate", text: `a2-${seq}` } });
  write(rows2, 10);
  assert.ok(markInterviewStarted(s.id, true)); // attempt 3

  const ctx = buildResumeContext(s.id, WS)!;
  assert.equal(ctx.attempt, 3);
  assert.equal(ctx.priorTurns.length, RESUME_PRIOR_TURNS);
  assert.equal(ctx.priorTurns[0].text, "a1-20", "the oldest kept turn");
  assert.equal(ctx.priorTurns.at(-1)!.text, "a2-29", "the newest turn is last");
});

test("another workspace gets nothing", () => {
  const s = live();
  write([{ sessionId: s.id, attempt: 1, seq: 0, kind: "turn", payload: { role: "candidate", text: "hi there" } }], 0);
  assert.ok(markInterviewStarted(s.id, true));
  assert.ok(buildResumeContext(s.id, WS));
  assert.equal(buildResumeContext(s.id, "someone-else"), null);
});
