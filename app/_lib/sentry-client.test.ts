// The error-boundary reporter is the ONE place a client exception leaves the
// deployment. instrumentation-client.ts already redacts capability tokens out of
// the event URL and transaction — but not out of the exception, and the exception
// is where they actually are: a failed fetch throws with the request URL in its
// message, and every stack frame carries the module URL of the candidate page the
// crash happened on. This locks the scrub so a `/schedule/<token>`, an api-key
// field or a bearer header can never ride a boundary report to a third party.
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { scrubbedForCapture } from "./sentry-client.ts";

test("a capability token in the message is redacted, the route shape is kept", () => {
  const err = new Error("Failed to fetch https://kp.example.com/api/schedule/abc123SECRET?x=1");
  const out = scrubbedForCapture(err) as Error;
  assert.ok(!out.message.includes("abc123SECRET"), "the token must not survive");
  assert.match(out.message, /\/api\/schedule\/\[token\]/, "the route shape must survive — it is the diagnostic");
});

test("a capability token in the STACK is redacted too", () => {
  const err = new Error("boom");
  err.stack = "Error: boom\n    at Page (https://kp.example.com/interview/tok-9f8e7d/page.js:2:3)";
  const out = scrubbedForCapture(err) as Error;
  assert.ok(!String(out.stack).includes("tok-9f8e7d"), "a stack frame URL carries the token as surely as the message");
  assert.match(String(out.stack), /\/interview\/\[token\]/);
});

test("key material in an error tail is scrubbed by the shared redactor", () => {
  const err = new Error('Provider refused: {"apiKey":"hunter2secret"} / Bearer eyJhbG.payload.sig');
  const out = scrubbedForCapture(err) as Error;
  assert.ok(!out.message.includes("hunter2secret"));
  assert.ok(!out.message.includes("eyJhbG.payload.sig"));
});

test("the error's identity survives the scrub", () => {
  const err = new TypeError("x is not a function");
  const digested = Object.assign(new Error("Server Components render failed"), { digest: "2748104263" });
  const out = scrubbedForCapture(err) as Error;
  assert.equal(out.name, "TypeError", "Sentry groups by error type — the copy must keep it");
  const withDigest = scrubbedForCapture(digested) as Error & { digest?: string };
  assert.equal(withDigest.digest, "2748104263", "the digest is how an operator finds the server-side log line");
});

test("a non-Error throw is scrubbed rather than passed through", () => {
  // Note the shape of the redaction: instrumentation-client's TOKEN_PATH consumes
  // everything up to the next /?# after the prefix, so the placeholder swallows any
  // trailing text on the same segment. Over-scrubbing is the safe direction here.
  assert.equal(scrubbedForCapture("open /status/tok-abcdef?x=1 now"), "open /status/[token]?x=1 now");
  assert.equal(scrubbedForCapture({ toString: () => "at /offer/tok-zzz" }), "at /offer/[token]");
});

test("reportBoundaryError captures the SCRUBBED value, never the raw error", () => {
  // A source guard, because the capture path is behind a DSN gate and a dynamic
  // import of the SDK. It is cheap and it is exactly the regression that matters:
  // someone passing `error` straight to captureException again.
  const src = readFileSync(fileURLToPath(new URL("./sentry-client.ts", import.meta.url)), "utf8")
    // CRLF checkout vs LF worktree — normalise before matching.
    .replace(/\r\n/g, "\n");
  assert.match(src, /const safe = scrubbedForCapture\(error\);/, "the raw error must be scrubbed before capture");
  assert.match(src, /captureException\(safe\)/, "captureException must receive the scrubbed value");
  assert.doesNotMatch(src, /captureException\(error\)/, "the raw error must never reach captureException");
});
