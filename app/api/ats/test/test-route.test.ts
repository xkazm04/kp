// Optional `{ entryId }` on POST /api/ats/test: the ping can carry a real kp.ats.v1
// record without emitting a hire. Empty body stays `{ ping: true }`. Missing /
// anonymized entries answer the same codes as the pull door.
//
// NON-VACUITY: pre-change deliver("ping", { ping: true }) is unconditional, so the
// schemaVersion / X-Kp-Event / 404 / 410 asserts fail.
//
// unit-db.ts must stay the first project import.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { POST } from "./route.ts";
import { setAtsConfig } from "../../../_lib/ats-config-store.ts";
import { createPipelineEntry } from "../../../_lib/db/pipeline.ts";
import { anonymizeEntry } from "../../../_lib/db/pipeline.ts";
import { EVENT_HEADER, IDEMPOTENCY_HEADER } from "../../../_lib/ats-webhook.ts";

after(() => cleanupUnitDb());

const ROUTE_SRC = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "route.ts"), "utf8");

function jsonPost(body: unknown | undefined): NextRequest {
  if (body === undefined) {
    return new NextRequest("http://localhost/api/ats/test", { method: "POST" });
  }
  return new NextRequest("http://localhost/api/ats/test", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

async function withFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

test("the limiter still answers TOO_MANY_REQUESTS 429 before deliver", () => {
  assert.match(ROUTE_SRC, /rateLimit\(`ats-test:\$\{clientIpFrom\(request\.headers\)\}`/);
  assert.match(ROUTE_SRC, /jsonRefusal\("TOO_MANY_REQUESTS", 429\)/);
});

test("no body still pings with { ping: true }", async () => {
  setAtsConfig({ webhookUrl: "https://example.com/hook", events: ["candidate.hired"] });
  let seen: { headers: Record<string, string>; body: string } | null = null;
  const res = await withFetch(
    (async (_url: unknown, init: { headers: Record<string, string>; body: string }) => {
      seen = { headers: init.headers, body: init.body };
      return { ok: true, status: 200 };
    }) as unknown as typeof fetch,
    () => POST(jsonPost(undefined))
  );
  assert.equal(res.status, 200);
  assert.ok(seen);
  const { headers, body } = seen as unknown as { headers: Record<string, string>; body: string };
  assert.equal(headers[EVENT_HEADER], "ping");
  assert.deepEqual(JSON.parse(body).data, { ping: true });
  assert.equal(headers[IDEMPOTENCY_HEADER], undefined, "a ping has no ledger row");
});

test("{ entryId } delivers that kp.ats.v1 record under event ping", async () => {
  setAtsConfig({ webhookUrl: "https://example.com/hook", events: ["candidate.hired"] });
  const { entry } = createPipelineEntry({
    candidateId: "c-test-ping",
    candidateLabel: "Ping Person",
    jobId: "job-test-ping",
    jobTitle: "Role",
  });
  let seen: { headers: Record<string, string>; body: string } | null = null;
  const res = await withFetch(
    (async (_url: unknown, init: { headers: Record<string, string>; body: string }) => {
      seen = { headers: init.headers, body: init.body };
      return { ok: true, status: 200 };
    }) as unknown as typeof fetch,
    () => POST(jsonPost({ entryId: entry.id }))
  );
  assert.equal(res.status, 200);
  assert.ok(seen);
  const { headers, body } = seen as unknown as { headers: Record<string, string>; body: string };
  const envelope = JSON.parse(body) as { event: string; data: { schemaVersion?: string } };
  assert.equal(headers[EVENT_HEADER], "ping", "the event id stays the unscribed test event");
  assert.equal(envelope.event, "ping");
  assert.equal(envelope.data.schemaVersion, "kp.ats.v1");
  assert.equal(headers[IDEMPOTENCY_HEADER], undefined, "still no ledger row — this is not a fake hire");
});

test("a missing entryId answers ATS_CANDIDATE_NOT_FOUND", async () => {
  const res = await POST(jsonPost({ entryId: "pe-does-not-exist" }));
  assert.equal(res.status, 404);
  assert.equal(((await res.json()) as { code?: string }).code, "ATS_CANDIDATE_NOT_FOUND");
});

test("an anonymized entry answers ATS_CANDIDATE_ERASED", async () => {
  const { entry } = createPipelineEntry({
    candidateId: "c-test-erased",
    candidateLabel: "Erased Person",
    jobId: "job-test-erased",
    jobTitle: "Role",
  });
  assert.ok(anonymizeEntry(entry.id, "erasure"));
  const res = await POST(jsonPost({ entryId: entry.id }));
  assert.equal(res.status, 410);
  assert.equal(((await res.json()) as { code?: string }).code, "ATS_CANDIDATE_ERASED");
});
