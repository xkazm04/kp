// The replay the edge drain and the pull pass are DESIGNED to produce, end to end.
//
// Both clock doors are at-least-once: the drain acks after it applies, the pull pass
// adopts its cursor after a clean page. A crash between the two replays the tail on the
// next tick, and both justified that with "the intake core dedupes by idempotency key".
// That key used to live in a process-local Map — emptied by exactly the crash that
// causes the replay. The email dedupe below it covers ACCEPTED leads only: the knockout
// branch files an entry-less decline and emails the candidate, with nothing to dedupe
// against, so a replayed KO lead meant a second rejection email to a real person.
//
//   6. a claim-store fault fails CLOSED: a 5xx the drain reads as "not handled" (it
//      holds its cursor), and no side effect is admitted unchecked;
//   7. the same knockout-failing edge lead ingested twice across a restart files ONE
//      ko_declined event and ONE decline email;
//   8. the edge key is namespaced by pairing, so a re-provisioned edge whose sequence
//      restarts at 1 is not mistaken for a replay.
//
// unit-db is the FIRST project import (throwaway KP_DB_PATH) — load-bearing order.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { ensureDb } from "./db/core.ts";
import { createChannelWebhook } from "./db/channels.ts";
import { listPipelineEvents } from "./db/pipeline.ts";
import { edgeIdempotencyKey } from "./edge-drain.ts";
import { inboundHandled, ingestInboundLeadByToken } from "./inbound-lead.ts";

after(() => cleanupUnitDb());

const here = path.dirname(fileURLToPath(import.meta.url));
const holder = globalThis as typeof globalThis & { __kpDb?: { close(): void } };
const WS = "ws-inbound-replay";
const EDGE_URL = "https://kp-edge.example.workers.dev";

/** Drop every in-memory handle to the database; the next call reopens the same file. */
function restart(): void {
  holder.__kpDb?.close();
  holder.__kpDb = undefined;
}

function seedReceiver(jobId: string): string {
  ensureDb()
    .prepare(`INSERT INTO jobs (id, title, payload_json, status, workspace_id, created_at) VALUES (?, ?, ?, NULL, ?, ?)`)
    .run(jobId, "Replay Engineer", JSON.stringify({ id: jobId, title: "Replay Engineer" }), WS, new Date().toISOString());
  return createChannelWebhook({ channel: "boards", jobId, lang: "en" }, WS).token;
}

function koDeclines(label: string): number {
  return listPipelineEvents(500, 0, ["ko_declined"], WS).filter((e) => e.candidateLabel === label).length;
}

function declineEmails(email: string): number {
  return (
    ensureDb().prepare(`SELECT COUNT(*) AS c FROM dev_outbox WHERE kind = 'ko_decline' AND recipient = ?`).get(email) as { c: number }
  ).c;
}

test("case 6: a claim-store fault fails closed — held, not admitted", async () => {
  const token = seedReceiver("job-replay-fault");
  const label = "Fault Applicant";
  const email = "fault.applicant@example.com";
  // A REAL store failure, not a stub: the table the claim writes is gone.
  ensureDb().exec(`DROP TABLE webhook_claims`);
  try {
    const res = await ingestInboundLeadByToken({
      token,
      rawBody: JSON.stringify({ name: label, email, ko_auth: "no" }),
      origin: "http://localhost:3000",
      idempotencyKey: edgeIdempotencyKey(EDGE_URL, 1),
    });
    assert.ok(res.status >= 500, `a dedupe that cannot answer refuses the delivery (got ${res.status})`);
    assert.equal(inboundHandled(res), false, "the drain holds its cursor and retries next tick");
    assert.equal(koDeclines(label), 0, "no decline was filed without the dedupe");
    assert.equal(declineEmails(email), 0, "and no rejection email went out");
  } finally {
    restart(); // boot DDL recreates the table
  }
});

test("case 7: one knockout-failing edge lead, replayed across a restart, declines ONCE", async () => {
  const token = seedReceiver("job-replay-ko");
  const label = "Replayed Applicant";
  const email = "replayed.applicant@example.com";
  const delivery = {
    token,
    rawBody: JSON.stringify({ name: label, email, ko_auth: "no" }),
    origin: "http://localhost:3000",
    idempotencyKey: edgeIdempotencyKey(EDGE_URL, 7),
  };

  const first = await ingestInboundLeadByToken(delivery);
  assert.equal(first.status, 200);
  assert.equal(first.body.result, "declined");
  assert.equal(koDeclines(label), 1);
  assert.equal(declineEmails(email), 1);

  // The process dies after apply, before the ack; the edge hands the same event back.
  // Closing the connection is a faithful restart only while the claim keeps NO
  // process-local state — the old `new Map()` would have survived this "restart" and
  // passed the case for the wrong reason, so pin its absence.
  assert.doesNotMatch(
    readFileSync(path.join(here, "webhook-idempotency.ts"), "utf8"),
    /new Map\s*[<(]/,
    "the claim store must not live in process memory",
  );
  restart();
  const replay = await ingestInboundLeadByToken(delivery);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.result, "duplicate_ignored", "the replay is absorbed by the durable claim");
  assert.ok(inboundHandled(replay), "and it is handled, so the drain advances past it");
  assert.equal(koDeclines(label), 1, "exactly one ko_declined event");
  assert.equal(declineEmails(email), 1, "exactly one rejection email to the candidate");
});

test("case 8: two pairings replaying the same seq are two deliveries, not a replay", () => {
  const a = edgeIdempotencyKey("https://edge-a.example.workers.dev", 1);
  const b = edgeIdempotencyKey("https://edge-b.example.workers.dev", 1);
  assert.notEqual(a, b, "a re-provisioned edge restarting at seq 1 is not the old edge's seq 1");
  assert.equal(a, edgeIdempotencyKey("https://edge-a.example.workers.dev", 1), "stable for one pairing");
  assert.notEqual(a, edgeIdempotencyKey("https://edge-a.example.workers.dev", 2));
  assert.match(a, /^edge:[0-9a-f]{16}:1$/);
  assert.ok(!a.includes("edge-a.example"), "the pairing is named by a digest, not the URL");

  // And the drain actually keys on it — the bare `edge:${seq}` is gone.
  const src = readFileSync(path.join(here, "edge-drain.ts"), "utf8");
  assert.match(src, /idempotencyKey:\s*edgeIdempotencyKey\(/);
  assert.doesNotMatch(src, /idempotencyKey:\s*`edge:\$\{event\.seq\}`/);
});
