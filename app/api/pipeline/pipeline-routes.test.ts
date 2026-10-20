// Handler-level coverage for the pipeline board routes (+ the comms read that
// audits their side effects) against an ISOLATED throwaway DB — testing/unit-db.ts
// must stay the first project import.
//   POST /api/pipeline        — add-to-board with boundary validation; a Match add seals its verdict first
//   GET  /api/pipeline        — the active board contract
//   POST /api/pipeline/[id]   — actions: accept CAS, set_stage guardrails, set_notes bounds, reject
//   GET  /api/comms           — the reject's queued rejection is visible per entry
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { GET as boardGet, POST as boardPost } from "./route.ts";
import { GET as entryGet, POST as actionPost } from "./[id]/route.ts";
import { GET as commsGet } from "../comms/route.ts";
import { getPipelineEntry, PIPELINE_STAGES } from "../../_lib/db/pipeline.ts";
import { listDecisionRecords, verifyDecisionChain } from "../../_lib/decision-record-store.ts";
import { DEFAULT_WORKSPACE_ID } from "../../_lib/db/workspaces.ts";
import { MATCH_VERDICT_KIND, MATCH_VERDICT_REASON_CODE } from "../../_lib/match-verdict.ts";
import { recordMatchRun } from "../../_lib/db/match-runs.ts";

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
  assert.equal((await missing.json()).code, "PIPELINE_ADD_IDS_REQUIRED");

  const badStage = await boardPost(
    jsonRequest("http://localhost/api/pipeline", { candidateId: "c", jobId: "j", stage: "Ghosted" })
  );
  assert.equal(badStage.status, 400);
  const stageBody = await badStage.json();
  assert.equal(stageBody.code, "PIPELINE_ADD_STAGE_UNKNOWN");
  assert.ok(stageBody.stages.includes("Screened"));

  const badGithub = await boardPost(jsonRequest("http://localhost/api/pipeline", { candidateId: "c", jobId: "j", github: "bad" }));
  assert.equal((await badGithub.json()).code, "PIPELINE_GITHUB_EVIDENCE_INVALID");

  const badApproval = await boardPost(jsonRequest("http://localhost/api/pipeline", { candidateId: "c", jobId: "j", approvalKind: "review" }));
  assert.equal((await badApproval.json()).code, "PIPELINE_ADD_APPROVAL_KIND_UNKNOWN");
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

// ---- Match verdict: sealed before the insert, never prose (ADR 0018, key goal 4) --------
const FACTS = {
  fitTier: "strong",
  best: { labelCode: "skills", percent: 82 },
  worst: { labelCode: "career", percent: 40 },
  matched: ["Java", "Kafka"],
  unproven: ["Go"],
  missing: ["Rust"],
  matchScore: 71,
  scorerVersion: "match-scorer.v1",
};
// A Match add names the stored /api/match result it was ranked from (ADR 0018 amendment);
// this stands in for the run the real route records, holding the facts the add carries.
const storedRun = (candidateId: string, jobId: string, facts: unknown) =>
  recordMatchRun({ workspaceId: DEFAULT_WORKSPACE_ID, candidateId, weights: null, results: [{ jobId, facts: facts as never }] });
const matchAdd = (extra: Record<string, unknown> = {}) => {
  seq += 1;
  const ids = { candidateId: `prt-m${seq}`, jobId: `prt-mjob-${seq}` };
  const body = {
    candidateId: ids.candidateId, candidateLabel: "Match Verdict", jobId: ids.jobId, jobTitle: "Role",
    source: "match", approvalKind: "decision", matchScore: 71, matchFacts: FACTS,
    matchRunId: storedRun(ids.candidateId, ids.jobId, "matchFacts" in extra ? extra.matchFacts : FACTS), ...extra,
  };
  return { body, entryId: `m-${body.candidateId}-${body.jobId}`, send: () => boardPost(jsonRequest("http://localhost/api/pipeline", body)) };
};
const verdictsFor = (entryId: string) => listDecisionRecords({ candidateRef: entryId }).filter((r) => r.kind === MATCH_VERDICT_KIND);

