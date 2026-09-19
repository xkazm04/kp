// Force-replay of a dead-lettered ATS delivery through POST /api/ats/deliveries.
//
// The store's own comment called the parked row "force-retryable" while POST only
// swept rows that were still due. These tests pin the HTTP half: GET reports `dead`,
// omitted body keeps today's due-sweep, { replayId } requeues then delivers, and
// unknown / not-dead-letter rows answer the coded refusals.
//
// NON-VACUITY: pre-change POST takes no body, GET has no `dead`, and both refusal
// codes are undeclared.
//
// unit-db.ts must stay the first project import.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { GET, POST } from "./route.ts";
import { setAtsConfig } from "../../../_lib/ats-config-store.ts";
import {
  MAX_ATTEMPTS,
  finalizeAtsDelivery,
  getAtsDelivery,
  recordAtsDeliveryStart,
} from "../../../_lib/ats-delivery-store.ts";
import { createPipelineEntry } from "../../../_lib/db.ts";

after(() => cleanupUnitDb());

function jsonPost(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/ats/deliveries", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

test("GET reports the dead-letter count beside due", async () => {
  const id = recordAtsDeliveryStart("candidate.hired", "pe-dead-get");
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    finalizeAtsDelivery(id, { delivered: false, reason: "down" });
  }
  const res = await GET();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { due: number; dead: number };
  assert.equal(typeof body.dead, "number");
  assert.ok(body.dead >= 1, "a parked failure is counted as dead, not due");
});

test("POST with an omitted body still flushes the due sweep", async () => {
  const res = await POST(new NextRequest("http://localhost/api/ats/deliveries", { method: "POST" }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; due: number };
  assert.equal(body.ok, true);
  assert.equal(typeof body.due, "number");
});

test("POST { replayId } of an unknown row answers ATS_DELIVERY_NOT_FOUND", async () => {
  const res = await POST(jsonPost({ replayId: 9_999_999 }));
  assert.equal(res.status, 404);
  assert.equal(((await res.json()) as { code?: string }).code, "ATS_DELIVERY_NOT_FOUND");
});

test("POST { replayId } of a delivered row answers ATS_DELIVERY_NOT_REPLAYABLE", async () => {
  const id = recordAtsDeliveryStart("candidate.hired", "pe-dead-delivered");
  finalizeAtsDelivery(id, { delivered: true, status: 200 });
  const res = await POST(jsonPost({ replayId: id }));
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { code?: string }).code, "ATS_DELIVERY_NOT_REPLAYABLE");
});

test("POST { replayId } requeues a dead-letter and the sweep delivers under the same id", async () => {
  setAtsConfig({ webhookUrl: "https://example.com/hook", events: ["candidate.hired"] });
  const { entry } = createPipelineEntry({
    candidateId: "c-route-replay",
    candidateLabel: "Route Replay",
    jobId: "job-route-replay",
    jobTitle: "Role",
  });
  const id = recordAtsDeliveryStart("candidate.hired", entry.id);
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    finalizeAtsDelivery(id, { delivered: false, reason: "down" }, new Date(Date.now() - 3600_000));
  }
  const real = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
  try {
    const res = await POST(jsonPost({ replayId: id }));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; delivered: number };
    assert.equal(body.ok, true);
    assert.ok(body.delivered >= 1);
    assert.equal(getAtsDelivery(id)?.status, "delivered");
  } finally {
    globalThis.fetch = real;
  }
});
