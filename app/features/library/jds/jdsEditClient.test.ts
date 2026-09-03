// Pins the CAS semantics of the ONE JD edit client (jd-edit-client.ts) that both
// the public JD page (JdActions) and the ledger's in-modal editor (JdModalEditor)
// now share. The React hook (useJdEditor) is a thin wrapper over these pure
// parts; the harness can't run the fetch/DOM half, so the CONTRACT — baseBody
// always rides along (round-5 honest CAS) and the response→outcome mapping is
// classified identically on both surfaces — is pinned here.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyJdWriteResponse, fetchJdRevisions, jdEditPayload, jdRevertPayload, performJdWrite } from "./jdsEditClient.ts";

test("an edit payload always carries baseBody — the CAS base a stale write is refused against", () => {
  const p = jdEditPayload("New title", "New body", "Loaded body");
  assert.deepEqual(p, { title: "New title", body: "New body", baseBody: "Loaded body" });
  // The loaded body must be present and distinct from the edit, or the server
  // can't detect a concurrent clobber.
  assert.equal(p.baseBody, "Loaded body");
});

test("a revert payload carries the revision id and the loaded baseBody", () => {
  assert.deepEqual(jdRevertPayload(42, "Loaded body"), { revisionId: 42, baseBody: "Loaded body" });
});

test("401 → gate: the honest operator latch, on both save and revert", () => {
  assert.equal(classifyJdWriteResponse(401, null), "gate");
  assert.equal(classifyJdWriteResponse(401, { code: "conflict" }), "gate"); // 401 wins over a body code
});

test("409 → conflict: the round-5 honest CAS conflict survives", () => {
  assert.equal(classifyJdWriteResponse(409, null), "conflict");
  assert.equal(classifyJdWriteResponse(409, { code: "conflict" }), "conflict");
});

test("a 2xx body carrying code:conflict is still a conflict (belt-and-suspenders route)", () => {
  assert.equal(classifyJdWriteResponse(200, { code: "conflict" }), "conflict");
});

test("a clean 2xx → ok", () => {
  assert.equal(classifyJdWriteResponse(200, null), "ok");
  assert.equal(classifyJdWriteResponse(204, {}), "ok");
});

test("any other non-2xx → error, NOT gate (403/404/500 must not latch the operator gate)", () => {
  assert.equal(classifyJdWriteResponse(403, null), "error");
  assert.equal(classifyJdWriteResponse(404, { error: "not found" }), "error");
  assert.equal(classifyJdWriteResponse(500, null), "error");
});

// ---- The async half, driven by a fetch stub. These pin what useJdEditor DOES
// with a response: the 401 gate latch and the 409 conflict flag had no test at
// all, and the revision load answered a failure with an empty array.

function stub(responses: { status: number; body?: unknown; ok?: boolean }[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let i = 0;
  const impl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(i++, responses.length - 1)];
    return {
      status: r.status,
      ok: r.ok ?? (r.status >= 200 && r.status < 300),
      json: async () => {
        if (r.body === undefined) throw new Error("no body");
        return r.body;
      },
    } as Response;
  };
  return { impl, calls };
}

test("a 401 on save is the GATE outcome — the latch the editor keeps its controls disabled with", async () => {
  const { impl, calls } = stub([{ status: 401, body: { error: "Unauthorized" } }]);
  const r = await performJdWrite("/api/jds/x", "PATCH", jdEditPayload("t", "b", "base"), impl);
  assert.equal(r.outcome, "gate");
  assert.equal(calls[0].init?.method, "PATCH");
  assert.equal(JSON.parse(String(calls[0].init?.body)).baseBody, "base", "the CAS base still rides along on a refused write");
});

test("a 409 on revert is the CONFLICT outcome, not a generic error", async () => {
  const { impl } = stub([{ status: 409, body: { code: "conflict" } }]);
  const r = await performJdWrite("/api/jds/x/revisions", "POST", jdRevertPayload(7, "base"), impl);
  assert.equal(r.outcome, "conflict");
});

test("a 500 with an unparseable body is an error, and does not throw on the JSON parse", async () => {
  const { impl } = stub([{ status: 500 }]);
  const r = await performJdWrite("/api/jds/x", "PATCH", {}, impl);
  assert.equal(r.outcome, "error");
  assert.equal(r.body, null);
});

test("a failed revision load THROWS — 'could not load' is not 'no history'", async () => {
  for (const bad of [{ status: 500, body: { error: "boom" } }, { status: 200, body: { nope: true } }]) {
    const { impl } = stub([bad]);
    await assert.rejects(() => fetchJdRevisions("my-jd", impl));
  }
});

test("a successful revision load returns the rows, and an empty history is a real empty array", async () => {
  const rows = [{ id: 1, title: "T", body: "B", created_at: "2026-01-01T00:00:00.000Z" }];
  assert.deepEqual(await fetchJdRevisions("my-jd", stub([{ status: 200, body: { revisions: rows } }]).impl), rows);
  assert.deepEqual(await fetchJdRevisions("my-jd", stub([{ status: 200, body: { revisions: [] } }]).impl), []);
});