test("a Match add seals ONE match_verdict record of codes and params — no prose — and leaves approval_detail null", async () => {
  const add = matchAdd();
  const res = await add.send();
  assert.equal(res.status, 200);
  const { entry } = (await res.json()) as { entry: { id: string; approvalKind: string | null } };
  assert.equal(entry.id, add.entryId, "the record was sealed against the id the insert then used");
  assert.equal(entry.approvalKind, "decision", "the add still files the pending key decision");
  assert.equal(getPipelineEntry(entry.id)!.approvalDetail, null, "nothing in the gate slot");

  const records = verdictsFor(entry.id);
  assert.equal(records.length, 1);
  const [rec] = records;
  assert.equal(rec.reasonCode, MATCH_VERDICT_REASON_CODE);
  assert.equal(rec.actor, "human:recruiter", "the filing recruiter (no session in a unit test → the role token), never auto:match");
  assert.equal(rec.policyVersion, "match-scorer.v1", "the scorer version is the policy version");
  assert.equal(rec.rationale, "match_fit tier=strong best=skills:82 worst=career:40 skills=2/1/1 score=71 scorer=match-scorer.v1");
  assert.deepEqual(JSON.parse(rec.payloadJson).inputs, { ...FACTS, matchRunId: add.body.matchRunId }, "the facts AND the stored run they were checked against ARE the inputs");
  assert.doesNotMatch(rec.payloadJson, /Strong fit|strongest|weakest|matches|lacks/, "no rendered words anywhere in the record");
  // Sealed BEFORE the insert: the record's instant is not after the entry's.
  assert.ok(Date.parse(rec.createdAt) <= Date.parse(getPipelineEntry(entry.id)!.createdAt ?? ""));
});

test("invalid facts get a coded 400, and nothing is sealed or inserted", async () => {
  for (const extra of [
    { matchFacts: undefined },
    { matchFacts: "Strong fit: strongest on Skills (82)." },
    { matchFacts: { ...FACTS, fitTier: "excellent" } },
    { matchFacts: { ...FACTS, best: { labelCode: "charisma", percent: 90 } } },
    { matchFacts: { ...FACTS, matched: ["a", "b", "c", "d"] } },
    { matchFacts: { ...FACTS, missing: ["x".repeat(41)] } },
    { matchFacts: { ...FACTS, line: "Strong fit." } },
    { matchScore: 70 }, // the facts must name the score being filed
    { source: "outreach" }, // facts on a non-Match add are drift
    { reasons: "Strong fit.", reasonsStrengths: ["Java"] }, // the retired prose fields
  ]) {
    const add = matchAdd(extra);
    const res = await add.send();
    assert.equal(res.status, 400, JSON.stringify(extra));
    assert.equal((await res.json()).code, "PIPELINE_ADD_REASONS_INVALID", JSON.stringify(extra));
    assert.equal(getPipelineEntry(add.entryId), null, `nothing filed: ${JSON.stringify(extra)}`);
    assert.equal(listDecisionRecords({ candidateRef: add.entryId }).length, 0, `nothing sealed: ${JSON.stringify(extra)}`);
  }
});

test("a re-add lands on the same entry and seals its own record; the gate slot stays empty", async () => {
  const first = matchAdd();
  const { entry } = (await (await first.send()).json()) as { entry: { id: string } };
  const again = await boardPost(
    jsonRequest("http://localhost/api/pipeline", {
      ...first.body,
      matchFacts: { ...FACTS, fitTier: "promising" },
      matchRunId: storedRun(first.body.candidateId, first.body.jobId, { ...FACTS, fitTier: "promising" }),
    })
  );
  assert.equal(again.status, 200);
  assert.equal((await again.json()).created, false);
  const records = verdictsFor(entry.id);
  assert.equal(records.length, 2, "each add seals its own record");
  assert.deepEqual(records.map((r) => JSON.parse(r.payloadJson).inputs.fitTier), ["promising", "strong"], "newest first");
  assert.equal(getPipelineEntry(entry.id)!.approvalDetail, null);
});

test("the decision chain still verifies after Match adds", async () => {
  await matchAdd().send();
  await matchAdd({ matchFacts: { ...FACTS, best: null, worst: null, matched: [], unproven: [], missing: [] } }).send();
  const verdict = verifyDecisionChain(DEFAULT_WORKSPACE_ID, { full: true });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.brokenAtSeq, null);
  assert.ok(verdict.count >= 2);
});

test("GET /api/pipeline/[id] carries the entry's sealed Match verdict (facts only), and null for a non-Match add", async () => {
  const add = matchAdd();
  const { entry } = (await (await add.send()).json()) as { entry: { id: string } };
  const res = await entryGet(new NextRequest(`http://localhost/api/pipeline/${entry.id}`), idParams(entry.id));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { entry: { id: string }; matchVerdict: { createdAt: string; facts: unknown } | null };
  assert.equal(body.entry.id, entry.id);
  assert.deepEqual(body.matchVerdict?.facts, FACTS, "the Decisions modal renders these in the reader's language");

  const plain = await addViaRoute();
  const plainBody = (await (await entryGet(new NextRequest(`http://localhost/api/pipeline/${plain.entry.id}`), idParams(plain.entry.id))).json()) as {
    matchVerdict: unknown;
  };
  assert.equal(plainBody.matchVerdict, null);
});
