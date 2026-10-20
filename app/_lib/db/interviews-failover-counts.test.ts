// challenge-r09 voice-provider-io/B, case 8: the failovers /connect has been recording
// (interview_sessions.failover_from) are counted for the operator's Spend strip,
// tenant-scoped and windowed.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { countInterviewFailovers, createInterviewSession } from "./interviews.ts";
import { ensureDb } from "./core.ts";

after(() => cleanupUnitDb());

const DAY = 24 * 60 * 60_000;
const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

function seed(workspaceId: string, startedAt: string, failoverFrom: string | null, provider: string) {
  const s = createInterviewSession({ provider: "elevenlabs", mode: "candidate", durationMin: 20, workspaceId });
  ensureDb()
    .prepare(`UPDATE interview_sessions SET provider = ?, failover_from = ?, started_at = ?, status = 'completed' WHERE id = ?`)
    .run(provider, failoverFrom, startedAt, s.id);
  return s.id;
}

test("counts failovers per (from, to) inside the window, for the asking workspace only", () => {
  seed("ws-a", iso(2 * DAY), "elevenlabs", "openai"); // A1
  seed("ws-a", iso(2 * DAY), "elevenlabs", "openai"); // A2
  seed("ws-a", iso(9 * DAY), "elevenlabs", "openai"); // A3: outside the 7-day window
  seed("ws-a", iso(1 * DAY), null, "openai"); // no failover
  seed("ws-b", iso(1 * DAY), "elevenlabs", "openai"); // B1: another tenant

  assert.deepEqual(countInterviewFailovers("ws-a", iso(7 * DAY)), [{ from: "elevenlabs", to: "openai", count: 2 }]);
  assert.deepEqual(countInterviewFailovers("ws-b", iso(7 * DAY)), [{ from: "elevenlabs", to: "openai", count: 1 }]);
  assert.deepEqual(countInterviewFailovers("ws-none", iso(7 * DAY)), []);
});

test("a stored provider id the vocabulary no longer knows is dropped, not coerced", () => {
  seed("ws-c", iso(1 * DAY), "retired-vendor", "openai");
  assert.deepEqual(countInterviewFailovers("ws-c", iso(7 * DAY)), []);
});
