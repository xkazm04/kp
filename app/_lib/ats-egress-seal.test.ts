// C3 — the ATS mirror under the egress seal. KP_NO_COMMS_EGRESS=1 must keep the process
// from POSTing a candidate to the configured webhook, and a sealed delivery must stay
// QUEUED (not dead-lettered, not counted as an attempt) so it flows once the seal lifts.
//
// unit-db.ts must stay the first project import.
import { test, after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { setAtsConfig } from "./ats-config-store.ts";
import { deliver, dispatchAtsEvent, retryDueAtsDeliveries } from "./ats-egress.ts";
import { getAtsDelivery, listAtsDeliveries, listDueAtsDeliveries } from "./ats-delivery-store.ts";
import { createPipelineEntry } from "./db/pipeline.ts";

after(() => cleanupUnitDb());

const realFetch = globalThis.fetch;
let calls: string[] = [];
beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    calls.push(String(url instanceof Request ? url.url : url));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  process.env.KP_NO_COMMS_EGRESS = "1";
  setAtsConfig({ webhookUrl: "https://example.com/hook", events: ["candidate.hired"] });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.KP_NO_COMMS_EGRESS;
});

test("deliver: a sealed process makes 0 fetch calls and says 'sealed'", async () => {
  const r = await deliver("ping", { ping: true });
  assert.equal(calls.length, 0, `no fetch under the seal, saw: ${calls.join(", ")}`);
  assert.equal(r.delivered, false);
  if (!r.delivered) {
    assert.equal(r.sealed, true);
    assert.equal(r.reason, "sealed");
  }
});

test("dispatch + flush: the row stays queued with reason 'sealed', no attempt counted, nothing dialled", async () => {
  const { entry } = createPipelineEntry({ candidateId: "c-seal", candidateLabel: "Seal Person", jobId: "job-seal", jobTitle: "Role" });
  await dispatchAtsEvent("candidate.hired", entry.id);
  const rows = listAtsDeliveries().filter((r) => r.entryId === entry.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "failed", "queued for the retry sweep");
  assert.equal(rows[0].attempts, 0, "a sealed delivery is not an attempt");
  assert.equal(rows[0].lastError, "sealed");
  assert.notEqual(rows[0].nextAttemptAt, null, "not dead-lettered");

  const sweep = await retryDueAtsDeliveries(new Date(Date.now() + 3_600_000));
  assert.equal(sweep.failed, 0);
  assert.equal(calls.length, 0, `no fetch under the seal, saw: ${calls.join(", ")}`);
  assert.equal(getAtsDelivery(rows[0].id)?.attempts, 0);

  // Lift the seal: the very same row is due for the sweep again.
  delete process.env.KP_NO_COMMS_EGRESS;
  const later = new Date(Date.now() + 3_600_000);
  assert.equal(listDueAtsDeliveries(later.toISOString()).some((r) => r.id === rows[0].id), true);
});
