import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GEMINI_MAX_ATTEMPTS,
  GEMINI_RETRY_AFTER_CAP_MS,
  geminiBackoffMs,
  geminiRetryDelayMs,
  isTransientGeminiError,
  retryAfterMs,
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

// --- Retry-After ------------------------------------------------------------
// The server telling us when its bucket refills is better information than our
// local schedule, and retrying before then is a guaranteed second 429.

function rateLimited(retryAfter: string, kind: "headers" | "response" = "headers"): Error {
  const error = apiError(429, "rate limited") as Error & Record<string, unknown>;
  const headers = new Headers({ "Retry-After": retryAfter });
  if (kind === "headers") error.headers = headers;
  else error.response = { headers };
  return error;
}

test("retry-after: delta-seconds, HTTP-date and plain-object headers all parse", () => {
  const now = Date.parse("2026-10-21T07:28:00Z");
  assert.equal(retryAfterMs(rateLimited("2"), now), 2000);
  assert.equal(retryAfterMs(rateLimited("2", "response"), now), 2000);
  assert.equal(retryAfterMs(rateLimited("Wed, 21 Oct 2026 07:28:03 GMT"), now), 3000);
  // A date already past clamps to 0 rather than going negative.
  assert.equal(retryAfterMs(rateLimited("Wed, 21 Oct 2026 07:27:00 GMT"), now), 0);
  const plain = apiError(429) as Error & { headers: Record<string, string> };
  plain.headers = { "retry-after": "1" };
  assert.equal(retryAfterMs(plain, now), 1000);
});

test("retry-after: absent or unparseable falls back to the local schedule", () => {
  assert.equal(retryAfterMs(apiError(429)), null);
  assert.equal(retryAfterMs(rateLimited("   ")), null);
  assert.equal(retryAfterMs(rateLimited("soon-ish")), null);
  assert.equal(retryAfterMs(null), null);
  // …and the delay policy therefore uses the backoff schedule unchanged.
  assert.equal(geminiRetryDelayMs(apiError(429), 0, () => 0), 500);
  assert.equal(geminiRetryDelayMs(rateLimited("soon-ish"), 1, () => 0), 1000);
});

test("retry-after: a longer wait wins, a shorter one never shortens the backoff", () => {
  assert.equal(geminiRetryDelayMs(rateLimited("3"), 0, () => 0), 3000);
  assert.equal(geminiRetryDelayMs(rateLimited("0.1"), 0, () => 0), 500);
  assert.equal(geminiRetryDelayMs(rateLimited("0"), 1, () => 0), 1000);
});

test("retry-after: past the cap we stop retrying instead of holding the request open", () => {
  assert.equal(geminiRetryDelayMs(rateLimited(String(GEMINI_RETRY_AFTER_CAP_MS / 1000 + 1)), 0, () => 0), null);
});

test("retry: withGeminiRetry sleeps for the header, not the schedule", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const result = await withGeminiRetry(
    async () => {
      calls += 1;
      if (calls === 1) throw rateLimited("2");
      return "ok";
    },
    { sleep: async (ms) => void sleeps.push(ms), random: () => 0 }
  );
  assert.equal(result, "ok");
  assert.deepEqual(sleeps, [2000]);
});

test("retry: a Retry-After past the cap rethrows the SDK error on attempt one", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  await assert.rejects(
    withGeminiRetry(
      async () => {
        calls += 1;
        throw rateLimited("60");
      },
      { sleep: async (ms) => void sleeps.push(ms), random: () => 0 }
    ),
    (error: unknown) => (error as { status?: number }).status === 429
  );
  assert.equal(calls, 1, "a 60s bucket must not be retried on our schedule");
  assert.deepEqual(sleeps, []);
});
