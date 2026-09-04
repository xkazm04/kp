// The precondition every door into the comms channel shares (lot CM, wave 37).
//
// The compliance gate — never write to an ANONYMIZED candidate, or one whose
// processing consent EXPIRED — lived in `dispatchOutreach` alone. The resend door, the
// dev-case lifecycle close, the orchestrator's promotion batch and the intake
// acknowledgement all call `sendComm` directly and skipped it, so the gate was a
// property of one call path rather than of sending.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { CommsSuppressedError, commsSendSuppression, sendComm } from "./comms.ts";
import { anonymizeEntry, createPipelineEntry } from "./db/pipeline.ts";
import { listOutboxFiltered } from "./db/devcase.ts";
import { haltOutreach } from "./outreach-state-store.ts";

after(() => cleanupUnitDb());

const mk = (candidateId: string, jobId: string) =>
  createPipelineEntry({ candidateId, candidateLabel: "Jana", jobId, jobTitle: "Backend Engineer" }).entry;

test("a DIRECT sendComm on an anonymized entry is refused with a code, and writes nothing", async () => {
  const entry = mk("cand-anon", "job-anon");
  anonymizeEntry(entry.id, "erasure");
  await assert.rejects(
    () => sendComm({ to: "Jana", subject: "Offer", body: "…", kind: "offer", ref: entry.id }),
    (err: unknown) => {
      assert.ok(err instanceof CommsSuppressedError, "a refusal, not a store fault");
      assert.equal(err.code, "COMMS_SUPPRESSED");
      assert.equal(err.reason, "anonymized");
      return true;
    }
  );
  assert.equal(listOutboxFiltered({ ref: entry.id }).length, 0, "no row records a send that must not happen");
});

test("an ordinary entry still sends", async () => {
  const entry = mk("cand-ok", "job-ok");
  assert.equal(commsSendSuppression({ to: "Jana", subject: "s", body: "b", kind: "offer", ref: entry.id }), null);
  const row = await sendComm({ to: "Jana", subject: "s", body: "b", kind: "offer", ref: entry.id });
  assert.equal(row.status, "queued", "no relay configured — the local outbox is terminal");
  assert.equal(listOutboxFiltered({ ref: entry.id }).length, 1);
});

test("an ENTRY-LESS comm has no candidate identity to consult and passes through", () => {
  assert.equal(commsSendSuppression({ to: "lead@example.com", subject: "s", body: "b", kind: "ko_decline" }), null);
  // …and so does a ref that names something other than a pipeline entry.
  assert.equal(commsSendSuppression({ to: "x", subject: "s", body: "b", kind: "feedback", ref: "sub_123" }), null);
});

test("the outreach SEQUENCE halt binds outreach only — a rejection is still owed to a halted candidate", () => {
  const entry = mk("cand-halt", "job-halt");
  haltOutreach(entry.id);
  assert.equal(commsSendSuppression({ to: "Jana", subject: "s", body: "b", kind: "outreach", ref: entry.id }), "manual");
  assert.equal(commsSendSuppression({ to: "Jana", subject: "s", body: "b", kind: "rejection", ref: entry.id }), null);
});
