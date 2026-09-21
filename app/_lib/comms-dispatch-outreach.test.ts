// dispatchOutreach keys `{ sent: true }` / `outreach_sent` on the outbox row's
// real status (REC-10), not on "the call resolved". A relay 5xx still resolves
// — sendCandidateComm dead-letters and returns `failed` without throwing — and
// that must not consume the one-shot marker automation-run uses for already_sent.
// Terminal `queued` (COMMS_WEBHOOK_URL unset) stays `{ sent: true }`.
//
// unit-db.ts MUST be the first project import.
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry, hasEvent } from "./db/pipeline.ts";
import { listOutboxFiltered } from "./db/devcase.ts";
import { dispatchOutreach } from "./comms-dispatch.ts";
import { outreachStateFor } from "./outreach-state-store.ts";
import { setRelayHostLookupForTests } from "./comms.ts";

after(() => cleanupUnitDb());

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  setRelayHostLookupForTests(undefined);
  delete process.env.COMMS_WEBHOOK_URL;
});

const DRAFT = { subject: "A role you'd be great for", body: "We'd love to talk." };
const PUBLIC_LOOKUP = async () => [{ address: "93.184.216.34" }];

let seq = 0;
function entryFixture(contact?: string) {
  seq += 1;
  return createPipelineEntry({
    candidateId: `outreach-c${seq}`,
    candidateLabel: `Outreach Candidate ${seq}`,
    jobId: `outreach-job-${seq}`,
    jobTitle: "Backend Engineer",
    locale: "en",
    contact: contact ?? "jana@example.cz",
  }).entry;
}

test("no relay: terminal queued is { sent: true } and records outreach_sent", async () => {
  const entry = entryFixture();
  const result = await dispatchOutreach(entry, DRAFT);
  assert.deepEqual(result, { sent: true, status: "queued" });
  assert.equal(hasEvent(entry.id, "outreach_sent"), true);
  assert.equal(outreachStateFor(entry.id, entry.workspaceId).sends, 1);
  const rows = listOutboxFiltered({ ref: entry.id, kind: "outreach" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "queued");
});

test("a 500 relay does not record outreach_sent and is not { sent: true }", async () => {
  const entry = entryFixture();
  process.env.COMMS_WEBHOOK_URL = "https://relay.example.test/hook";
  setRelayHostLookupForTests(PUBLIC_LOOKUP);
  globalThis.fetch = (async () => new Response(null, { status: 500 })) as unknown as typeof fetch;

  const result = await dispatchOutreach(entry, DRAFT);

  assert.equal(result.sent, false);
  assert.deepEqual(result, { sent: false, reason: "delivery_failed", status: "failed" });
  assert.equal(hasEvent(entry.id, "outreach_sent"), false, "a dead-letter must not consume the one-shot marker");
  assert.equal(outreachStateFor(entry.id, entry.workspaceId).sends, 0, "the send counter stays 0 so a later inbound is not a reply");
  const rows = listOutboxFiltered({ ref: entry.id, kind: "outreach" });
  assert.equal(rows.length, 1, "the dead-letter is still the durable outbox row");
  assert.equal(rows[0].status, "failed");
});
