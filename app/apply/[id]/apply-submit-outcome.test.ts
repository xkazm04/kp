import { test } from "node:test";
import assert from "node:assert/strict";
import { applyNetworkFailure, applySubmitFailure } from "./apply-submit-outcome.ts";

// The apply door's failure vocabulary, pinned. Every branch here was live UI
// logic with no test: whether a failed submit offers "Try again" or throws the
// candidate back to question one, and which of the two messages (the server's
// code or the generic "something went wrong") they actually read.
//
// The bug these tests exist to keep dead: a 400 that DOES carry a code was
// answered with the generic `submitFailed` on the quick form (retryable status
// decided the message before the code was ever consulted), while the chat
// resolved the code but then declared the step non-retryable — so a candidate
// whose only sin was a long answer was told "something went wrong" and offered
// a restart.

const CODES: Record<string, string> = {
  APPLY_ANSWER_TOO_LONG: "That answer is too long — keep it to {max} characters.",
  APPLY_EMAIL_INVALID: "Please enter a valid email address.",
  TOO_MANY_REQUESTS: "Too many requests.",
};
const has = (code: string) => code in CODES;
const translate = (code: string, values: { max: number | string }) =>
  CODES[code].replace("{max}", String(values.max));

const STEP_IDS = ["name", "email", "experience", "skills"] as const;
const FALLBACK = "Something went wrong.";

const failure = (status: number, body: unknown) =>
  applySubmitFailure({
    status,
    body: body as never,
    fallbackMessage: FALLBACK,
    hasErrorCode: has,
    translateErrorCode: translate,
    fixableStepIds: STEP_IDS,
  });

test("a 400 carrying a known code never renders the generic message", () => {
  const out = failure(400, { error: "One of your answers is too long.", code: "APPLY_ANSWER_TOO_LONG", field: "skills", max: 8192 });
  assert.notEqual(out.message, FALLBACK);
  assert.equal(out.message, "That answer is too long — keep it to 8192 characters.");
});

test("the server's English `error` string is never the message", () => {
  const out = failure(400, { error: "Your email is too long.", code: "APPLY_EMAIL_INVALID" });
  assert.equal(out.message, CODES.APPLY_EMAIL_INVALID);
});

test("a rejected field the script owns is repairable in place, not a restart", () => {
  const out = failure(400, { code: "APPLY_ANSWER_TOO_LONG", field: "skills", max: 10 });
  assert.equal(out.retryable, false, "re-POSTing the same answers cannot help");
  assert.equal(out.fixStepId, "skills", "…but re-asking THAT step can");
});

test("a rejected field the script does not own falls back to a restart", () => {
  assert.equal(failure(400, { code: "APPLY_EMAIL_INVALID", field: "not_a_step" }).fixStepId, null);
  assert.equal(failure(400, { code: "APPLY_EMAIL_INVALID", field: 7 }).fixStepId, null);
  assert.equal(failure(400, { code: "APPLY_EMAIL_INVALID" }).fixStepId, null);
});

test("the code wins over the fallback on a RETRYABLE status too", () => {
  const out = failure(429, { error: "Too many requests.", code: "TOO_MANY_REQUESTS" });
  assert.equal(out.retryable, true);
  assert.equal(out.message, "Too many requests.");
  assert.equal(out.fixStepId, null, "a throttled submit is retried, never re-typed");
});

test("an unknown or absent code falls back to the caller's localized message", () => {
  assert.equal(failure(400, { code: "APPLY_NOT_A_REAL_CODE", error: "raw prose" }).message, FALLBACK);
  assert.equal(failure(500, {}).message, FALLBACK);
  assert.equal(failure(500, null).message, FALLBACK);
});

test("retryable follows the shared status contract (5xx / 408 / 429)", () => {
  for (const s of [500, 502, 408, 429]) assert.equal(failure(s, {}).retryable, true, `status ${s}`);
  for (const s of [400, 404, 410, 413]) assert.equal(failure(s, {}).retryable, false, `status ${s}`);
});

test("a network failure is always retryable and never a fix", () => {
  const out = applyNetworkFailure("Offline.");
  assert.deepEqual(out, { message: "Offline.", retryable: true, fixStepId: null });
});
