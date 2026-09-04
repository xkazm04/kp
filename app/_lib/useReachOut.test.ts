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
  // The verdict is DATA now, not an English sentence: the two suppressions are
  // told apart by a token the hook localizes (88013253's fix, applied here).
  assert.deepEqual(reachOutVerdict("suppressed_anonymized"), {
    ok: false,
    suppression: "anonymized",
    code: null,
    capability: null,
    status: 200,
  });
  assert.deepEqual(reachOutVerdict("suppressed_consent_expired"), {
    ok: false,
    suppression: "suppressed",
    code: null,
    capability: null,
    status: 200,
  });
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

test("a refusal is carried as a CODE — the server's English never crosses", async () => {
  // The defect: `payload?.error ?? ...` painted this canonical English sentence
  // onto a Czech, German or French surface, while the coded half sat unread
  // beside it. Post-fix the prose is dropped at the boundary.
  stubFetch({
    ok: false,
    status: 409,
    json: () => ({
      error: "This candidate has been anonymized and can no longer be contacted.",
      code: "OUTREACH_ANONYMIZED",
    }),
  });
  assert.deepEqual(await postReachOut("job1", INPUT, "sourcing"), {
    ok: false,
    suppression: null,
    code: "OUTREACH_ANONYMIZED",
    capability: null,
    status: 409,
  });

  // A capability refusal carries the permission it wanted as DATA, so the
  // localized sentence can name it (capabilityAwareReason).
  stubFetch({ ok: false, status: 403, json: () => ({ error: "Not permitted.", code: "FORBIDDEN_CAPABILITY", capability: "comms.send" }) });
  assert.deepEqual(await postReachOut("job1", INPUT, "sourcing"), {
    ok: false,
    suppression: null,
    code: "FORBIDDEN_CAPABILITY",
    capability: "comms.send",
    status: 403,
  });

  // e.g. an HTML 500: .json() throws, our catch yields null, so there is no code
  // to resolve — only the status, which is still the honest half.
  stubFetch({ ok: false, status: 500, json: () => { throw new Error("not json"); } });
  assert.deepEqual(await postReachOut("job1", INPUT, "sourcing"), {
    ok: false,
    suppression: null,
    code: null,
    capability: null,
    status: 500,
  });

  // A thrown fetch never reached the server: no code, no status.
  stubFetch(() => { throw new Error("network down"); });
  assert.deepEqual(await postReachOut("job1", INPUT, "sourcing"), {
    ok: false,
    suppression: null,
    code: null,
    capability: null,
    status: null,
  });
});

test("the route's GDPR 409 keeps WHICH suppression, without its prose", async () => {
  // The route names the suppression in a `suppressed` field beside two English
  // sentences. Carrying the token means a 409 and a 200-with-suppression render
  // the same localized line instead of one of them shipping English.
  stubFetch({
    ok: false,
    status: 409,
    json: () => ({ error: "This candidate has been anonymized and can no longer be contacted.", suppressed: "anonymized" }),
  });
  assert.deepEqual(await postReachOut("job1", INPUT, "sourcing"), {
    ok: false,
    suppression: "anonymized",
    code: null,
    capability: null,
    status: 200,
  });
  stubFetch({ ok: false, status: 409, json: () => ({ error: "consent expired", suppressed: "consent_expired" }) });
  assert.equal((await postReachOut("job1", INPUT, "sourcing") as { suppression: string }).suppression, "suppressed");
});

test("no failure path leaks a server sentence any more", async () => {
  const leaky = "This candidate has been anonymized and can no longer be contacted.";
  stubFetch({ ok: false, status: 409, json: () => ({ error: leaky, code: "OUTREACH_ANONYMIZED" }) });
  const failure = await postReachOut("job1", INPUT, "sourcing");
  assert.equal(JSON.stringify(failure).includes(leaky), false, "the English prose stays in the server log");
  assert.equal("message" in failure, false, "there is deliberately no `message` field to reach for");
});
