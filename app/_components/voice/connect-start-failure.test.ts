// Locks /connect refusal mapping so a 409 body reaches the candidate banner
// as errors.<CODE>, not interview.voice.errStartCall.
//
// Runner: node --test with type stripping (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ErrorMessageResolver } from "@/app/_lib/use-error-message.ts";
import { connectStartFailureMessage } from "./connect-start-failure.ts";

const CATALOG: Record<string, string> = {
  INTERVIEW_ALREADY_LIVE: "already-live",
  INTERVIEW_LINK_EXPIRED: "expired",
  INTERVIEW_LINK_INACTIVE: "inactive",
  INTERVIEW_ALREADY_COMPLETED: "already-completed",
};
const FALLBACK = "errStartCall";

const resolve: ErrorMessageResolver = (payload, fallback) => {
  const code = payload?.code;
  if (code && CATALOG[code]) return CATALOG[code];
  return fallback;
};

test("a 409 INTERVIEW_ALREADY_LIVE with retryAfterMin paints the coded string plus retry-after", () => {
  const message = connectStartFailureMessage(
    { code: "INTERVIEW_ALREADY_LIVE", retryAfterMin: 30 },
    resolve,
    FALLBACK,
    (minutes) => `retry-${minutes}`,
  );
  assert.equal(message, "already-live retry-30");
  assert.ok(!message.includes(FALLBACK));
});

test("the four connect 409/403 codes render errors.<CODE> rather than errStartCall", () => {
  const cases = [
    { code: "INTERVIEW_ALREADY_LIVE", want: "already-live" },
    { code: "INTERVIEW_LINK_EXPIRED", want: "expired" },
    { code: "INTERVIEW_LINK_INACTIVE", want: "inactive" },
    { code: "INTERVIEW_ALREADY_COMPLETED", want: "already-completed" },
  ];
  for (const { code, want } of cases) {
    const message = connectStartFailureMessage({ code }, resolve, FALLBACK, () => "retry");
    assert.equal(message, want, code);
    assert.ok(!message.includes(FALLBACK), code);
  }
});

test("an unknown code falls through to errStartCall", () => {
  assert.equal(
    connectStartFailureMessage({ code: "NOT_IN_CATALOG" }, resolve, FALLBACK, () => "retry"),
    FALLBACK,
  );
});
