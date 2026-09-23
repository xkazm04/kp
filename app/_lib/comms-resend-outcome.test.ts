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

// --- which recovery DOOR a letter offers (pipeline-candidate-drawer/B) --------------
//
// The door choice used to be derived three times: the Comms Center's detail modal read
// the raw `bounced` / `status === "failed" && !recovered` bits, the dev-case outbox read
// `verdict`, and the candidate modal offered no door at all. One predicate now answers
// it for every surface, beside the outcome fold both buttons already share.
import * as door from "./comms-resend-outcome.ts";

test("a dead-lettered send offers the one-click retry", () => {
  assert.equal(door.resendDoorOf({ verdict: "failed", channel: "email" }), "retry");
});

test("a bounce offers the corrected-address door — the same address would bounce again", () => {
  assert.equal(door.resendDoorOf({ verdict: "bounced", channel: "email" }), "correctAddress");
});

test("recovered, sent and queued letters offer no door (a recovered row drew a 409 that read as a fresh failure)", () => {
  for (const verdict of ["recovered", "sent", "queued", "orphaned"]) {
    assert.equal(door.resendDoorOf({ verdict, channel: "email" }), null, verdict);
  }
});

test("a simulation row never offers a door — the route refuses it with COMM_SIMULATION_ROW", () => {
  assert.equal(door.SIM_COMMS_CHANNEL, "simulation");
  assert.equal(door.resendDoorOf({ verdict: "failed", channel: door.SIM_COMMS_CHANNEL }), null);
  // The row the simulation actually writes: `queued` on the simulation channel.
  assert.equal(door.resendDoorOf({ verdict: "queued", channel: door.SIM_COMMS_CHANNEL }), null);
});

test("a REFUSED row never offers a door — it has no recipient, so the route 422s before any correction", () => {
  // comms-dispatch.ts records a refusal (no inbox, agent population) as a `failed` row
  // on this channel with recipient "". It is a decision, not a dead letter: a retry
  // could only be refused again, and it does not need the recruiter.
  assert.equal(door.REFUSED_COMMS_CHANNEL, "refused");
  assert.equal(door.resendDoorOf({ verdict: "failed", channel: door.REFUSED_COMMS_CHANNEL }), null);
});

test("an anonymized or consent-expired candidate is offered no door — the send gate would refuse it", () => {
  assert.equal(door.resendDoorOf({ verdict: "failed", channel: "email" }, "anonymized"), null);
  assert.equal(door.resendDoorOf({ verdict: "bounced", channel: "email" }, "expired"), null);
  // Every contactable state keeps the door.
  for (const status of ["active", "expiring", "none", null, undefined]) {
    assert.equal(door.resendDoorOf({ verdict: "failed", channel: "email" }, status), "retry", String(status));
  }
});

test("lettersNeedingYou counts exactly the letters that offer a door", () => {
  const rows = [
    { verdict: "failed", channel: "email" },
    { verdict: "bounced", channel: "email" },
    { verdict: "recovered", channel: "email" },
    { verdict: "sent", channel: "email" },
    { verdict: "queued", channel: "email" },
    { verdict: "failed", channel: "simulation" },
    { verdict: "failed", channel: "refused" },
  ];
  assert.equal(door.lettersNeedingYou(rows), 2);
  assert.equal(door.lettersNeedingYou(rows, "anonymized"), 0, "an erased candidate needs no letter chased");
  assert.equal(door.lettersNeedingYou([]), 0);
});
