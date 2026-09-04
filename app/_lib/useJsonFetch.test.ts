import test from "node:test";
import assert from "node:assert/strict";
import { jsonFetchFailure } from "./useJsonFetch.ts";
import { resolveErrorMessage } from "./use-error-message.ts";

// The hook's failure half, pinned as a pure function so the precedence rule is
// testable without a DOM: a failed read is described by its machine `code` and
// HTTP `status`, and the message the user sees is resolved from the code —
// NEVER from the server's English `error` prose (use-error-message.ts).

const CATALOG: Record<string, string> = { JOB_WINNABILITY_FAILED: "Nepodařilo se ohodnotit roli." };
const say = (code: string | null, fallback: string) =>
  resolveErrorMessage(
    { code },
    fallback,
    (c) => c in CATALOG,
    (c) => CATALOG[c]
  );

test("a 2xx with a parsed object body is not a failure", () => {
  assert.equal(jsonFetchFailure(true, 200, { poolSize: 3 }), null);
});

test("a 2xx whose body is unparseable is a failure (no permanent skeleton)", () => {
  assert.deepEqual(jsonFetchFailure(true, 200, null), { code: null, status: 200 });
});

test("a 2xx body carrying { error } is a failure and keeps its code", () => {
  assert.deepEqual(jsonFetchFailure(true, 200, { error: "boom", code: "JOB_WINNABILITY_FAILED" }), {
    code: "JOB_WINNABILITY_FAILED",
    status: 200,
  });
});

test("a non-OK response keeps both the code and the status", () => {
  assert.deepEqual(jsonFetchFailure(false, 429, { error: "Too many requests.", code: "TOO_MANY_REQUESTS" }), {
    code: "TOO_MANY_REQUESTS",
    status: 429,
  });
});

test("a non-OK response with no code still reports its status", () => {
  assert.deepEqual(jsonFetchFailure(false, 500, null), { code: null, status: 500 });
});

test("precedence: a known code wins over the caller's label, and the server prose never shows", () => {
  const f = jsonFetchFailure(false, 500, { error: "sqlite: disk I/O error", code: "JOB_WINNABILITY_FAILED" })!;
  assert.equal(say(f.code, "Couldn't grade this role."), CATALOG.JOB_WINNABILITY_FAILED);
});

test("precedence: an unknown code falls back to the caller's localized label, not the prose", () => {
  const f = jsonFetchFailure(false, 500, { error: "sqlite: disk I/O error", code: "NOT_IN_CATALOG" })!;
  assert.equal(say(f.code, "Couldn't grade this role."), "Couldn't grade this role.");
});
