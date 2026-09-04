// The board tab's last untested helpers. Both decide something a reader sees:
// `pipelineActionReason` decides whether a refused move is painted in the reader's
// LANGUAGE (payload with a code → useErrorMessage resolves `errors.<CODE>`) or in
// the caller's own generic copy (null → fallback), and `newViewId` decides whether
// a saved view survives a rename with its identity intact.
//
// The triage has three outcomes and the middle one is the subtle one: a body with
// an `error` but NO code is still worth returning (the route's sentence beats no
// reason at all), while an empty/whitespace-only pair must read as "no reason",
// not as a blank red chip under the card.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newViewId, pipelineActionReason, VIEW_PARAM_KEYS } from "./pipelineTabHelpers.ts";

const body = (payload: unknown): Response =>
  ({ json: async () => payload }) as unknown as Response;

test("pipelineActionReason: a coded refusal returns the WHOLE payload, code included", async () => {
  const out = await pipelineActionReason(
    body({ error: "Changed since you opened it", code: "PIPELINE_MOVE_CONFLICT" })
  );
  assert.deepEqual(out, { error: "Changed since you opened it", code: "PIPELINE_MOVE_CONFLICT" });
});

test("pipelineActionReason: a code with no message still returns — the code IS the reason", async () => {
  const out = await pipelineActionReason(body({ code: "PIPELINE_TERMINAL_NOT_MANUAL" }));
  assert.equal(out?.code, "PIPELINE_TERMINAL_NOT_MANUAL");
});

test("pipelineActionReason: a message with no code returns, so the route's sentence still shows", async () => {
  const out = await pipelineActionReason(body({ error: "Route through the offer flow" }));
  assert.equal(out?.error, "Route through the offer flow");
  assert.equal(out?.code, undefined);
});

test("pipelineActionReason: an empty/whitespace body reads as NO reason (caller falls back)", async () => {
  assert.equal(await pipelineActionReason(body({})), null);
  assert.equal(await pipelineActionReason(body({ error: "   ", code: "  " })), null);
  assert.equal(await pipelineActionReason(body({ error: null, code: null })), null);
});

test("pipelineActionReason: a non-JSON / thrown body is null, never a rejected promise", async () => {
  const thrown = {
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON");
    },
  } as unknown as Response;
  assert.equal(await pipelineActionReason(thrown), null);
});

test("newViewId: prefers randomUUID and always carries the v- prefix", () => {
  const id = newViewId();
  assert.match(id, /^v-/);
  assert.notEqual(newViewId(), newViewId(), "two mints never collide");
});

// The fallback exists because a saved view must be mintable on a page served over
// plain http (no SecureContext → no crypto.randomUUID) and in an older runtime.
// Both doors are pinned: crypto missing entirely, and a crypto whose randomUUID
// throws mid-call.
function withGlobalCrypto(value: unknown, fn: () => void): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { value, configurable: true, writable: true });
  try {
    fn();
  } finally {
    if (original) Object.defineProperty(globalThis, "crypto", original);
    else delete (globalThis as { crypto?: unknown }).crypto;
  }
}

test("newViewId: falls back to a timestamp+random id when crypto is unavailable", () => {
  withGlobalCrypto(undefined, () => {
    const id = newViewId();
    assert.match(id, /^v-\d+-[a-z0-9]+$/, "timestamp fallback shape");
  });
});

test("newViewId: falls back when randomUUID itself throws", () => {
  withGlobalCrypto(
    {
      randomUUID() {
        throw new Error("not a secure context");
      },
    },
    () => {
      assert.match(newViewId(), /^v-\d+-[a-z0-9]+$/);
    }
  );
});

test("VIEW_PARAM_KEYS: the link-wins vocabulary is closed and deduplicated", () => {
  assert.deepEqual([...VIEW_PARAM_KEYS], ["q", "quick", "score", "source", "sort", "stage"]);
  assert.equal(new Set(VIEW_PARAM_KEYS).size, VIEW_PARAM_KEYS.length);
});
