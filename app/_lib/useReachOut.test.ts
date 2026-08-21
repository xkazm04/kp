import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { postReachOut, reachOutVerdict } from "./useReachOut.ts";

// Delivery truth for the sourcing "Reach out" button. The route answers 200 with
// the automation's `applied` verdict, and a 200 does NOT mean a message went out:
// a repeat click hits the durable `outreach_sent` marker ("already_sent") and the
// consent / sequence-halt gates refuse the dispatch outright ("suppressed_*").
// The hook used to announce "a first-touch message is on its way" off `r.ok`
// alone — a green lie (app/_lib/comms-truth.ts). These pin the classifier and the
// transport; the hook itself is thin React state on top (no React renderer here).

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
});

function stubFetch(reply: { ok: boolean; status?: number; json: () => unknown } | (() => never)) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (typeof reply === "function") return reply();
    return { ok: reply.ok, status: reply.status ?? (reply.ok ? 200 : 500), json: async () => reply.json() };
  }) as typeof fetch;
  return calls;
}

const INPUT = { candidateId: "c1", candidateLabel: "Ada", archetype: "builder", matchScore: 82 };

test("reachOutVerdict only claims a send when the server actually dispatched one", () => {
  assert.deepEqual(reachOutVerdict("sent"), { ok: true, note: "sent" });
  assert.deepEqual(reachOutVerdict("already_sent"), { ok: true, note: "already_sent" });
  const anonymized = reachOutVerdict("suppressed_anonymized");
  assert.equal(anonymized.ok, false);
  assert.match((anonymized as { message: string }).message, /No message was sent/);
  const consent = reachOutVerdict("suppressed_consent_expired");
  assert.equal(consent.ok, false);
  assert.match((consent as { message: string }).message, /No message was sent/);
  // An absent/unknown verdict keeps the optimistic reading — only the verdicts we
  // can name change behaviour.
  assert.deepEqual(reachOutVerdict(undefined), { ok: true, note: "sent" });
  assert.deepEqual(reachOutVerdict("drafted"), { ok: true, note: "sent" });
});

test("a suppressed dispatch is a failure, not a green reach-out", async () => {
  // The GDPR/halt gate inside dispatchOutreach refuses: the entry exists, but
  // NOTHING was queued or relayed. 200 OK all the same.
  stubFetch({ ok: true, json: () => ({ entryId: "e1", created: true, applied: "suppressed_consent_expired" }) });
  const result = await postReachOut("job1", INPUT, "sourcing");
  assert.equal(result.ok, false, "a refused dispatch must never read as a completed reach-out");
});

test("a repeat reach-out reports that no NEW message was sent", async () => {
  stubFetch({ ok: true, json: () => ({ entryId: "e1", created: false, applied: "already_sent" }) });
  const result = await postReachOut("job1", INPUT, "sourcing");
  assert.deepEqual(result, { ok: true, note: "already_sent" });
});

test("postReachOut POSTs the sourcing body and reports a real send", async () => {
  const calls = stubFetch({ ok: true, json: () => ({ entryId: "e1", created: true, applied: "sent" }) });
  const result = await postReachOut("job 1", INPUT, "sourcing");
  assert.deepEqual(result, { ok: true, note: "sent" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/jobs/job%201/candidates/outreach");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body as string), {
    candidateId: "c1",
    candidateLabel: "Ada",
    archetype: "builder",
    matchScore: 82,
    roleFamily: null,
    source: "sourcing",
  });
});

test("a per-candidate source wins over the surface default; neither sends no key", async () => {
  const calls = stubFetch({ ok: true, json: () => ({ applied: "sent" }) });
  await postReachOut("job1", { ...INPUT, source: "match" }, "sourcing");
  assert.equal(JSON.parse(calls[0].init.body as string).source, "match");
  await postReachOut("job1", INPUT, null);
  assert.equal("source" in JSON.parse(calls[1].init.body as string), false);
});

test("non-OK statuses and thrown network errors surface without throwing", async () => {
  stubFetch({ ok: false, status: 409, json: () => ({ error: "This candidate has been anonymized and can no longer be contacted." }) });
  assert.deepEqual(await postReachOut("job1", INPUT, "sourcing"), {
    ok: false,
    message: "This candidate has been anonymized and can no longer be contacted.",
  });

  // e.g. an HTML 500: .json() throws, our catch yields null, no payload.error.
  stubFetch({ ok: false, status: 500, json: () => { throw new Error("not json"); } });
  assert.deepEqual(await postReachOut("job1", INPUT, "sourcing"), { ok: false, message: "Couldn't reach out (500)." });

  stubFetch(() => { throw new Error("network down"); });
  assert.deepEqual(await postReachOut("job1", INPUT, "sourcing"), { ok: false, message: "network down" });
});
