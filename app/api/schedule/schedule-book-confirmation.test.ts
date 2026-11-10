// A RECRUITER booking confirms to the candidate (package 12, owner ruling 8).
//
// POST /api/schedule {action:"book"} - the week grid's door, and the one One's consent
// card presses - confirmed the invite, advanced the entry and wrote the calendar event,
// but mailed the candidate nothing: only the candidate's own self-booking
// (/api/schedule/[token]) ever sent a confirmation. The door now sends the same letter
// through the same send gate and answers the truthful claim.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH before any store
// resolves db-path.ts).
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// No relay: the keyless install, where the local outbox is the terminal target.
delete process.env.COMMS_WEBHOOK_URL;

const { GET, POST } = await import("./route.ts");
const { createPipelineEntry } = await import("../../_lib/db/pipeline.ts");
const { ensureDb } = await import("../../_lib/db/core.ts");
const { listOutboxFiltered } = await import("../../_lib/db/devcase.ts");
const { recordCandidateOptOut } = await import("../../_lib/outreach-state-store.ts");
const { proposeSlots, isoToDateSlot } = await import("../../_lib/schedule-slots.ts");

after(() => cleanupUnitDb());

const SLOTS = proposeSlots([], 20);
let seq = 0;
let slotSeq = 0;

function entryFixture(contact: string | null = "auto") {
  seq += 1;
  return createPipelineEntry({
    candidateId: `conf-c${seq}`,
    candidateLabel: `Confirm Candidate ${seq}`,
    jobId: `conf-job-${seq}`,
    jobTitle: "Confirmation Test Role",
    contact: contact === "auto" ? `conf-c${seq}@example.com` : contact,
  }).entry;
}

/** Contact still on the row, consent lapsed, not yet anonymized by the sweep. */
function lapse(entryId: string): void {
  ensureDb()
    .prepare(`UPDATE pipeline_entries SET consent_given_at = ?, consent_expires_at = ? WHERE id = ?`)
    .run("2019-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z", entryId);
}

type BookBody = {
  invite?: { token: string };
  confirmation?: { delivery: string; reason: string | null };
};

async function book(entryId: string): Promise<{ status: number; body: BookBody }> {
  const slot = SLOTS[slotSeq++];
  const res = (await POST(
    new Request("http://localhost/api/schedule", {
      method: "POST",
      body: JSON.stringify({ action: "book", entryId, dateSlot: isoToDateSlot(slot.value) }),
      headers: { "content-type": "application/json", "x-forwarded-for": `10.7.0.${slotSeq}` },
    }) as never
  )) as unknown as Response;
  return { status: res.status, body: (await res.json()) as BookBody };
}

const confirmations = (entryId: string) => listOutboxFiltered({ ref: entryId, kind: "interview_confirmation" });

test("a recruiter booking queues the candidate's confirmation in the local outbox and says so", async () => {
  const e = entryFixture();
  const r = await book(e.id);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.confirmation, { delivery: "queued", reason: null }, "no relay: queued, never a green 'sent'");
  const rows = confirmations(e.id);
  assert.equal(rows.length, 1, "exactly one confirmation letter");
  assert.equal(rows[0].recipient, e.contact);
  assert.equal(rows[0].status, "queued");
  assert.ok((rows[0].body ?? "").includes(`/schedule/${r.body.invite!.token}`), "the letter carries the candidate's way back");
});

test("a candidate whose consent lapsed is booked but NOT mailed: withheld, no outbox row", async () => {
  const e = entryFixture();
  lapse(e.id);
  const r = await book(e.id);
  assert.equal(r.status, 200, "the booking itself stands");
  assert.deepEqual(r.body.confirmation, { delivery: "withheld", reason: "suppressed" });
  assert.equal(confirmations(e.id).length, 0, "nothing was handed to the channel");
});

test("a candidate with no address is withheld as unaddressable, not counted as a failure", async () => {
  const e = entryFixture(null);
  const r = await book(e.id);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.confirmation, { delivery: "withheld", reason: "unaddressable" });
  assert.equal(confirmations(e.id).length, 0, "no failed row to nag about");
});

test("the outreach opt-out halts outreach only: the transactional confirmation still goes", async () => {
  const e = entryFixture();
  recordCandidateOptOut(e.id);
  const r = await book(e.id);
  assert.equal(r.body.confirmation?.delivery, "queued");
  assert.equal(confirmations(e.id).length, 1);
});

test("GET ?confirmTo= states the recipient and the forecast before the press, and writes nothing", async () => {
  const live = entryFixture();
  const get = async (id: string) =>
    (await (
      (await GET(new Request(`http://localhost/api/schedule?confirmTo=${id}`, { headers: { "x-forwarded-for": "10.7.9.1" } }) as never)) as unknown as Response
    ).json()) as { confirmation?: { recipient: string | null; forecast: string; reason: string | null }; code?: string };
  assert.deepEqual((await get(live.id)).confirmation, { recipient: live.contact, forecast: "local", reason: null });
  assert.equal(confirmations(live.id).length, 0, "a forecast sends nothing");

  const lapsed = entryFixture();
  lapse(lapsed.id);
  assert.deepEqual((await get(lapsed.id)).confirmation, { recipient: null, forecast: "withheld", reason: "suppressed" });

  assert.equal((await get("no-such-entry")).code, "PIPELINE_ENTRY_NOT_FOUND");
});
