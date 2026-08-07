// Bounded retry for TS-side direct Gemini calls (app/api/github-analysis) —
// the ONE Gemini path that doesn't go through Python's LLM layer. Mirrors the
// policy proven there (pipeline/jobfit/llm/base.py `is_transient_error` +
// `TextProvider.complete`): retry ONLY transient failures (408/429/5xx and
// network timeouts), 3 attempts total, exponential backoff with jitter
// (0.5s * 2^attempt + up to 250ms). Permanent failures (auth, 400 bad request)
// fail fast on the first attempt. Keep the classification lists in sync with
// the Python side when tuning either.
//
// Dependency-free on purpose so the unit runner (`node --test`) can load it
// without the db/SDK import chain.

export const GEMINI_MAX_ATTEMPTS = 3;

// Same set as base.py: 408 (request timeout), 429 (rate limit), the 5xx family
// a busy backend emits, and 529 (overloaded).
const TRANSIENT_HTTP_CODES = new Set([408, 429, 500, 502, 503, 504, 529]);

// Same marker list as base.py — matched against `Name: message`, lowercased.
const TRANSIENT_MARKERS = [
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
      await sleep(geminiBackoffMs(attempt, options.random));
    }
  }
  throw lastError; // unreachable — the loop always returns or throws
}
