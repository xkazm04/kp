// The realtime transport used to throw ONE English string carrying the provider's
// response body, and the shell rendered it to the candidate. These pin the mapper
// that replaced it, and pin every code to all four catalogs (the client-side twin
// of the STORE_ERRORS/REFUSAL_ERRORS check in scripts/i18n-check.mjs — these codes
// are client-origin, so that check cannot see them).
//
// Runner: node --test with type stripping (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  VOICE_TRANSPORT_ERRORS,
  VoiceTransportError,
  classifyCallsStatus,
  classifyThrownTransportFailure,
  isVoiceTransportError,
  type VoiceTransportCode,
} from "./transport-error.ts";

test("a rejected credential is AUTH, not a generic provider fault", () => {
  assert.equal(classifyCallsStatus(401), "VOICE_TRANSPORT_AUTH");
  assert.equal(classifyCallsStatus(403), "VOICE_TRANSPORT_AUTH");
});

test("a provider gateway timeout is TIMEOUT, a provider fault is PROVIDER", () => {
  assert.equal(classifyCallsStatus(408), "VOICE_TRANSPORT_TIMEOUT");
  assert.equal(classifyCallsStatus(504), "VOICE_TRANSPORT_TIMEOUT");
  assert.equal(classifyCallsStatus(500), "VOICE_TRANSPORT_PROVIDER");
  assert.equal(classifyCallsStatus(429), "VOICE_TRANSPORT_PROVIDER");
  assert.equal(classifyCallsStatus(400), "VOICE_TRANSPORT_PROVIDER");
});

test("a fetch that never completed is NETWORK; an abort is TIMEOUT", () => {
  assert.equal(classifyThrownTransportFailure(new TypeError("Failed to fetch")), "VOICE_TRANSPORT_NETWORK");
  const abort = new Error("aborted");
  abort.name = "AbortError";
  assert.equal(classifyThrownTransportFailure(abort), "VOICE_TRANSPORT_TIMEOUT");
  assert.equal(classifyThrownTransportFailure(null), "VOICE_TRANSPORT_NETWORK");
});

test("the provider body stays in `detail` and never becomes the code", () => {
  const body = '{"error":{"message":"Incorrect API key provided: sk-live-abc"}}';
  const err = new VoiceTransportError("VOICE_TRANSPORT_AUTH", `401 ${body}`);
  assert.equal(err.code, "VOICE_TRANSPORT_AUTH");
  assert.ok(err.detail.includes("sk-live-abc"), "the operator still gets the real body in the log");
  assert.ok(isVoiceTransportError(err));
  // Still an Error, so the intake surface's micFailure()/micErrorText() path,
  // which reads `e instanceof Error ? e.message : String(e)`, is unchanged.
  assert.ok(err instanceof Error);
});

test("a plain Error is NOT a transport error — the shell must keep its own fallback", () => {
  assert.equal(isVoiceTransportError(new Error("boom")), false);
  assert.equal(isVoiceTransportError("boom"), false);
});

test("every transport code has copy in all four catalogs", () => {
  const codes = Object.keys(VOICE_TRANSPORT_ERRORS) as VoiceTransportCode[];
  assert.ok(codes.length === 4, "four causes, four next actions");
  for (const locale of ["en", "cs", "de", "fr"]) {
    const url = new URL(`../../../../messages/${locale}.json`, import.meta.url);
    const catalog = JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as {
      errors?: Record<string, string>;
    };
    for (const code of codes) {
      const message = catalog.errors?.[code];
      assert.ok(
        typeof message === "string" && message.trim().length > 0,
        `messages/${locale}.json is missing errors.${code} — useErrorMessage would silently ` +
          `fall through to the generic sentence in that locale`
      );
      assert.ok(!message.includes("sk-"), "catalog copy must never carry a provider credential");
    }
  }
});
