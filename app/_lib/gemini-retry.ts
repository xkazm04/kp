// Bounded retry for TS-side direct Gemini calls (app/api/github-analysis) —
// the ONE Gemini path that doesn't go through Python's LLM layer. Mirrors the
// policy proven there (pipeline/jobfit/llm/base.py `is_transient_error` +
// `TextProvider.complete`): retry ONLY transient failures (408/429/5xx and
// network timeouts), 3 attempts total, exponential backoff with jitter
// (0.5s * 2^attempt + up to 250ms), except that an explicit `Retry-After` from the
// server wins over the local schedule (see geminiRetryDelayMs). Permanent failures (auth, 400 bad request)
// fail fast on the first attempt. Keep the classification lists in sync with
// the Python side when tuning either.
//
// Dependency-free on purpose so the unit runner (`node --test`) can load it
// without the db/SDK import chain.

export const GEMINI_MAX_ATTEMPTS = 3;

// Same set as base.py: 408 (request timeout), 429 (rate limit), the 5xx family
// a busy backend emits, and 529 (overloaded).
export const TRANSIENT_HTTP_CODES = new Set([408, 429, 500, 502, 503, 504, 529]);

// Same marker list as base.py — matched against `Name: message`, lowercased.
export const TRANSIENT_MARKERS = [
  "rate limit",
  "rate_limit",
  "resource_exhausted",
  "unavailable",
  "deadline_exceeded",
  "overloaded",
  "429",
  "502",
  "503",
  "504",
  "529",
  "timeout",
  "timed out",
  "temporarily",
];

/**
 * True for retryable failures (rate limit, 5xx, network timeout) — NOT
 * auth / 4xx / bad-request, which are permanent and must fail fast.
 * `@google/genai`'s ApiError carries the HTTP status as `.status`; `.code` and
 * `.statusCode` cover fetch/undici and wrapped errors (Python checks `.code`
 * then `.status_code` the same way), then the message markers catch SDKs that
 * only stringify the condition.
 */
export function isTransientGeminiError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const carrier = error as Record<string, unknown>;
    for (const field of ["status", "code", "statusCode"]) {
      const value = carrier[field];
      if (typeof value === "number" && TRANSIENT_HTTP_CODES.has(value)) return true;
    }
  }
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  const text = `${name}: ${message}`.toLowerCase();
  return TRANSIENT_MARKERS.some((marker) => text.includes(marker));
}

/** Backoff before retry `attempt` (0-based): 0.5s * 2^attempt + jitter ≤ 250ms. */
export function geminiBackoffMs(attempt: number, random: () => number = Math.random): number {
  return 500 * 2 ** attempt + random() * 250;
}

/**
 * The ceiling on any single wait between attempts. The local schedule never sleeps
 * longer than ~1.25s, but a server that sends `Retry-After` is stating a fact about
 * its own bucket, and retrying earlier than it asked is a guaranteed second 429 that
 * burns the attempt. So we honour the header UP TO this ceiling and, past it, stop
 * retrying entirely: holding a Next request handler open for a 30s rate-limit window
 * is worse for the caller than failing now with the real error.
 */
export const GEMINI_RETRY_AFTER_CAP_MS = 5000;

/** Case-insensitive header lookup across the three carrier shapes an SDK error uses:
 *  a `Headers` (has `.get`), a `Map`, or a plain object. */
function headerValue(carrier: unknown, name: string): string | null {
  if (!carrier || typeof carrier !== "object") return null;
  const getter = (carrier as { get?: unknown }).get;
  if (typeof getter === "function") {
    const value = (getter as (k: string) => unknown).call(carrier, name);
    return typeof value === "string" ? value : null;
  }
  for (const [key, value] of Object.entries(carrier as Record<string, unknown>)) {
    if (key.toLowerCase() === name && typeof value === "string") return value;
  }
  return null;
}

/**
 * The delay a `Retry-After` response header asks for, in ms, or null when the error
 * carries none (or an unparseable one — a malformed header must fall back to our
 * schedule, never to 0). Both RFC 9110 forms are accepted: delta-seconds
 * ("30", "0.5") and an HTTP-date ("Wed, 21 Oct 2026 07:28:00 GMT"), the latter
 * measured against `now`. A date already in the past clamps to 0.
 * `@google/genai`'s ApiError exposes the response headers as `.headers`; fetch/undici
 * wrappers hang them off `.response.headers`.
 */
export function retryAfterMs(error: unknown, now: number = Date.now()): number | null {
  if (!error || typeof error !== "object") return null;
  const carrier = error as { headers?: unknown; response?: { headers?: unknown } };
  const raw = headerValue(carrier.headers, "retry-after") ?? headerValue(carrier.response?.headers, "retry-after");
  if (raw === null) return null;
  const text = raw.trim();
  if (!text) return null;
  const seconds = Number(text);
  if (Number.isFinite(seconds)) return seconds > 0 ? seconds * 1000 : 0;
  const at = Date.parse(text);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

/**
 * How long to wait before the next attempt, or null for "do not retry".
 * Server instruction beats our guess: when `Retry-After` asks for LONGER than the
 * local backoff we wait that long (up to `GEMINI_RETRY_AFTER_CAP_MS`), and when it
 * asks for longer than the cap we give up rather than hold the request open. A
 * header asking for less than our backoff does not shorten it — the schedule exists
 * to spread load, not just to satisfy the minimum.
 */
export function geminiRetryDelayMs(
  error: unknown,
  attempt: number,
  random: () => number = Math.random,
  now: number = Date.now()
): number | null {
  const scheduled = geminiBackoffMs(attempt, random);
  const advised = retryAfterMs(error, now);
  if (advised === null) return scheduled;
  if (advised > GEMINI_RETRY_AFTER_CAP_MS) return null;
  return Math.max(advised, scheduled);
}

type RetryOptions = {
  attempts?: number;
  /** Injectable for tests — defaults to a real setTimeout sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter source for tests — defaults to Math.random. */
  random?: () => number;
};

/**
 * Run `call`, retrying transient failures up to `attempts` times total with
 * jittered exponential backoff. The last error (or the first permanent one)
 * is rethrown unchanged so call-site error handling keeps seeing the real
 * SDK error, not a wrapper.
 */
export async function withGeminiRetry<T>(call: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? GEMINI_MAX_ATTEMPTS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !isTransientGeminiError(error)) throw error;
      const delay = geminiRetryDelayMs(error, attempt, options.random);
      // null = the server asked us to wait longer than we may hold the request.
      if (delay === null) throw error;
      await sleep(delay);
    }
  }
  throw lastError; // unreachable — the loop always returns or throws
}
