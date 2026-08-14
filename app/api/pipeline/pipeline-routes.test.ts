// Handler-level coverage for the pipeline board routes (+ the comms read that
// audits their side effects) against an ISOLATED throwaway DB — testing/unit-db.ts
// must stay the first project import.
//   POST /api/pipeline        — add-to-board with boundary validation
//   GET  /api/pipeline        — the active board contract
//   POST /api/pipeline/[id]   — actions: accept CAS, set_stage guardrails, set_notes bounds, reject
//   GET  /api/comms           — the reject's queued rejection is visible per entry
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { GET as boardGet, POST as boardPost } from "./route.ts";
import { POST as actionPost } from "./[id]/route.ts";
import { GET as commsGet } from "../comms/route.ts";
import { getPipelineEntry, PIPELINE_STAGES } from "../../_lib/db/pipeline.ts";

after(() => cleanupUnitDb());

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

let seq = 0;
async function addViaRoute(extra: Record<string, unknown> = {}) {
  seq += 1;
  const res = await boardPost(
    jsonRequest("http://localhost/api/pipeline", {
      candidateId: `prt-c${seq}`,
      candidateLabel: `Pipeline Route Candidate ${seq}`,
      jobId: `prt-job-${seq}`,
      jobTitle: "Pipeline Route Role",
      ...extra,
    })
  );
  assert.equal(res.status, 200);
  return (await res.json()) as { entry: { id: string; stage: string }; created: boolean };
}

test("POST /api/pipeline validates the boundary: missing ids → 400, unknown stage → 400", async () => {
  const missing = await boardPost(jsonRequest("http://localhost/api/pipeline", { candidateLabel: "No Ids" }));
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /candidateId and jobId/);

  const badStage = await boardPost(
    jsonRequest("http://localhost/api/pipeline", { candidateId: "c", jobId: "j", stage: "Ghosted" })
  );
  assert.equal(badStage.status, 400);
  assert.match((await badStage.json()).error, /Unknown stage/);
});

test("POST /api/pipeline files the candidate once: happy add persists, the re-add returns created:false", async () => {
  const first = await addViaRoute();
  assert.equal(first.created, true);
  assert.equal(first.entry.stage, "Screened", "stage defaults to Screened");
  assert.ok(getPipelineEntry(first.entry.id), "the row is persisted in the store");

  const again = await boardPost(
    jsonRequest("http://localhost/api/pipeline", {
      candidateId: `prt-c${seq}`,
      jobId: `prt-job-${seq}`,
    })
  );
  const body = await again.json();
  assert.equal(body.created, false);
  assert.equal(body.entry.id, first.entry.id);
});

test("GET /api/pipeline returns the canonical stage axis and only active entries", async () => {
  const live = await addViaRoute();
  const closed = await addViaRoute();
  await actionPost(jsonRequest(`http://localhost/api/pipeline/${closed.entry.id}`, { action: "reject" }), idParams(closed.entry.id));

  const res = await boardGet();
  assert.equal(res.status, 200);
  const body = await res.json();
  // The payload now carries the RESOLVED axis (id + label + role), not a name
  // list: the board renders these columns instead of importing the constant, so
  // a workspace override reaches the board through this field. With no override
  // stored it is the shipped axis, unchanged.
  assert.deepEqual(
    (body.stages as Array<{ id: string }>).map((s) => s.id),
    [...PIPELINE_STAGES]
  );
  assert.ok(
    (body.stages as Array<{ role?: string }>).every((s) => typeof s.role === "string"),
    "every column carries the role the product rules resolve through"
  );
  assert.deepEqual(body.retiredStages, [], "a workspace that has dropped no column has no tombstones");
  const ids = new Set((body.entries as Array<{ id: string }>).map((e) => e.id));
  assert.ok(ids.has(live.entry.id));
  assert.ok(!ids.has(closed.entry.id), "a rejected entry must not ride the board payload");
});

