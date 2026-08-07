import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GEMINI_MAX_ATTEMPTS,
  geminiBackoffMs,
  isTransientGeminiError,
  withGeminiRetry,
} from "./gemini-retry.ts";

// The TS mirror of pipeline/jobfit/llm/base.py `is_transient_error` +
// `TextProvider.complete`: transient failures (429/5xx/timeouts) retry with
// backoff, permanent failures (400/auth) fail fast on attempt one.

function apiError(status: number, message = `got status: ${status}`): Error {
  // Shape of @google/genai's ApiError: an Error carrying the HTTP status.
  const error = new Error(message);
  (error as Error & { status: number }).status = status;
  return error;
}

const noSleep = async () => {};

test("classification: transient HTTP statuses are retryable", () => {
  for (const status of [408, 429, 500, 502, 503, 504, 529]) {
    assert.equal(isTransientGeminiError(apiError(status, "x")), true, `status ${status}`);
  }
});

test("classification: permanent statuses and junk are not retryable", () => {
  assert.equal(isTransientGeminiError(apiError(400, "invalid argument")), false);
  assert.equal(isTransientGeminiError(apiError(401, "unauthenticated")), false);
  assert.equal(isTransientGeminiError(apiError(403, "permission denied")), false);
  assert.equal(isTransientGeminiError(new Error("API key not valid")), false);
  assert.equal(isTransientGeminiError(null), false);
  assert.equal(isTransientGeminiError("boom"), false);
});

test("classification: message markers catch unstatused network failures", () => {
  assert.equal(isTransientGeminiError(new Error("fetch failed: request timed out")), true);
  assert.equal(isTransientGeminiError(new Error("RESOURCE_EXHAUSTED: quota")), true);
  assert.equal(isTransientGeminiError(new Error("The model is overloaded.")), true);
  assert.equal(isTransientGeminiError(new Error("service temporarily unavailable")), true);
});

test("classification: code/statusCode fields work like status", () => {
  const withCode = new Error("x") as Error & { code: number };
  withCode.code = 429;
  assert.equal(isTransientGeminiError(withCode), true);
  const withStatusCode = new Error("x") as Error & { statusCode: number };
  withStatusCode.statusCode = 503;
  assert.equal(isTransientGeminiError(withStatusCode), true);
});

test("retry: a mocked 429 then success returns the result after one retry", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const result = await withGeminiRetry(
    async () => {
      calls += 1;
      if (calls === 1) throw apiError(429, "rate limited");
      return "ok";
    },
    { sleep: async (ms) => void sleeps.push(ms), random: () => 0 }
  );
  assert.equal(result, "ok");
  assert.equal(calls, 2);
  // First backoff is 0.5s * 2^0 (+ zero jitter here) — the Python policy.
  assert.deepEqual(sleeps, [500]);
});

test("retry: a permanent 400 fails fast without a second attempt", async () => {
  let calls = 0;
  await assert.rejects(
    withGeminiRetry(
      async () => {
        calls += 1;
        throw apiError(400, "invalid request");
      },
      { sleep: noSleep }
    ),
    /invalid request/
  );
  assert.equal(calls, 1);
});

test("retry: persistent transient failure exhausts all attempts then rethrows the SDK error", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  await assert.rejects(
    withGeminiRetry(
      async () => {
        calls += 1;
        throw apiError(503, "unavailable");
      },
      { sleep: async (ms) => void sleeps.push(ms), random: () => 0 }
    ),
    (error: unknown) => (error as { status?: number }).status === 503
  );
  assert.equal(calls, GEMINI_MAX_ATTEMPTS);
  // Exponential: 0.5s, 1s (no sleep after the final attempt).
  assert.deepEqual(sleeps, [500, 1000]);
});

test("backoff: exponential with bounded jitter", () => {
  assert.equal(geminiBackoffMs(0, () => 0), 500);
  assert.equal(geminiBackoffMs(1, () => 0), 1000);
  assert.equal(geminiBackoffMs(2, () => 1), 2250); // jitter tops out at +250ms
});
