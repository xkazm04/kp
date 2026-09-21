import { test } from "node:test";
import assert from "node:assert/strict";
import { foldMintRefusal } from "./liveWorkMint.ts";

test("a successful mint paints no refusal", () => {
  assert.equal(foldMintRefusal({ ok: true }), null);
});

test("an HTTP refusal with a body code keeps that payload", () => {
  assert.deepEqual(foldMintRefusal({ ok: false, payload: { code: "POSTING_CLOSED", error: "gone" } }), {
    code: "POSTING_CLOSED",
    error: null,
  });
});

test("an HTTP refusal without a code still paints, so the generic line can show", () => {
  assert.deepEqual(foldMintRefusal({ ok: false, payload: { code: null, error: "nope" } }), {
    code: null,
    error: null,
  });
  assert.deepEqual(foldMintRefusal({ ok: false, payload: null }), { code: null, error: null });
});

test("a thrown fetch (offline, DNS, CORS) paints the same generic refusal as a body-less HTTP miss", () => {
  assert.deepEqual(foldMintRefusal({ networkError: true }), { code: null, error: null });
});
