// Behaviour of the interview director's event store (db/interview-events.ts): turns are
// idempotent per (session, attempt, seq), the record reads back in the order it was
// written, the ack seq is per attempt, unknown kinds never land — and a GDPR erasure
// of the candidate deletes every event of their sessions.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { appendInterviewEvents, listInterviewEvents, maxInterviewTurnSeq, withInterviewEventsLock } from "./interview-events.ts";
import type { InterviewEventKind } from "../voice/director-types.ts";
import { createInterviewSession } from "./interviews.ts";
import { anonymizeEntry, createPipelineEntry } from "./pipeline.ts";
import { DEFAULT_WORKSPACE_ID } from "./workspaces.ts";

after(() => cleanupUnitDb());

const WS = DEFAULT_WORKSPACE_ID;

function session() {
  return createInterviewSession({ provider: "openai", mode: "test", durationMin: 20, workspaceId: WS });
}

test("a replayed turn is absorbed by the (session, attempt, seq) index — nothing doubles", () => {
  const s = session();
  const turn = { sessionId: s.id, attempt: 1, seq: 3, kind: "turn" as const, payload: { role: "candidate", text: "first" } };
  assert.equal(appendInterviewEvents([turn], WS).length, 1);
  const replay = appendInterviewEvents([{ ...turn, payload: { role: "candidate", text: "tampered retry" } }], WS);
  assert.deepEqual(replay, [], "the retried POST writes nothing");
  const turns = listInterviewEvents(s.id, WS, { kinds: ["turn"] });
  assert.equal(turns.length, 1);
  assert.equal(turns[0].payload.text, "first", "the first write stands");

  // The same seq in ANOTHER attempt is a different turn.
  assert.equal(appendInterviewEvents([{ ...turn, attempt: 2 }], WS).length, 1);
  // Non-turn kinds never collide on seq (it is null for them).
  const obs = { sessionId: s.id, attempt: 1, kind: "focus_lost" as const, payload: { during: "candidate" } };
  assert.equal(appendInterviewEvents([obs, obs], WS).length, 2, "observations are not deduplicated");
});

test("a turn without a seq and an unknown kind are skipped, not stored", () => {
  const s = session();
  const written = appendInterviewEvents(
    [
      { sessionId: s.id, attempt: 1, kind: "turn", payload: { role: "candidate", text: "no number" } },
      { sessionId: s.id, attempt: 1, kind: "made_up" as InterviewEventKind, payload: {} },
      { sessionId: s.id, attempt: 1, seq: 0, kind: "turn", payload: { role: "candidate", text: "numbered" } },
    ],
    WS,
  );
  assert.deepEqual(written.map((e) => e.kind), ["turn"]);
  assert.equal(listInterviewEvents(s.id, WS).length, 1);
});

test("maxInterviewTurnSeq is per attempt, -1 when nothing is persisted", () => {
  const s = session();
  assert.equal(maxInterviewTurnSeq(s.id, 1, WS), -1);
  appendInterviewEvents(
    [0, 1, 2].map((seq) => ({ sessionId: s.id, attempt: 1, seq, kind: "turn" as const, payload: { role: "interviewer", text: `t${seq}` } })),
    WS,
  );
  appendInterviewEvents([{ sessionId: s.id, attempt: 2, seq: 0, kind: "turn", payload: { role: "interviewer", text: "again" } }], WS);
  assert.equal(maxInterviewTurnSeq(s.id, 1, WS), 2);
  assert.equal(maxInterviewTurnSeq(s.id, 2, WS), 0);
});

test("the record reads back in write order, filterable by attempt and kind", () => {
  const s = session();
  appendInterviewEvents(
    [
      { sessionId: s.id, attempt: 1, seq: 0, kind: "turn", payload: { role: "interviewer", text: "hi" } },
      { sessionId: s.id, attempt: 1, kind: "topic_begun", blockId: "b1", payload: {} },
      { sessionId: s.id, attempt: 1, seq: 1, kind: "turn", payload: { role: "candidate", text: "hello" } },
    ],
    WS,
    "2026-09-18T10:00:00.000Z",
  );
  appendInterviewEvents([{ sessionId: s.id, attempt: 2, kind: "directive", blockId: "b1", payload: { kind: "resume" } }], WS, "2026-09-18T10:05:00.000Z");
  const all = listInterviewEvents(s.id, WS);
  assert.deepEqual(all.map((e) => e.kind), ["turn", "topic_begun", "turn", "directive"]);
  assert.equal(all[1].blockId, "b1");
  assert.equal(all[0].createdAt, "2026-09-18T10:00:00.000Z");
  assert.equal(all[0].at, "2026-09-18T10:00:00.000Z", "a row with no stamp of its own happened when it was recorded");
  assert.deepEqual(listInterviewEvents(s.id, WS, { attempt: 2 }).map((e) => e.kind), ["directive"]);
  assert.deepEqual(listInterviewEvents(s.id, WS, { kinds: ["topic_begun", "directive"] }).map((e) => e.kind), ["topic_begun", "directive"]);
  assert.deepEqual(listInterviewEvents(s.id, WS, { kinds: [] }), []);
});

test("withInterviewEventsLock rolls the whole step back when it throws", () => {
  const s = session();
  assert.throws(() =>
    withInterviewEventsLock(() => {
      appendInterviewEvents([{ sessionId: s.id, attempt: 1, seq: 0, kind: "turn", payload: { role: "candidate", text: "x" } }], WS);
      throw new Error("boom");
    }),
  );
  assert.equal(listInterviewEvents(s.id, WS).length, 0, "nothing from the failed step survives");
});

test("GDPR erasure deletes every event of the candidate's sessions — and only theirs", () => {
  const { entry } = createPipelineEntry({
    candidateId: "cand-events-erase",
    candidateLabel: "Zdenka Procházková",
    jobId: "job-events-erase",
    jobTitle: "Backend",
    stage: "Interview",
  });
  const mine = createInterviewSession({ provider: "openai", mode: "candidate", entryId: entry.id, durationMin: 20 });
  const other = session();
  const turn = (sessionId: string) => ({
    sessionId,
    attempt: 1,
    seq: 0,
    kind: "turn" as const,
    payload: { role: "candidate", text: "I'm Zdenka Procházková, reach me at zdenka@example.com" },
  });
  appendInterviewEvents([turn(mine.id), { sessionId: mine.id, attempt: 1, kind: "guardrail", payload: { quote: "Zdenka" } }], mine.workspaceId);
  appendInterviewEvents([turn(other.id)], WS);
  assert.equal(listInterviewEvents(mine.id, mine.workspaceId).length, 2, "the record holds the PII before erasure");

  assert.ok(anonymizeEntry(entry.id, "erasure"));

  assert.deepEqual(listInterviewEvents(mine.id, mine.workspaceId), [], "every event of the erased candidate's session is gone");
  assert.equal(listInterviewEvents(other.id, WS).length, 1, "an unrelated session keeps its record");
});
