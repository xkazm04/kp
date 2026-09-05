import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { appendTurn, createThread, listTurns } from "./companion.ts";
import {
  COMPANION_PROMPT_SCAN_TURNS,
  COMPANION_THREAD_TURNS,
  transcriptWindow,
} from "../companion-turn.ts";

after(() => cleanupUnitDb());

// The transcript READ, pinned at the length where it used to break silently.
//
// `listTurns` was `ORDER BY created_at ASC LIMIT 200` and every caller took the
// default, so from turn 201 onwards the dock, the POST response and the model's
// own 12-turn window all showed the OLDEST 200 turns: the conversation froze
// while the writes kept landing. These tests exercise the read past that edge —
// a long conversation is the normal state of a companion thread, not a corner.
//
// The tie-break matters as much as the direction: 250 turns written in a loop
// share `created_at` to the millisecond, so an ORDER BY on the timestamp alone
// is not a total order. The insert order (rowid) is what decides.
//
// Runner: node:test with type stripping — `npm run test:unit`.

const WS = "ws-long-thread";

function threadWithTurns(count: number, workspaceId: string = WS): string {
  const thread = createThread("", workspaceId);
  for (let i = 1; i <= count; i += 1) {
    const written = appendTurn(
      { threadId: thread.id, role: i % 2 === 1 ? "user" : "assistant", content: `turn ${i}` },
      workspaceId
    );
    assert.ok(written, `turn ${i} should have been written`);
  }
  return thread.id;
}

test("a 250-turn thread reads its NEWEST turns, oldest-first", () => {
  const threadId = threadWithTurns(250);
  const turns = listTurns(threadId, WS);
  assert.equal(turns.length, COMPANION_THREAD_TURNS);
  // The 250th turn is what the operator just said and what the dock must paint.
  assert.equal(turns.at(-1)?.content, "turn 250");
  assert.equal(turns[0].content, `turn ${250 - COMPANION_THREAD_TURNS + 1}`);
  // Ascending within the page: the dock renders top-to-bottom without sorting.
  assert.deepEqual(
    turns.map((t) => t.content),
    Array.from({ length: COMPANION_THREAD_TURNS }, (_, i) => `turn ${250 - COMPANION_THREAD_TURNS + 1 + i}`)
  );
});

test("an explicit bound reads that many of the newest turns", () => {
  const threadId = threadWithTurns(30, "ws-bounded");
  const turns = listTurns(threadId, "ws-bounded", 5);
  assert.deepEqual(
    turns.map((t) => t.content),
    ["turn 26", "turn 27", "turn 28", "turn 29", "turn 30"]
  );
});

test("the model's window sits on the TAIL of a long conversation", () => {
  const threadId = threadWithTurns(250, "ws-window");
  const scanned = listTurns(threadId, "ws-window", COMPANION_PROMPT_SCAN_TURNS);
  const window = transcriptWindow(scanned.map((t) => ({ role: t.role, content: t.content })));
  // What she is answering has to be in what she is shown.
  assert.equal(window.at(-1)?.content, "turn 250");
  assert.ok(window.length > 0 && window.length <= scanned.length);
});
