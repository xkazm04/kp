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
import { classifyJdWriteResponse, jdEditPayload, jdRevertPayload } from "./jd-edit-client.ts";

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
