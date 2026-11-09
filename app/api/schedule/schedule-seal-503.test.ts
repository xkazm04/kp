// The recruiter's cancel, no-show and decline-proposals answer a coded 503 when their
// decision record cannot be sealed, and the invite stays exactly as it was (council
// robustness-1). Each of the three seals facts known BEFORE the write, so the seal runs
// first and the retry is the same click, not a 409 with the record lost. Seal failure is
// the REAL one: the chain is keyed, then the key is unset, so every seal throws.
//
// The book and accept_proposal branches are deliberately NOT here: their seal records
// whether the entry advanced, which only exists after the booking commits.
//
// Its own file (own process, own throwaway DB): it breaks the default chain.
// unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const { POST } = await import("./route.ts");
const { createPipelineEntry } = await import("../../_lib/db/pipeline.ts");
const { confirmScheduleInvite, createScheduleInvite, getScheduleInviteByToken, setScheduleInviteProposals } = await import(
  "../../_lib/schedule-store.ts"
);
const { proposeSlots } = await import("../../_lib/schedule-slots.ts");
const { listDecisionRecords, sealDecisionRecord } = await import("../../_lib/decision-record-store.ts");

const KEY_ENV = "KP_DECISION_HMAC_KEY";
const KEY = "schedule-seal-test-key";
const priorKey = process.env[KEY_ENV];
after(() => {
  if (priorKey === undefined) delete process.env[KEY_ENV];
  else process.env[KEY_ENV] = priorKey;
  cleanupUnitDb();
});

process.env[KEY_ENV] = KEY;
sealDecisionRecord({
  kind: "advanced",
  actor: "human:recruiter",
  policyVersion: "manual",
  candidateRef: "ss-keying",
  rationale: "keys the chain for this test",
  reasonCode: "accept",
  inputs: {},
});

const SLOTS = proposeSlots([], 12);
let seq = 0;

function pending(): { token: string; entryId: string } {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `ss-c${seq}`,
    candidateLabel: `Schedule Seal ${seq}`,
    jobId: `ss-job-${seq}`,
    jobTitle: "Schedule Seal Test",
  });
  const invite = createScheduleInvite({ entryId: entry.id, candidateLabel: entry.candidateLabel, jobTitle: "Schedule Seal Test", durationMin: 45 });
  return { token: invite.token, entryId: entry.id };
}

function confirmed(): { token: string; entryId: string } {
  const fixture = pending();
  const slot = SLOTS[seq % SLOTS.length]!;
  const booked = confirmScheduleInvite(fixture.token, slot.label, slot.value);
  assert.ok(booked.ok, "the fixture books its slot");
  return fixture;
}

function proposed(): { token: string; entryId: string } {
  const fixture = pending();
  const slot = SLOTS[seq % SLOTS.length]!;
  assert.ok(setScheduleInviteProposals(fixture.token, [{ label: slot.label, value: slot.value }]), "the fixture stores a proposal");
  return fixture;
}

const act = (action: string, token: string): Promise<Response> => {
  seq += 1;
  return POST(
    new Request("http://localhost/api/schedule", {
      method: "POST",
      body: JSON.stringify({ action, token }),
      headers: { "content-type": "application/json", "x-forwarded-for": `10.2.0.${(seq % 250) + 1}` },
    }) as never
  ) as unknown as Promise<Response>;
};

const sealedAs = (entryId: string, kind: string) => listDecisionRecords({ candidateRef: entryId }).filter((r) => r.kind === kind).length;

async function refusedWithNothingChanged(action: string, kind: string, fixture: { token: string; entryId: string }): Promise<void> {
  const before = getScheduleInviteByToken(fixture.token);
  delete process.env[KEY_ENV];
  try {
    const refused = await act(action, fixture.token);
    assert.equal(refused.status, 503, action);
    assert.equal(((await refused.json()) as { code?: string }).code, "PIPELINE_DECISION_NOT_SEALED", action);
  } finally {
    process.env[KEY_ENV] = KEY;
  }
  assert.deepEqual(getScheduleInviteByToken(fixture.token), before, `${action}: the invite is untouched`);
  assert.equal(sealedAs(fixture.entryId, kind), 0, action);

  const retried = await act(action, fixture.token);
  assert.equal(retried.status, 200, `${action}: nothing moved, so the same click still works`);
  assert.equal(sealedAs(fixture.entryId, kind), 1, `${action}: exactly one record`);
}

test("cancel: a failed seal answers the coded 503 and keeps the booking; the retry cancels once", async () => {
  const fixture = confirmed();
  await refusedWithNothingChanged("cancel", "interview_cancelled", fixture);
  assert.equal(getScheduleInviteByToken(fixture.token)!.status, "pending");
});

test("no_show: a failed seal answers the coded 503 and keeps the booking; the retry marks once", async () => {
  const fixture = confirmed();
  await refusedWithNothingChanged("no_show", "interview_no_show", fixture);
  assert.equal(getScheduleInviteByToken(fixture.token)!.status, "no_show");
});

test("decline_proposals: a failed seal answers the coded 503 and keeps the proposals; the retry declines once", async () => {
  const fixture = proposed();
  await refusedWithNothingChanged("decline_proposals", "interview_proposal_declined", fixture);
  assert.equal(getScheduleInviteByToken(fixture.token)!.proposalStatus, "declined");
});

test("a refusal the store would have made seals nothing", async () => {
  const notBooked = pending();
  const cancel = await act("cancel", notBooked.token);
  assert.equal(((await cancel.json()) as { code?: string }).code, "SCHEDULE_CANCEL_NOT_CONFIRMED");
  assert.equal(sealedAs(notBooked.entryId, "interview_cancelled"), 0);

  const noShow = await act("no_show", notBooked.token);
  assert.equal(((await noShow.json()) as { code?: string }).code, "SCHEDULE_NO_SHOW_NOT_CONFIRMED");
  assert.equal(sealedAs(notBooked.entryId, "interview_no_show"), 0);

  const decline = await act("decline_proposals", notBooked.token);
  assert.equal(((await decline.json()) as { code?: string }).code, "SCHEDULE_NO_PROPOSALS");
  assert.equal(sealedAs(notBooked.entryId, "interview_proposal_declined"), 0);
});

test("an invite with no linked entry owes no record: cancel still works with the seal broken", async () => {
  // The column is nullable and the route branches on it; the store's input type is narrower.
  const invite = createScheduleInvite({ entryId: null as unknown as string, candidateLabel: "Unlinked", jobTitle: "Schedule Seal Test", durationMin: 45 });
  const slot = SLOTS[(seq + 1) % SLOTS.length]!;
  assert.ok(confirmScheduleInvite(invite.token, slot.label, slot.value).ok);
  delete process.env[KEY_ENV];
  try {
    assert.equal((await act("cancel", invite.token)).status, 200);
  } finally {
    process.env[KEY_ENV] = KEY;
  }
});
