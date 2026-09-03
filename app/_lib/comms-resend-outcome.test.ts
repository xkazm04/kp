// The FIVE outcomes of POST /api/comms/[id]/resend, pinned once for both buttons
// (ResendButton, BouncedResend). The fifth — "refused, but the message is already
// being delivered" — is the one they were blind to: wave-11's throttle doors answer
// 409 with `recovered: true` because the send DID happen, and folding that into the
// generic red "couldn't re-send" told a recruiter who double-clicked a bounce that
// nothing went out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resendOutcome, isAdverseResend, RESEND_OUTCOMES } from "./comms-resend-outcome.ts";

test("every outcome the route can produce has a kind, and only the two adverse ones are adverse", () => {
  assert.deepEqual([...RESEND_OUTCOMES], ["refused", "recovered", "deadLettered", "queued", "sent"]);
  assert.equal(isAdverseResend("refused"), true);
  assert.equal(isAdverseResend("deadLettered"), true);
  assert.equal(isAdverseResend("recovered"), false, "a delivered message is never painted as a failure");
  assert.equal(isAdverseResend("queued"), false);
  assert.equal(isAdverseResend("sent"), false);
});

test("refused — a non-2xx with no recovery marker keeps the machine code for the reader's language", () => {
  const out = resendOutcome(false, 422, { error: "Message is missing fields.", code: "COMM_RESEND_INCOMPLETE" });
  assert.deepEqual(out, { kind: "refused", code: "COMM_RESEND_INCOMPLETE" });
  assert.deepEqual(resendOutcome(false, 404, null), { kind: "refused", code: null });
});

test("recovered — 409 + recovered:true is a DELIVERY, not a failure (both throttle doors)", () => {
  assert.deepEqual(resendOutcome(false, 409, { code: "COMM_RESEND_IN_PROGRESS", recovered: true }), {
    kind: "recovered",
    code: "COMM_RESEND_IN_PROGRESS",
  });
  assert.deepEqual(resendOutcome(false, 409, { code: "COMM_ALREADY_RESENT", recovered: true }), {
    kind: "recovered",
    code: "COMM_ALREADY_RESENT",
  });
  // A 409 WITHOUT the marker is still a plain refusal, and `recovered` on any other
  // status is not one of the route's shapes — neither may claim delivery.
  assert.equal(resendOutcome(false, 409, { code: "SOMETHING_ELSE" }).kind, "refused");
  assert.equal(resendOutcome(false, 500, { recovered: true }).kind, "refused");
});

test("dead-lettered again — a 200 whose new row failed or bounced, carrying the reason", () => {
  assert.deepEqual(resendOutcome(true, 200, { entry: { status: "failed", failureDetail: "550 no such user" } }), {
    kind: "deadLettered",
    detail: "550 no such user",
  });
  assert.deepEqual(resendOutcome(true, 200, { entry: { status: "bounced" } }), { kind: "deadLettered", detail: null });
});

test("queued — recorded, but no relay will deliver it; sent — the only outcome that may say Resent", () => {
  assert.deepEqual(resendOutcome(true, 200, { entry: { status: "queued" } }), { kind: "queued" });
  assert.deepEqual(resendOutcome(true, 200, { entry: { status: "sent" } }), { kind: "sent" });
  // An ok response the client cannot read a status out of is treated as sent: the
  // route only answers 200 after a real dispatch.
  assert.deepEqual(resendOutcome(true, 200, null), { kind: "sent" });
});
