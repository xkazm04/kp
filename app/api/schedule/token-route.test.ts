// Handler-level coverage for the PUBLIC candidate self-scheduling route
// /api/schedule/[token] against an ISOLATED throwaway DB (testing/unit-db.ts
// must stay the first project import). Pins the trust-boundary invariants: the
// public view leaks no internal handles, only a server-offered slot is
// bookable, a confirm advances the linked entry, double-booking collides, and
// a terminal entry can't be booked through a still-valid link.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { GET, POST } from "./[token]/route.ts";
import { actOnPipelineEntry, createPipelineEntry, getPipelineEntry } from "../../_lib/db/pipeline.ts";
import { createScheduleInvite, getScheduleInviteByToken, MAX_RESCHEDULES } from "../../_lib/schedule-store.ts";

after(() => cleanupUnitDb());

const params = (token: string) => ({ params: Promise.resolve({ token }) });
function post(token: string, body: unknown): Promise<Response> {
  return POST(
    new NextRequest(`http://localhost/api/schedule/${token}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    params(token)
  );
}

let seq = 0;
function inviteFixture() {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `sch-c${seq}`,
    candidateLabel: `Schedule Candidate ${seq}`,
    jobId: `sch-job-${seq}`,
    jobTitle: "Schedule Test Role",
    contact: `sch-c${seq}@example.com`,
  });
  const invite = createScheduleInvite({ entryId: entry.id, candidateLabel: entry.candidateLabel, jobTitle: entry.jobTitle });
  return { entry, invite };
}

async function offeredSlots(token: string): Promise<Array<{ value: string; label: string }>> {
  const res = await GET(new NextRequest(`http://localhost/api/schedule/${token}`), params(token));
  assert.equal(res.status, 200);
  return (await res.json()).slots;
}

test("GET: unknown token → 404; a pending invite gets slots and a leak-free public view", async () => {
  const missing = await GET(new NextRequest("http://localhost/api/schedule/st-nope"), params("st-nope"));
  assert.equal(missing.status, 404);

  const { invite } = inviteFixture();
  const res = await GET(new NextRequest(`http://localhost/api/schedule/${invite.token}`), params(invite.token));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.invite.status, "pending");
  assert.ok(Array.isArray(body.slots) && body.slots.length > 0, "a pending invite proposes slots");
  assert.equal(typeof body.interviewTz, "string");
  assert.ok(body.interviewTz.length > 0, "GET names the interview zone the propose form fences against");
  // The public projection must not carry internal handles (idea-69d1e4fd).
  assert.equal("entryId" in body.invite, false, "entryId is an internal IDOR handle — never on the public wire");
  assert.equal("reconcileReason" in body.invite, false);
});

test("POST refuses a slot the server never offered (structural validation, label re-derived server-side)", async () => {
  const { invite } = inviteFixture();
  const res = await post(invite.token, { slotAt: "2020-01-06T10:00:00.000Z", slot: "<script>alert(1)</script>" });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /offered slots/);
  assert.equal(getScheduleInviteByToken(invite.token)!.status, "pending", "nothing may book on a refused slot");
});

test("POST confirm books the offered slot, advances the entry to Interview, and re-confirms idempotently", async () => {
  const { entry, invite } = inviteFixture();
  const slots = await offeredSlots(invite.token);

  const res = await post(invite.token, { slotAt: slots[0].value });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.invite.status, "confirmed");
  assert.equal(body.invite.slotAt, slots[0].value);
  assert.equal(typeof body.confirmationSent, "boolean");
  assert.equal(body.canReschedule, true, "first-confirm POST must carry the reschedule affordance the booked card reads");
  assert.equal(body.rescheduleCapReached, false);
  assert.equal(body.reschedulesRemaining, MAX_RESCHEDULES, "first booking has the full self-reschedule budget");

  // The linked pipeline entry advanced via approve_event with the chosen slot.
  assert.equal(getPipelineEntry(entry.id)!.stage, "Interview");

  // A double-submit without reschedule intent is an idempotent echo, not a re-book.
  const echo = await post(invite.token, { slotAt: slots[0].value });
  assert.equal(echo.status, 200);
  assert.equal((await echo.json()).invite.status, "confirmed");
});

test("GET and POST report remaining self-reschedules after 0, 1 and 3 moves", async () => {
  const { invite } = inviteFixture();
  const slots = await offeredSlots(invite.token);
  assert.ok(slots.length >= 4, "need four distinct offered times for the remaining-budget ladder");

  const first = await post(invite.token, { slotAt: slots[0].value });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).reschedulesRemaining, MAX_RESCHEDULES, "0 moves → full budget");
  const after0 = await GET(new NextRequest(`http://localhost/api/schedule/${invite.token}`), params(invite.token));
  assert.equal((await after0.json()).reschedulesRemaining, MAX_RESCHEDULES);

  const move1 = await post(invite.token, { slotAt: slots[1].value, reschedule: true });
  assert.equal(move1.status, 200);
  assert.equal((await move1.json()).reschedulesRemaining, MAX_RESCHEDULES - 1, "1 move → one spent");
  const after1 = await GET(new NextRequest(`http://localhost/api/schedule/${invite.token}`), params(invite.token));
  assert.equal((await after1.json()).reschedulesRemaining, MAX_RESCHEDULES - 1);

  assert.equal((await post(invite.token, { slotAt: slots[2].value, reschedule: true })).status, 200);
  const last = await post(invite.token, { slotAt: slots[3].value, reschedule: true });
  assert.equal(last.status, 200);
  const lastBody = (await last.json()) as { reschedulesRemaining: number; canReschedule: boolean; rescheduleCapReached: boolean };
  assert.equal(lastBody.reschedulesRemaining, 0, "3 moves → budget spent");
  assert.equal(lastBody.canReschedule, false);
  assert.equal(lastBody.rescheduleCapReached, true);
  const after3 = await GET(new NextRequest(`http://localhost/api/schedule/${invite.token}`), params(invite.token));
  const g = (await after3.json()) as { reschedulesRemaining: number; canReschedule: boolean; rescheduleCapReached: boolean };
  assert.equal(g.reschedulesRemaining, 0);
  assert.equal(g.canReschedule, false);
  assert.equal(g.rescheduleCapReached, true);
});

test("two candidates cannot book the same slot: the loser gets a 409 'just taken'", async () => {
  const a = inviteFixture();
  const b = inviteFixture();
  const slots = await offeredSlots(a.invite.token);
  const target = slots[0].value;

  assert.equal((await post(a.invite.token, { slotAt: target })).status, 200);
  const collision = await post(b.invite.token, { slotAt: target });
  assert.equal(collision.status, 409);
  // The refusal is a CODE now, not an English sentence: the candidate page resolves
  // errors.SCHEDULE_SLOT_TAKEN in the reader's own language (schedule-token-refusals.test.ts).
  assert.equal((await collision.json()).code, "SCHEDULE_SLOT_TAKEN");
  assert.equal(getScheduleInviteByToken(b.invite.token)!.status, "pending", "the loser's invite stays re-bookable");
});

test("a still-valid link cannot book an interview for a closed-out candidate", async () => {
  const { entry, invite } = inviteFixture();
  const slots = await offeredSlots(invite.token);
  actOnPipelineEntry(entry.id, "reject");

  const res = await post(invite.token, { slotAt: slots[1].value });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /no longer available/);
  assert.equal(getScheduleInviteByToken(invite.token)!.status, "pending", "the terminal guard blocks before booking");
});
