// The guided tour seeds `(SIM)` candidates and then drives the REAL invite and
// offer paths — the point of the demo is that nothing is faked. Comms dispatch
// knew nothing about the marker, so on a deploy with COMMS_WEBHOOK_URL (or a
// UI-configured relay) set, one demo run POSTed a schedule invite and an offer
// letter for a seeded profile to the customer's real relay. The relay maps a
// recipient identifier to an address: a seeded profile carries a plausible name,
// so "it won't resolve" was never a guarantee.
//
// The guard is in comms-dispatch.ts (`sendCommUnlessSim`) and keys off the ONE
// marker predicate (`isSimTitle` on the entry's `jobTitle` — the field
// simCvIntakeTarget stamps and resetSim purges by). A simulated comm is still
// RECORDED — the demo's Outbox row is half of what the tour shows — but on the
// `simulation` channel and never handed to the channel resolver, so no relay is
// contacted.
//
// unit-db.ts MUST be the first project import.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import { listOutboxFiltered } from "./db/devcase.ts";
import { SIM_COMMS_CHANNEL, dispatchOffer, dispatchRejection, dispatchScheduleInvite } from "./comms-dispatch.ts";
import { markSimTitle } from "../features/shell/simulation/constants.ts";

after(() => cleanupUnitDb());

let seq = 0;
function entryFixture(jobTitle: string) {
  seq += 1;
  return createPipelineEntry({
    candidateId: `csim-c${seq}`,
    candidateLabel: `Sim Candidate ${seq}`,
    jobId: `csim-job-${seq}`,
    jobTitle,
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
  try {
    await fn();
  } finally {
    delete process.env.COMMS_WEBHOOK_URL;
    globalThis.fetch = realFetch;
  }
  return posted;
}

test("a (SIM) entry's schedule invite NEVER reaches the relay", async () => {
  const entry = entryFixture(markSimTitle("Backend Engineer"));
  const posted = await withStubbedRelay(async () => {
    await dispatchScheduleInvite(entry, "https://kp.example/schedule/tok-sim");
  });

  assert.deepEqual(posted, [], "a simulated candidate must never be POSTed to the configured relay");
  const rows = listOutboxFiltered({ ref: entry.id, kind: "schedule_invite" });
  assert.equal(rows.length, 1, "the simulated comm is still recorded — the demo's Outbox row is what the tour shows");
  assert.equal(rows[0].channel, SIM_COMMS_CHANNEL, "and it is recorded on the simulation channel, not as a real send");
  assert.equal(rows[0].status, "queued", "…and never claims `sent`");
});

test("a (SIM) entry's OFFER letter never reaches the relay either", async () => {
  const entry = entryFixture(markSimTitle("Backend Engineer"));
  const posted = await withStubbedRelay(async () => {
    await dispatchOffer(entry, { subject: "Offer", body: "…" }, "https://kp.example/offer/tok-sim");
  });

  assert.deepEqual(posted, [], "the offer path inherits the same guard");
  assert.equal(listOutboxFiltered({ ref: entry.id, kind: "offer" })[0].channel, SIM_COMMS_CHANNEL);
});

test("a REAL entry still goes to the relay — the guard is the marker, not the demo mood", async () => {
  const entry = entryFixture("Backend Engineer");
  const posted = await withStubbedRelay(async () => {
    await dispatchRejection(entry);
  });

  assert.equal(posted.length, 1, "an unmarked entry must still be delivered");
  const rows = listOutboxFiltered({ ref: entry.id, kind: "rejection" });
  assert.equal(rows[0].channel, "webhook");
  assert.equal(rows[0].status, "sent");
});
