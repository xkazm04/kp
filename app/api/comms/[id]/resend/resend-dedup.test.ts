import { readFileSync } from "node:fs";
// The recovery door's dedup must cover the REFLESS dead letter too.
//
// The check was written as `if (original.ref) { …look for a newer delivery… }`, so a
// message with no ref — a KO decline, any comm whose subject was never a pipeline
// entry — fell past it entirely. The only remaining guard was an in-process Set held
// for the duration of ONE request, which means a refless dead letter could be
// re-dispatched once per click, for as long as anyone clicked: the same rejection
// delivered to the same candidate again and again, each one a real send.
//
// The fix gives a refless message a durable correlation key — its own outbox id — so
// the recovery row points at the message it recovers and the SAME query answers both
// shapes. These tests drive the REAL handler on a throwaway SQLite file; with no relay
// configured every send records as `queued` (the terminal local-outbox state), which
// is still a DELIVERY for dedup purposes and is exactly the keyless path a self-hosted
// install runs on.
// Import the REAL native better-sqlite3 first (never a shim).
import "better-sqlite3";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
// IMPORT ORDER IS LOAD-BEARING: unit-db sets KP_DB_PATH to a throwaway file at
// module-eval time and must run BEFORE any module that transitively touches db-path.
import { cleanupUnitDb } from "../../../../_lib/testing/unit-db.ts";
import { getDevCase, listOutboxFiltered, recordOutbox } from "../../../../_lib/db/devcase.ts";
import { createPipelineEntry } from "../../../../_lib/db/pipeline.ts";
import { ensureDb } from "../../../../_lib/db/core.ts";

register(new URL("../../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

type ResendBody = { ok?: boolean; code?: string; recovered?: boolean; entry?: { id?: string; ref?: string | null } };

async function resend(id: string): Promise<{ status: number; body: ResendBody }> {
  const { POST } = await import("./route.ts");
  const request = new Request(`http://localhost/api/comms/${id}/resend`, { method: "POST" });
  const res = await POST(request, { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as ResendBody };
}

/** A dead letter with NO ref — the shape the dedup used to skip. */
function deadLetter(ref: string | null) {
  return recordOutbox({
    recipient: "candidate@example.com",
    subject: "About your application",
    body: "…",
    kind: "rejection",
    channel: "email",
    status: "failed",
    ref,
    failureDetail: "http 503",
  });
}

before(() => {
  getDevCase("__init__"); // force the full ensureDb() init
});
after(() => cleanupUnitDb());

test("a REFLESS dead letter re-sends ONCE, then is refused with a code", async () => {
  const original = deadLetter(null);

  const first = await resend(original.id);
  assert.equal(first.status, 200, "the first recovery is the whole point of the door");
  assert.equal(first.body.ok, true);
  // The recovery row carries the original's id as its correlation key — that is what
  // makes the second call findable at all.
  assert.equal(first.body.entry?.ref, original.id);

  const second = await resend(original.id);
  // NON-VACUITY: pre-fix this answered 200 and DELIVERED the rejection a second time,
  // so both assertions below failed.
  assert.equal(second.status, 409, "a second delivery of the same rejection is a refusal");
  assert.equal(second.body.code, "COMM_ALREADY_RESENT", "the reader localizes the refusal off the code");
  assert.equal(second.body.recovered, true);

  // And the ledger proves it: exactly ONE recovery was ever dispatched.
  const recoveries = listOutboxFiltered({ ref: original.id, kind: "rejection" }).filter((m) => m.id !== original.id);
  assert.equal(recoveries.length, 1, "the second click must not have written a second send");
});

test("a REF'D dead letter keeps its existing semantics — dedup on the entry's own key", async () => {
  const original = deadLetter("ent_123");
  const first = await resend(original.id);
  assert.equal(first.status, 200);
  // The ref is UNCHANGED for a message that already had one: the recovery must land
  // beside the entry it concerns, not beside the outbox row it was copied from,
  // or the candidate's history loses it.
  assert.equal(first.body.entry?.ref, "ent_123");

  const second = await resend(original.id);
  assert.equal(second.status, 409);
  assert.equal(second.body.code, "COMM_ALREADY_RESENT");
});

test("an unknown outbox id is a 404, and a message missing fields a 422 — both ahead of any send", async () => {
  const missing = await resend("out_does_not_exist");
  assert.equal(missing.status, 404);

  const incomplete = recordOutbox({
    recipient: "",
    subject: "",
    body: "",
    kind: "rejection",
    channel: "email",
    status: "failed",
    ref: null,
  });
  const res = await resend(incomplete.id);
  assert.equal(res.status, 422, "a message that cannot be reconstructed is refused, never half-sent");
  assert.equal(
    listOutboxFiltered({ ref: incomplete.id }).length,
    0,
    "and nothing was written for it",
  );
});

test("a (SIM) outbox row is refused before the relay is reached", () => {
  const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  const guard = src.indexOf("SIM_COMMS_CHANNEL) return jsonRefusal(\"COMM_SIMULATION_ROW\"");
  const relay = src.indexOf("await sendComm(");
  assert.ok(guard >= 0, "the simulation guard exists");
  assert.ok(relay >= 0 && guard < relay, "the guard precedes the relay call");
});

// The recovery door is one of the three that call sendComm DIRECTLY, bypassing the
// dispatcher that used to hold the compliance gate. The gate now lives at the channel
// (comms.ts commsSendSuppression), and its refusal must reach the recruiter as a
// refusal — the catch answered it through safeJsonError, painting a correct decision
// as a 500 that the button invites you to retry.
test("resending to a candidate who may not be contacted is a 409 refusal, not a 500", async () => {
  const { entry } = createPipelineEntry({
    candidateId: "cand-resend-suppressed",
    candidateLabel: "Jana",
    jobId: "job-resend-suppressed",
    jobTitle: "Backend Engineer",
  });
  const original = deadLetter(entry.id);
  // Consent EXPIRED rather than anonymized: erasure also scrubs this row's recipient
  // and body, so the route's own missing-fields guard (422) would answer first and the
  // send gate would never be reached. Expiry leaves the message intact, which is
  // exactly the case where the gate is the only thing standing in the way.
  ensureDb()
    .prepare(`UPDATE pipeline_entries SET consent_given_at = ?, consent_expires_at = ? WHERE id = ?`)
    .run("2024-01-01T00:00:00Z", "2024-06-01T00:00:00Z", entry.id);

  const res = await resend(original.id);
  assert.equal(res.status, 409, "the door works; the candidate's state forbids the send");
  assert.equal(res.body.code, "COMMS_SUPPRESSED", "the reader localizes the refusal off the code");
  assert.equal(res.body.ok, undefined);
  // Nothing was dispatched: the ledger still holds only the dead letter itself.
  const rows = listOutboxFiltered({ ref: entry.id, kind: "rejection" });
  assert.deepEqual(rows.map((m) => m.id), [original.id], "no recovery row for a send that must not happen");
});
