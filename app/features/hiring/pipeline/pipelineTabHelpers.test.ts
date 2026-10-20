// The board tab's last untested helpers. Both decide something a reader sees:
// `pipelineActionReason` decides whether a refused move is painted in the reader's
// LANGUAGE (payload with a code → useErrorMessage resolves `errors.<CODE>`) or in
// the caller's own generic copy (null → fallback).
//
// The triage has three outcomes and the middle one is the subtle one: a body with
// an `error` but NO code is still worth returning (the route's sentence beats no
// reason at all), while an empty/whitespace-only pair must read as "no reason",
// not as a blank red chip under the card.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pipelineActionReason } from "./pipelineTabHelpers.ts";

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
