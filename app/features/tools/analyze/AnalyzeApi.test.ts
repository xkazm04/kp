// Pins the Analyze seam's two contracts that had none.
//
// (1) THE ERROR PRECEDENCE. A failed run reaches the surface as an
//     AnalyzeErrorInfo carrying up to three things that could be shown: a route's
//     machine `apiCode`, the engine/server's English `serverText`, and this
//     module's own stable `code`. Only one order is honest — a code localizes and
//     English does not — so `resolveAnalyzeErrorText` is the single place that
//     decides, and these tests lock it: code > server text > generic.
//
// (2) THE POLL CONTRACT (added with the backoff/visibility work). watchAnalysis
//     is the longest-lived client loop in the app and had zero tests: the terminal
//     404, the ten-soft-failure ceiling, forward-only phases, abort, and the
//     hidden-tab pause all lived only in prose.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit -- app/features/tools/analyze/AnalyzeApi.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { AnalyzeClientError, resolveAnalyzeErrorText, type AnalyzeMessageResolvers } from "./AnalyzeApi.ts";

// A resolver set whose every channel is distinguishable in the assertion, so a
// wrong precedence shows up as the WRONG CHANNEL rather than as a wrong string.
function resolvers(over: Partial<AnalyzeMessageResolvers> = {}): AnalyzeMessageResolvers {
  return {
    appCode: (code) => (code === "UPLOAD_TOO_LARGE" ? `app:${code}` : null),
    githubCode: (code) => (code === "RATE_LIMITED" ? `gh:${code}` : null),
    analyzeCode: (code) => (code === "errIncomplete" ? `analyze:${code}` : null),
    retryAfter: (seconds) => `retry:${seconds}`,
    generic: "generic",
    ...over,
  };
}

test("a route's machine code wins over the server's English", () => {
  const text = resolveAnalyzeErrorText(
    { code: "errFailed", apiCode: "UPLOAD_TOO_LARGE", serverText: "The profile exceeds the 8 MB upload limit." },
    resolvers()
  );
  assert.equal(text, "app:UPLOAD_TOO_LARGE");
});

test("a GitHub-namespace code resolves when the app-wide catalog does not know it", () => {
  const text = resolveAnalyzeErrorText({ code: "errGithubFailed", apiCode: "RATE_LIMITED" }, resolvers());
  assert.equal(text, "gh:RATE_LIMITED");
});

test("an unknown api code falls through to the server text rather than swallowing it", () => {
  // The old resolver returned the generic line the moment an apiCode was present,
  // even one no catalog knew — throwing away the only information there was.
  const text = resolveAnalyzeErrorText(
    { code: "errFailed", apiCode: "SOMETHING_NEW", serverText: "engine said no" },
    resolvers()
  );
  assert.equal(text, "engine said no");
});

test("server text wins over the generic line when there is no code", () => {
  const text = resolveAnalyzeErrorText({ code: "errFailed", serverText: "python traceback tail" }, resolvers());
  assert.equal(text, "python traceback tail");
});

test("the stable analyze code is the floor, and an unknown one degrades to generic", () => {
  assert.equal(resolveAnalyzeErrorText({ code: "errIncomplete" }, resolvers()), "analyze:errIncomplete");
  assert.equal(resolveAnalyzeErrorText({ code: "errFailed" }, resolvers()), "generic");
  assert.equal(resolveAnalyzeErrorText({}, resolvers()), "generic");
});

test("a throttle with a Retry-After beats every other channel", () => {
  const text = resolveAnalyzeErrorText(
    { code: "errFailed", apiCode: "TOO_MANY_REQUESTS", retryAfterSeconds: 42, serverText: "Too many requests" },
    resolvers()
  );
  assert.equal(text, "retry:42");
});

test("a throttle WITHOUT a Retry-After still resolves its code", () => {
  const text = resolveAnalyzeErrorText(
    { code: "errFailed", apiCode: "TOO_MANY_REQUESTS" },
    resolvers({ appCode: (code) => `app:${code}` })
  );
  assert.equal(text, "app:TOO_MANY_REQUESTS");
});

test("AnalyzeClientError carries status, code and retry-after alongside the server text", () => {
  const err = new AnalyzeClientError("errFailed", "  boom  ", "UPLOAD_TOO_LARGE", { status: 413, retryAfterSeconds: 5 });
  assert.equal(err.code, "errFailed");
  assert.equal(err.serverText, "boom");
  assert.equal(err.apiCode, "UPLOAD_TOO_LARGE");
  assert.equal(err.status, 413);
  assert.equal(err.retryAfterSeconds, 5);
});

test("AnalyzeClientError ignores blank/non-string server text and codes", () => {
  const err = new AnalyzeClientError("errFailed", "   ", 42);
  assert.equal(err.serverText, undefined);
  assert.equal(err.apiCode, undefined);
  assert.equal(err.message, "errFailed");
});
