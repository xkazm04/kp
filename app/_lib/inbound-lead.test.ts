// The receiver core's three UNTESTED promises. `inbound-lead.ts` carries the whole
// contract for three doors (live POST, the clock's pull pass, the edge drain), and its
// idempotency window was pinned by nothing at all — grep `ingestInboundLeadByToken|
// claimedIdemKey` in the suite found no test before this file.
//
// What is proven here, and why each one costs something real when it breaks:
//
//   1. THE CLAIM — a provider retry of the same delivery must not file a second lead,
//      pile up another `re_applied`, or re-dispatch the acknowledgement. The claim is
//      taken only AFTER the payload validates, so an unmappable payload keeps answering
//      an actionable 422 instead of a misleading "duplicate_ignored".
//   2. THE RELEASE — a 5xx is the one outcome worth replaying, so a failed run must give
//      the key back. Held, the provider's retry would be swallowed as a duplicate of
//      work that never completed and the lead would be lost silently.
//   3. THE DUPLICATE REPLY-HALT — an inbound message from someone we already mailed is a
//      REPLY, and the sequence stops. Guarded on `duplicate` and, inside the store, on
//      having actually sent outreach first: a brand-new lead cannot be answering
//      anything, and a repeat from someone we never contacted is a re-application.
//
// unit-db is the FIRST project import (throwaway KP_DB_PATH) — load-bearing order.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { ensureDb } from "./db/core.ts";
import type { JobRecord } from "./db/core.ts";
import { createChannelWebhook } from "./db/channels.ts";
import { getJob } from "./db/jobs.ts";
import { listPipelineEventsForEntry } from "./db/pipeline.ts";
import { ingestInboundLeadJson } from "./inbound-lead.ts";
import { outreachStateFor, recordOutreachSend } from "./outreach-state-store.ts";

after(() => cleanupUnitDb());

const WS = "ws-inbound-lead";

function seedJob(id: string): JobRecord {
  const db = ensureDb();
  db.prepare(
    `INSERT INTO jobs (id, title, payload_json, status, workspace_id, created_at) VALUES (?, ?, ?, NULL, ?, ?)`
  ).run(id, "Backend Engineer", JSON.stringify({ id, title: "Backend Engineer" }), WS, new Date().toISOString());
  const job = getJob(id);
  assert.ok(job, "guard the guard: the seeded role resolves");
  return job;
}

function receiver(jobId: string) {
  return createChannelWebhook({ channel: "boards", jobId, lang: "en" }, WS);
}

const call = (webhook: ReturnType<typeof receiver>, job: JobRecord, rawBody: string, defer?: (t: () => Promise<void>) => void) =>
  ingestInboundLeadJson({ webhook, job, rawBody, payload: JSON.parse(rawBody), origin: "http://localhost:3000", defer });

test("a byte-identical retry is claimed once and answered duplicate_ignored", async () => {
  const job = seedJob("job-inbound-claim");
  const hook = receiver(job.id);
  const body = JSON.stringify({ name: "Ada Lovelace", email: "ada.claim@example.com" });

  const first = await call(hook, job, body);
  assert.equal(first.status, 200);
  assert.equal(first.body.result, "accepted");
  assert.equal(first.body.duplicate, false);

  const retry = await call(hook, job, body);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.result, "duplicate_ignored", "the retry never reaches intake at all");
  assert.equal(retry.body.duplicate, true);

  // Exactly one lead was filed, and the retry wrote no second event onto its timeline.
  const entryId = first.body.entryId as string;
  assert.ok(entryId);
  assert.equal(
    listPipelineEventsForEntry(entryId, 50, WS).filter((e) => e.kind === "re_applied").length,
    0,
    "a swallowed retry must not look like a repeat application"
  );
});

test("an unmappable payload is refused BEFORE the claim, so a retry gets the same 422", async () => {
  const job = seedJob("job-inbound-noemail");
  const hook = receiver(job.id);
  const body = JSON.stringify({ name: "No Address" });

  for (const attempt of [1, 2]) {
    const res = await call(hook, job, body);
    assert.equal(res.status, 422, `attempt ${attempt}`);
    assert.equal(res.body.code, "missing_email", `attempt ${attempt} stays actionable, never "duplicate_ignored"`);
  }
});

test("a 5xx releases the claim so the provider's retry is processed, not swallowed", async () => {
  const job = seedJob("job-inbound-release");
  const hook = receiver(job.id);
  const body = JSON.stringify({ name: "Grace Hopper", email: "grace.release@example.com" });

  // `defer` is the caller-supplied scheduler intakeLead hands the acknowledgement to.
  // Throwing from it fails the run the way a store or comms fault would, INSIDE the
  // claimed window — which is exactly the window the release exists for.
  const boom = await call(hook, job, body, () => {
    throw new Error("scheduler unavailable");
  });
  assert.equal(boom.status, 500, "a failed run is the one outcome worth replaying");

  const retry = await call(hook, job, body);
  assert.notEqual(retry.body.result, "duplicate_ignored", "the key was given back");
  assert.equal(retry.status, 200);
  assert.equal(retry.body.result, "accepted");
});

test("a repeat from someone we already mailed halts the outreach sequence", async () => {
  const job = seedJob("job-inbound-halt");
  const hook = receiver(job.id);
  const email = "reply.halt@example.com";

  const first = await call(hook, job, JSON.stringify({ name: "Ida Rhodes", email }));
  assert.equal(first.body.duplicate, false);
  const entryId = first.body.entryId as string;

  // We reached out. Only now can an inbound message be a REPLY rather than an application.
  recordOutreachSend(entryId, WS);
  assert.equal(outreachStateFor(entryId, WS).repliedAt, null);

  // A different delivery (so the idempotency key differs) from the same person.
  const repeat = await call(hook, job, JSON.stringify({ name: "Ida Rhodes", email, utm_campaign: "followup" }));
  assert.equal(repeat.body.duplicate, true);
  assert.equal(repeat.body.entryId, entryId, "the repeat lands on the SAME entry");

  assert.ok(outreachStateFor(entryId, WS).repliedAt, "the sequence is halted");
  assert.ok(
    listPipelineEventsForEntry(entryId, 50, WS).some((e) => e.kind === "outreach_halted"),
    "and the halt is auditable"
  );
});

test("a repeat from someone we never contacted is a re-application, not a reply", async () => {
  const job = seedJob("job-inbound-noreach");
  const hook = receiver(job.id);
  const email = "never.mailed@example.com";

  const first = await call(hook, job, JSON.stringify({ name: "Betty Snyder", email }));
  const entryId = first.body.entryId as string;

  const repeat = await call(hook, job, JSON.stringify({ name: "Betty Snyder", email, utm_content: "x" }));
  assert.equal(repeat.body.duplicate, true);

  assert.equal(outreachStateFor(entryId, WS).repliedAt, null, "nothing to halt — we never sent anything");
  const kinds = listPipelineEventsForEntry(entryId, 50, WS).map((e) => e.kind);
  assert.ok(kinds.includes("re_applied"), "it is recorded as a repeat application");
  assert.ok(!kinds.includes("outreach_halted"));
});
