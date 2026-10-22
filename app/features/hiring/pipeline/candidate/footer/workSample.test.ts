// "Send work sample" (CX S43): every answer the route can give reads as what happened,
// never more — a queued letter is not "sent", a refusal says nothing went out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assignmentsForJobHref, workSampleView } from "./workSample.ts";

test("only a relayed send reads as sent; queued and failed keep the link to copy", () => {
  const url = "/devcase/apply/tok";
  assert.deepEqual(workSampleView({ state: "invited", url, delivery: "sent" }).line, "sent");
  const queued = workSampleView({ state: "invited", url, delivery: "queued" });
  assert.equal(queued.line, "queued");
  assert.equal(queued.tone, "amber");
  assert.equal(queued.url, url, "a queued letter hands the person the link to send themselves");
  const failed = workSampleView({ state: "invited", url, delivery: "failed" });
  assert.equal(failed.line, "failed");
  assert.equal(failed.tone, "critical");
  assert.equal(failed.url, url);
});

test("a second click shows the same link instead of a second letter", () => {
  const v = workSampleView({ state: "already_invited", url: "/devcase/apply/tok" });
  assert.equal(v.line, "alreadyInvited");
  assert.equal(v.url, "/devcase/apply/tok");
});

test("no assignment for the role: say so and point at creating one for THIS role", () => {
  const v = workSampleView({ state: "no_case", jobId: "jd-sales lead" });
  assert.equal(v.line, "noCase");
  assert.equal(v.url, null);
  assert.equal(v.assignmentsAction, "create");
  assert.equal(v.assignmentsHref, "/?tab=assignments&job=jd-sales%20lead");
  assert.equal(assignmentsForJobHref(null), "/?tab=assignments");
});

test("refusals send nothing and name the next step", () => {
  assert.equal(workSampleView({ state: "refused", reason: "unaddressable", jobId: "j" }).line, "unaddressable");
  assert.equal(workSampleView({ state: "refused", reason: "suppressed", jobId: "j" }).line, "suppressed");
  const stopped = workSampleView({ state: "refused", reason: "intake_stopped", jobId: "j" });
  assert.equal(stopped.line, "intakeStopped");
  assert.equal(stopped.assignmentsAction, "reopen");
  assert.equal(workSampleView({ state: "refused", reason: "no_case", jobId: "j" }).line, "notSent");
  assert.equal(workSampleView({ state: "agent" }).line, "agent");
  for (const reason of ["unaddressable", "suppressed", "intake_stopped", "error"]) {
    assert.equal(workSampleView({ state: "refused", reason, jobId: "j" }).url, null, `${reason}: no link is offered`);
  }
});
