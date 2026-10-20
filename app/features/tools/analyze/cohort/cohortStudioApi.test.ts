import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchCohortView, fetchMetered, fetchProposal, fetchRecentCohorts, startCohort } from "./cohortStudioApi.ts";

type Call = { url: string; init?: { method?: string; body?: string } };

/** A stub fetch: answers each URL from the table, records every call. */
function stub(table: Record<string, { status: number; body: unknown } | "throw">) {
  const calls: Call[] = [];
  const f = async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, init });
    const hit = table[url];
    if (!hit) throw new Error(`unexpected ${url}`);
    if (hit === "throw") throw new TypeError("network down");
    return { ok: hit.status >= 200 && hit.status < 300, status: hit.status, json: async () => hit.body };
  };
  return { f, calls };
}

test("the proposal read encodes the role and returns the contract", async () => {
  const body = { jdSlug: "a b", jdTitle: "T", members: [], leftOut: { applicants: 0, matched: 0 }, cap: 20, freshCount: 0 };
  const { f, calls } = stub({ "/api/analyze/cohort/proposal?jd=a%20b": { status: 200, body } });
  const r = await fetchProposal(f, "a b");
  assert.equal(calls[0].url, "/api/analyze/cohort/proposal?jd=a%20b");
  assert.deepEqual(r, { ok: true, data: body });
});

test("a coded refusal comes back as its code and values, never as its English", async () => {
  const { f } = stub({
    "/api/analyze/cohort": { status: 400, body: { error: "That comparison cannot start.", code: "COHORT_REQUEST_INVALID", min: 2, max: 20 } },
  });
  const r = await startCohort(f, { jdSlug: "jd", members: [], blind: false, reportLang: "en" });
  assert.deepEqual(r, { ok: false, failure: { code: "COHORT_REQUEST_INVALID", values: { min: 2, max: 20 }, status: 400 } });
});

test("the start posts the request as JSON", async () => {
  const { f, calls } = stub({ "/api/analyze/cohort": { status: 200, body: { cohortId: "c1", taskId: "t1" } } });
  const req = { jdSlug: "jd", members: [{ memberId: "a", membership: "applicant" as const }], blind: true, reportLang: "cs" };
  const r = await startCohort(f, req);
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init?.body ?? "null"), req);
  assert.deepEqual(r, { ok: true, data: { cohortId: "c1", taskId: "t1" } });
});

test("a network failure and an off-contract 200 are failures without a code", async () => {
  const { f } = stub({ "/api/analyze/cohort/c1": "throw", "/api/analyze/cohort": { status: 200, body: { nope: true } } });
  assert.deepEqual(await fetchCohortView(f, "c1"), { ok: false, failure: { code: null, values: {}, status: 0 } });
  assert.deepEqual(await fetchRecentCohorts(f), { ok: false, failure: { code: null, values: {}, status: 200 } });
});

test("an abort is rethrown for the caller to drop, not reported as a failure", async () => {
  const f = async () => {
    const e = new Error("aborted");
    e.name = "AbortError";
    throw e;
  };
  await assert.rejects(() => fetchCohortView(f, "c1"), { name: "AbortError" });
});

test("metering is known only from a readable billing overview", async () => {
  assert.equal(await fetchMetered(stub({ "/api/billing": { status: 200, body: { metered: true } } }).f), true);
  assert.equal(await fetchMetered(stub({ "/api/billing": { status: 200, body: { metered: false } } }).f), false);
  assert.equal(await fetchMetered(stub({ "/api/billing": { status: 403, body: { code: "FORBIDDEN" } } }).f), null);
});
