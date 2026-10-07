// A CONFIRMED command-bar wave (`reject below N%`, `advance top N`) spends a per-IP
// window before it touches a single entry (idea d6f86aa9). rate-limit-contract.test.ts
// pins the call site and the limiter's arithmetic; this file drives the REAL handler:
// a spent window answers 429 TOO_MANY_REQUESTS and rejects nobody, while the preview
// (which writes nothing) keeps serving.
//
// Its own file (own process): it fills the module's in-process limiter.
//
// unit-db.ts MUST be the first project import (isolated throwaway DB).
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { POST } from "./route.ts";
import { ensureDb } from "../../../_lib/db/core.ts";
import { createPipelineEntry, getPipelineEntry, listPipelineEventsForEntry } from "../../../_lib/db/pipeline.ts";
import { rateLimit, SHARED_CLIENT_KEY } from "../../../_lib/rate-limit.ts";

after(() => cleanupUnitDb());
before(() => {
  ensureDb().prepare(`DELETE FROM pipeline_entries`).run();
});

const LIMIT = { limit: 20, windowMs: 10 * 60_000 };
const post = (body: unknown): Promise<Response> =>
  POST(
    new NextRequest("http://localhost/api/pipeline/command", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
  );

test("a spent window refuses a confirmed reject wave and rejects nobody; the preview still serves", async () => {
  const { entry } = createPipelineEntry({
    candidateId: "cerl-c1",
    candidateLabel: "Below The Line",
    jobId: "cerl-job-1",
    jobTitle: "Throttle Role",
    stage: "Screened",
    matchScore: 20,
  });
  const eventsBefore = listPipelineEventsForEntry(entry.id).length;

  // No trusted proxy in the unit runner, so every caller resolves to the shared key.
  const key = `pipeline-command-exec:${SHARED_CLIENT_KEY}`;
  for (let i = 0; i < LIMIT.limit; i++) assert.equal(rateLimit(key, LIMIT), true, `hit ${i + 1} is admitted`);

  const preview = await post({ text: "reject below 50%" });
  assert.equal(preview.status, 200, "the preview writes nothing and is never throttled");
  assert.deepEqual((await preview.json()).matchedIds, [entry.id]);

  const res = await post({ text: "reject below 50%", confirm: true, confirmIds: [entry.id] });
  assert.equal(res.status, 429);
  assert.equal((await res.json()).code, "TOO_MANY_REQUESTS");
  const after = getPipelineEntry(entry.id);
  assert.equal(after?.status, entry.status, "the entry was not rejected");
  assert.equal(listPipelineEventsForEntry(entry.id).length, eventsBefore, "and no event was written");
});
