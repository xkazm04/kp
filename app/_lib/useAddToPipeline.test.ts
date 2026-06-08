import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { pipelineAddBody, postPipelineAdd } from "./useAddToPipeline.ts";

// idea-cfa6103b — RecruiterCandidates and RediscoverPanel each hand-rolled the same
// optimistic add-to-pipeline POST and had drifted (one sent roleFamily, the other
// omitted it; differing error fallbacks). These pin the two pure pieces the hook is
// built on: the fixed body shape and the shared error handling. The hook itself is
// thin React state on top — not exercised here (the repo has no React renderer).

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
});

// Capture the single fetch call so we can assert URL/method/body, and reply with a
// caller-supplied Response-like object.
function stubFetch(reply: { ok: boolean; status?: number; json: () => unknown } | (() => never)) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (typeof reply === "function") return reply();
    return { ok: reply.ok, status: reply.status ?? (reply.ok ? 200 : 500), json: async () => reply.json() };
  }) as typeof fetch;
  return calls;
}

test("pipelineAddBody fixes stage to Screened and always carries roleFamily", () => {
  const withFamily = pipelineAddBody("job1", "Staff Eng", {
    candidateId: "c1",
    candidateLabel: "Ada",
    archetype: "builder",
    matchScore: 82,
    roleFamily: "software_engineering",
  });
  assert.deepEqual(withFamily, {
    candidateId: "c1",
    candidateLabel: "Ada",
    archetype: "builder",
    roleFamily: "software_engineering",
    jobId: "job1",
    jobTitle: "Staff Eng",
    matchScore: 82,
    stage: "Screened",
  });

  // The rediscovery caller omits roleFamily — it must coalesce to null, not vanish,
  // so the body shape is identical regardless of caller.
  const withoutFamily = pipelineAddBody("job1", "Staff Eng", {
    candidateId: "c2",
    candidateLabel: "Grace",
    archetype: null,
    matchScore: null,
  });
  assert.equal(withoutFamily.roleFamily, null);
  assert.equal(withoutFamily.archetype, null);
  assert.equal(withoutFamily.matchScore, null);
  assert.equal(withoutFamily.stage, "Screened");
});

test("postPipelineAdd POSTs the built body as JSON to /api/pipeline", async () => {
  const calls = stubFetch({ ok: true, json: () => ({ id: "e1" }) });
  const result = await postPipelineAdd("job1", "Staff Eng", {
    candidateId: "c1",
    candidateLabel: "Ada",
    archetype: "builder",
    matchScore: 82,
    roleFamily: "software_engineering",
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/pipeline");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body as string), pipelineAddBody("job1", "Staff Eng", {
    candidateId: "c1",
    candidateLabel: "Ada",
    archetype: "builder",
    matchScore: 82,
    roleFamily: "software_engineering",
  }));
});

const INPUT = { candidateId: "c1", candidateLabel: "Ada", archetype: "builder", matchScore: 82 };

test("postPipelineAdd surfaces a body { error } on a non-OK status", async () => {
  stubFetch({ ok: false, status: 400, json: () => ({ error: "candidateId and jobId are required." }) });
  const result = await postPipelineAdd("job1", "Staff Eng", INPUT);
  assert.deepEqual(result, { ok: false, message: "candidateId and jobId are required." });
});

test("postPipelineAdd falls back to a status message when the error body has none", async () => {
  // e.g. an HTML 500: .json() throws, our catch yields null, no payload.error.
  stubFetch({ ok: false, status: 500, json: () => { throw new Error("not json"); } });
  const result = await postPipelineAdd("job1", "Staff Eng", INPUT);
  assert.deepEqual(result, { ok: false, message: "Couldn't add (500)." });
});

test("postPipelineAdd reports a thrown network error without throwing", async () => {
  stubFetch(() => { throw new Error("network down"); });
  const result = await postPipelineAdd("job1", "Staff Eng", INPUT);
  assert.deepEqual(result, { ok: false, message: "network down" });
});
