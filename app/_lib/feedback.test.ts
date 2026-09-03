import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_REFUSALS,
  FEEDBACK_ROUTE_MAX,
  isFeedbackRefusalCode,
  parseFeedbackSubmission,
  replyEmailFrom,
} from "./feedback.ts";

// /perfect wave 17 (shell-nav): the validator used to answer with an English
// SENTENCE ("A message is required."), which the route forwarded as the 400's
// `error`. The dialog resolves `code`, so a Czech recruiter got the generic
// fallback at best and English prose at worst. These pin the code vocabulary —
// they fail on the pre-fix module, where the failure branch carries `reason`.

test("a missing or blank message refuses with FEEDBACK_MESSAGE_REQUIRED", () => {
  for (const body of [{}, null, undefined, { message: "" }, { message: "   \n\t " }, { message: 12 }]) {
    const r = parseFeedbackSubmission(body);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.code === "FEEDBACK_MESSAGE_REQUIRED", `expected the required code for ${JSON.stringify(body)}`);
  }
});

test("an over-cap message refuses with FEEDBACK_MESSAGE_TOO_LONG, and the cap itself passes", () => {
  const over = parseFeedbackSubmission({ message: "x".repeat(FEEDBACK_MESSAGE_MAX + 1) });
  assert.ok(!over.ok && over.code === "FEEDBACK_MESSAGE_TOO_LONG");
  // Exactly at the cap is accepted — the ceiling is inclusive, so the client's
  // maxLength and the server's refusal agree on the same last character.
  const atCap = parseFeedbackSubmission({ message: "x".repeat(FEEDBACK_MESSAGE_MAX) });
  assert.ok(atCap.ok && atCap.value.message.length === FEEDBACK_MESSAGE_MAX);
  // Trimming happens BEFORE the measurement: padding is not content.
  const padded = parseFeedbackSubmission({ message: `  ${"x".repeat(FEEDBACK_MESSAGE_MAX)}  ` });
  assert.ok(padded.ok, "surrounding whitespace must not push a legal message over the cap");
});

test("no refusal ever puts prose on the wire", () => {
  const r = parseFeedbackSubmission({});
  assert.ok(!r.ok);
  assert.deepEqual(Object.keys(r).sort(), ["code", "ok"], "a refusal carries ok + code and nothing else");
  assert.ok(isFeedbackRefusalCode(!r.ok ? r.code : ""));
});

test("the refusal vocabulary is closed and guarded", () => {
  assert.deepEqual([...FEEDBACK_REFUSALS], ["FEEDBACK_MESSAGE_REQUIRED", "FEEDBACK_MESSAGE_TOO_LONG"]);
  assert.equal(isFeedbackRefusalCode("FEEDBACK_MESSAGE_REQUIRED"), true);
  assert.equal(isFeedbackRefusalCode("FEEDBACK_INVALID"), false);
  assert.equal(isFeedbackRefusalCode(null), false);
});

test("the route rides along only when it is a same-app path", () => {
  const kept = parseFeedbackSubmission({ message: "ok", route: "/?tab=pipeline" });
  assert.ok(kept.ok && kept.value.route === "/?tab=pipeline");
  for (const route of ["//evil.example", "https://evil.example/phish", "tab=pipeline", "", "  ", 7, null]) {
    const r = parseFeedbackSubmission({ message: "ok", route });
    assert.ok(r.ok && r.value.route === null, `route ${JSON.stringify(route)} must be dropped, not stored`);
  }
  // Over-long telemetry is dropped, never a reason to refuse the whole report.
  const long = parseFeedbackSubmission({ message: "ok", route: `/${"a".repeat(FEEDBACK_ROUTE_MAX)}` });
  assert.ok(long.ok && long.value.route === null);
});

test("a client-supplied email is never carried, and the server value is normalised", () => {
  const spoofed = parseFeedbackSubmission({ message: "ok", email: "someone.else@corp.example" });
  assert.ok(spoofed.ok && !("email" in spoofed.value));
  assert.equal(replyEmailFrom("a@b.cz"), "a@b.cz");
  assert.equal(replyEmailFrom("  a@b.cz  "), "a@b.cz");
  assert.equal(replyEmailFrom("not-an-email"), null);
  assert.equal(replyEmailFrom(`${"x".repeat(250)}@b.cz`), null);
});
