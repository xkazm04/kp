import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyApiFailure, TRANSPORT_FAILURE } from "./apiFailure";

test("a thrown fetch and an unparseable body are both transport faults", () => {
  assert.deepEqual(classifyApiFailure(null, null), TRANSPORT_FAILURE);
  // The dev server is not running: an HTML 404 page, so `res.json()` failed.
  assert.deepEqual(classifyApiFailure({ ok: false, status: 404 }, null), { kind: "transport", code: null });
  // A proxy answered 502 with an empty body.
  assert.deepEqual(classifyApiFailure({ ok: false, status: 502 }, null), { kind: "transport", code: null });
});

test("a coded answer is a refusal, or a store fault when the code says `_FAILED`", () => {
  assert.deepEqual(classifyApiFailure({ ok: false, status: 403 }, { code: "JOBSEEKER_SOURCE_REFUSED" }), { kind: "refusal", code: "JOBSEEKER_SOURCE_REFUSED" });
  assert.deepEqual(classifyApiFailure({ ok: false, status: 429 }, { code: "TOO_MANY_REQUESTS" }), { kind: "refusal", code: "TOO_MANY_REQUESTS" });
  assert.deepEqual(classifyApiFailure({ ok: false, status: 500 }, { code: "JOBSEEKER_STORE_FAILED" }), { kind: "store", code: "JOBSEEKER_STORE_FAILED" });
});

test("a JSON answer with no code is a store fault, not a transport one", () => {
  // The server responded and it was JSON: the app IS reachable, so the reader must not
  // be told to check that it is running. The surface's own fallback sentence applies.
  assert.deepEqual(classifyApiFailure({ ok: false, status: 500 }, {}), { kind: "store", code: null });
  // Contract violation: 200 with a body that carries none of the rows the route promises.
  assert.deepEqual(classifyApiFailure({ ok: true, status: 200 }, { rows: undefined } as { code?: unknown }), { kind: "store", code: null });
  // An empty-string code is no code.
  assert.deepEqual(classifyApiFailure({ ok: false, status: 500 }, { code: "" }), { kind: "store", code: null });
});