test("action POST: accept advances; a stale expectedStage → 409 carrying the fresh entry; unknown action → 400; unknown id → 404", async () => {
  const { entry } = await addViaRoute();

  const accepted = await actionPost(
    jsonRequest(`http://localhost/api/pipeline/${entry.id}`, { action: "accept", expectedStage: "Screened" }),
    idParams(entry.id)
  );
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).entry.stage, "Interview");

  // The same snapshot decision replayed is now stale → 409 + the fresh entry.
  const stale = await actionPost(
    jsonRequest(`http://localhost/api/pipeline/${entry.id}`, { action: "accept", expectedStage: "Screened" }),
    idParams(entry.id)
  );
  assert.equal(stale.status, 409);
  const staleBody = await stale.json();
  assert.equal(staleBody.entry.stage, "Interview", "the 409 hands back reality to re-decide against");
  assert.equal(getPipelineEntry(entry.id)!.stage, "Interview", "the stale decision must not have applied");

  const unknown = await actionPost(jsonRequest(`http://localhost/api/pipeline/${entry.id}`, { action: "explode" }), idParams(entry.id));
  assert.equal(unknown.status, 400);

  const missing = await actionPost(jsonRequest("http://localhost/api/pipeline/nope", { action: "accept" }), idParams("nope"));
  assert.equal(missing.status, 404);
});

test("set_stage guardrails: manual Hired is 422 (offer flow only), unknown stage 400, backward move works", async () => {
  const { entry } = await addViaRoute({ stage: "Interview" });

  const hired = await actionPost(
    jsonRequest(`http://localhost/api/pipeline/${entry.id}`, { action: "set_stage", toStage: "Hired" }),
    idParams(entry.id)
  );
  assert.equal(hired.status, 422, "a hire without an accepted offer must be refused");

  const bad = await actionPost(
    jsonRequest(`http://localhost/api/pipeline/${entry.id}`, { action: "set_stage", toStage: "Limbo" }),
    idParams(entry.id)
  );
  assert.equal(bad.status, 400);

  const back = await actionPost(
    jsonRequest(`http://localhost/api/pipeline/${entry.id}`, { action: "set_stage", toStage: "Screened" }),
    idParams(entry.id)
  );
  assert.equal(back.status, 200);
  assert.equal((await back.json()).entry.stage, "Screened");
});

test("set_notes: type and length are enforced at the boundary; a valid note persists trimmed", async () => {
  const { entry } = await addViaRoute();

  const notString = await actionPost(
    jsonRequest(`http://localhost/api/pipeline/${entry.id}`, { action: "set_notes", notes: 42 }),
    idParams(entry.id)
  );
  assert.equal(notString.status, 400);

  const tooLong = await actionPost(
    jsonRequest(`http://localhost/api/pipeline/${entry.id}`, { action: "set_notes", notes: "x".repeat(4001) }),
    idParams(entry.id)
  );
  assert.equal(tooLong.status, 400);
  assert.match((await tooLong.json()).error, /too long/);

  const saved = await actionPost(
    jsonRequest(`http://localhost/api/pipeline/${entry.id}`, { action: "set_notes", notes: "  wants 80k, available August  " }),
    idParams(entry.id)
  );
  assert.equal(saved.status, 200);
  assert.equal(getPipelineEntry(entry.id)!.notes, "wants 80k, available August");
});

test("reject closes the entry and its queued rejection is auditable via GET /api/comms?entry=", async () => {
  const { entry } = await addViaRoute({ });
  const rejected = await actionPost(
    jsonRequest(`http://localhost/api/pipeline/${entry.id}`, { action: "reject", detail: "not a fit" }),
    idParams(entry.id)
  );
  assert.equal(rejected.status, 200);
  assert.equal((await rejected.json()).entry.status, "rejected");

  const comms = await commsGet(new NextRequest(`http://localhost/api/comms?entry=${entry.id}`));
  assert.equal(comms.status, 200);
  const body = await comms.json();
  const mine = (body.messages as Array<{ ref: string | null; kind: string | null }>).filter((m) => m.ref === entry.id);
  assert.ok(mine.some((m) => m.kind === "rejection"), "the human reject must queue a rejection comm for this entry");
  assert.equal(body.relayConfigured, false, "no relay in tests — the Comms Center must be told");
});
