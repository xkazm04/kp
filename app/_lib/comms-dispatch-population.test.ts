// An AI agent can stand on a role's slate beside people (population 'agent'). It has
// no mailbox, but the recipient cascade resolved its label all the same and the
// dispatcher handed that to the relay — a dead letter discovered minutes later, as a
// bounce, for a send whose failure was knowable before it started.
//
// The refusal is in comms-dispatch.ts (`sendCandidateComm`, via candidateRecipient's
// NULL): the comm is recorded at once as `failed` on the `refused` channel with the
// reason in failure_detail, and no relay is contacted.
//
// unit-db.ts MUST be the first project import.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import { listOutboxFiltered } from "./db/devcase.ts";
import { REFUSED_COMMS_CHANNEL, dispatchRejection } from "./comms-dispatch.ts";
import { setRelayHostLookupForTests } from "./comms.ts";

after(() => cleanupUnitDb());

let seq = 0;
function entryFixture() {
  seq += 1;
  return createPipelineEntry({
    candidateId: `cpop-c${seq}`,
    candidateLabel: `Slate Member ${seq}`,
    jobId: `cpop-job-${seq}`,
    jobTitle: "Backend Engineer",
    locale: "en",
  }).entry;
}

/** Run `fn` with a configured relay whose every POST is captured, never sent. */
async function withStubbedRelay(fn: () => Promise<void>): Promise<string[]> {
  const posted: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    posted.push(String(input));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  process.env.COMMS_WEBHOOK_URL = "https://relay.invalid/hook";
  setRelayHostLookupForTests(async () => [{ address: "93.184.216.34" }]);
  try {
    await fn();
  } finally {
    delete process.env.COMMS_WEBHOOK_URL;
    setRelayHostLookupForTests(undefined);
    globalThis.fetch = realFetch;
  }
  return posted;
}

test("an agent-population entry is refused as `failed` at once, and the relay is never contacted", async () => {
  // The column is additive; until the store carries it the dispatcher reads it off the entry.
  const agent = { ...entryFixture(), population: "agent" };
  const posted = await withStubbedRelay(async () => {
    await dispatchRejection(agent);
  });

  assert.deepEqual(posted, [], "an entity with no mailbox must never be handed to the relay");
  const rows = listOutboxFiltered({ ref: agent.id, kind: "rejection" });
  assert.equal(rows.length, 1, "the refusal is still recorded — the audit trail says what was not sent");
  assert.equal(rows[0].status, "failed");
  assert.equal(rows[0].channel, REFUSED_COMMS_CHANNEL);
  assert.match(rows[0].failureDetail ?? "", /agent_population/, "the row states WHY, not a bare failure");
  assert.equal(rows[0].recipient, "", "no invented recipient — and nothing the resend door could re-dispatch");
  assert.doesNotMatch(rows[0].body ?? "", /\/data\/|\/stop\//, "no capability-link footers minted for an inbox that does not exist");
});

test("a person on the same slate is still delivered", async () => {
  const person = { ...entryFixture(), population: "human" };
  const posted = await withStubbedRelay(async () => {
    await dispatchRejection(person);
  });

  assert.equal(posted.length, 1);
  const rows = listOutboxFiltered({ ref: person.id, kind: "rejection" });
  assert.equal(rows[0].status, "sent");
  assert.equal(rows[0].channel, "webhook");
});
