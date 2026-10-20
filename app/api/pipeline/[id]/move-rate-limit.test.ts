// The per-card door's move/decide actions spend a per-IP window before the shared
// action core runs (2026-10-07 pipeline write-doors scan): each can queue candidate
// email, and with the add door's reopen a reject → re-add → reject loop could mail one
// candidate without bound. rate-limit-contract.test.ts pins the call site and the
// limiter's arithmetic; this file drives the REAL handler: a spent window answers 429
// TOO_MANY_REQUESTS and the entry is not rejected, while the note autosave (which
// sends nothing) keeps serving.
//
// Its own file (own process): it fills the module's in-process limiter.
//
// unit-db.ts MUST be the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { POST } from "./route.ts";
import { createPipelineEntry, getPipelineEntry, listPipelineEventsForEntry } from "../../../_lib/db/pipeline.ts";
import { rateLimit, SHARED_CLIENT_KEY } from "../../../_lib/rate-limit.ts";

after(() => cleanupUnitDb());

const LIMIT = { limit: 300, windowMs: 10 * 60_000 };
const post = (id: string, body: unknown): Promise<Response> =>
  POST(
    new NextRequest(`http://localhost/api/pipeline/${id}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id }) }
  );

test("a spent window refuses a card reject and rejects nobody; the note autosave still serves", async () => {
  const { entry } = createPipelineEntry({
    candidateId: "mrl-c1",
    candidateLabel: "Throttled Card",
    jobId: "mrl-job-1",
    jobTitle: "Throttle Role",
    stage: "Screened",
  });
  const eventsBefore = listPipelineEventsForEntry(entry.id).length;

  // No trusted proxy in the unit runner, so every caller resolves to the shared key.
  const key = `pipeline-entry-move:${SHARED_CLIENT_KEY}`;
  for (let i = 0; i < LIMIT.limit; i++) assert.equal(rateLimit(key, LIMIT), true, `hit ${i + 1} is admitted`);

  const res = await post(entry.id, { action: "reject", expectedStage: "Screened" });
  assert.equal(res.status, 429);
  assert.equal((await res.json()).code, "TOO_MANY_REQUESTS");
  assert.equal(getPipelineEntry(entry.id)?.status, entry.status, "the entry was not rejected");
  assert.equal(listPipelineEventsForEntry(entry.id).length, eventsBefore, "and no event was written");

  const note = await post(entry.id, { action: "set_notes", notes: "still saves" });
  assert.equal(note.status, 200, "a branch that sends nothing is not throttled");
  assert.equal(getPipelineEntry(entry.id)?.notes, "still saves");
});
