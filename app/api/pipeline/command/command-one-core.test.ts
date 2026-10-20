// challenge-r05 pipeline-actions-commands/A — the command bar has ONE write door.
//
// runPipelineEntryAction (app/_lib/pipeline-entry-action.ts) was built so the per-entry
// and batch routes "can never diverge on the guards that matter". The command bar is
// the third bulk door and used to call actOnPipelineEntry directly, so a typed
// `reject below 40%` wrote N rejections with no decision_records row, a NULL actor on
// the event, no `candidate.rejected` ATS event and a stale group-eval cache; and
// `advance top N` could bare-advance onto the terminal column of a composed board
// (a phantom hire) or destroy a drafted offer on a board with no offer column.
//
// Cases 1-2 drive the real POST (the route resolves origin + workspace); cases 3-4
// drive executeCommandTargets with its REAL core on a composed axis; case 7 is the
// grep guard that keeps the old door shut.
//
// unit-db.ts MUST be the first project import (sets KP_DB_PATH before any store
// module resolves db-path.ts).
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { POST } from "./route.ts";
import { ensureDb } from "../../../_lib/db/core.ts";
import {
  createPipelineEntry,
  getPipelineEntry,
  listPipeline,
  listPipelineEventsForEntry,
  setApproval,
} from "../../../_lib/db/pipeline.ts";
import { listDecisionRecords } from "../../../_lib/decision-record-store.ts";
import { setDecisionConfig } from "../../../_lib/decision-config-store.ts";
import { getPipelineAxis } from "../../../_lib/pipeline-axis-server.ts";
import { affected } from "../../../_lib/pipeline-command.ts";
import { listOffersForEntry } from "../../../_lib/offers-store.ts";
import { executeCommandTargets } from "./execute.ts";

after(() => cleanupUnitDb());
before(() => {
  // The bar ranks every active entry by score — start from an empty board so the
  // demo seed cannot join the fixtures' cohort.
  ensureDb().prepare(`DELETE FROM pipeline_entries`).run();
});

const post = (body: unknown): Promise<Response> =>
  POST(
    new NextRequest("http://localhost/api/pipeline/command", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
  );

let seq = 0;
function entryFixture(overrides: Partial<Parameters<typeof createPipelineEntry>[0]> = {}) {
  seq += 1;
  return createPipelineEntry({
    candidateId: `core-c${seq}`,
    candidateLabel: `Core Candidate ${seq}`,
    jobId: `core-job-${seq}`,
    jobTitle: "One Core Role",
    contact: `core-c${seq}@example.com`,
    ...overrides,
  }).entry;
}

// ---- cases 1 + 2: reject_below seals and names the actor --------------------
test("reject_below seals a 'rejected' decision per target with the command-bar policy, the entry's stage and the typed threshold", async () => {
  const fixtures = [
    entryFixture({ stage: "Screened", matchScore: 20 }),
    entryFixture({ stage: "Interview", matchScore: 30 }),
    entryFixture({ stage: "Accepted", matchScore: 35 }),
  ];
  const preview = await (await post({ text: "reject below 40%" })).json();
  assert.equal(preview.total, 3);
  const done = await (await post({ text: "reject below 40%", confirm: true, confirmIds: preview.matchedIds })).json();
  assert.equal(done.count, 3);
  assert.equal(done.failed, 0);

  for (const f of fixtures) {
    assert.equal(getPipelineEntry(f.id)!.status, "rejected");
    const seals = listDecisionRecords({ candidateRef: f.id }).filter((r) => r.kind === "rejected");
    assert.equal(seals.length, 1, `exactly one sealed rejection for ${f.id}`);
    const [seal] = seals;
    assert.equal(seal.reasonCode, "reject");
    assert.equal(seal.policyVersion, "command-bar");
    const inputs = (JSON.parse(seal.payloadJson) as { inputs: { fromStage: string; threshold: number } }).inputs;
    assert.equal(inputs.fromStage, f.stage, "the decisive input is the stage the candidate stood on");
    assert.equal(inputs.threshold, 40, "the typed percentage is sealed");
  }
});

test("reject_below names the actor on every 'rejected' event (open mode: human:recruiter, never NULL)", async () => {
  const f = entryFixture({ stage: "Screened", matchScore: 10 });
  const preview = await (await post({ text: "reject below 15%" })).json();
  assert.deepEqual(preview.matchedIds, [f.id]);
  await post({ text: "reject below 15%", confirm: true, confirmIds: preview.matchedIds });
  const rejected = listPipelineEventsForEntry(f.id).filter((e) => e.kind === "rejected");
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].actor, "human:recruiter");
});

// ---- case 3: a composed axis with a column between offer and terminal ------
const WS_POST_OFFER = "team-core-post-offer";
setDecisionConfig(
  "pipelineStages",
  {
    stages: [
      { id: "Accepted", label: "Accepted", role: "entry" },
      { id: "Screened", label: "Screened", role: "screening" },
      { id: "Offer", label: "Offer", role: "offer" },
      { id: "Background", label: "Background", role: "custom" },
      { id: "Hired", label: "Hired", role: "terminal" },
    ],
    retired: [],
  },
  WS_POST_OFFER
);

test("advance_top on a pre-terminal custom column holds the entry instead of hiring it", async () => {
  const bg = entryFixture({ stage: "Background", matchScore: 90, workspaceId: WS_POST_OFFER });
  const axis = getPipelineAxis(WS_POST_OFFER).stages;
  const targets = affected({ kind: "advance_top", count: 5 }, listPipeline(WS_POST_OFFER), axis);
  assert.deepEqual(targets.map((e) => e.id), [bg.id], "the custom column is rankable");

  const counts = await executeCommandTargets({ kind: "advance_top", targets, workspaceId: WS_POST_OFFER, origin: "http://localhost" });
  assert.equal(counts.count, 0);
  assert.equal(counts.heldAtOffer, 1, "the terminal guard is a hold, reported");
  assert.equal(getPipelineEntry(bg.id, WS_POST_OFFER)!.stage, "Background", "no phantom hire");
  const hiredRows = listPipeline(WS_POST_OFFER).filter((e) => e.stage === "Hired");
  assert.deepEqual(hiredRows, [], "no entry stands on the terminal column");
});

// ---- case 4: a board with NO offer column, carrying a drafted offer --------
const WS_NO_OFFER = "team-core-no-offer";
setDecisionConfig(
  "pipelineStages",
  {
    stages: [
      { id: "Applied", label: "Applied", role: "entry" },
      { id: "Interview", label: "Interview", role: "interview" },
      { id: "Hired", label: "Hired", role: "terminal" },
    ],
    retired: [],
  },
  WS_NO_OFFER
);

test("advance_top holds a drafted offer on a board with no offer column: approval intact, no offer minted", async () => {
  const drafted = JSON.stringify({ subject: "Offer", body: "Hi", recommended: 120000, currency: "CZK" });
  const e = entryFixture({ stage: "Applied", matchScore: 95, workspaceId: WS_NO_OFFER });
  setApproval(e.id, "offer_review", drafted, WS_NO_OFFER);
  const axis = getPipelineAxis(WS_NO_OFFER).stages;
  const targets = affected({ kind: "advance_top", count: 5 }, listPipeline(WS_NO_OFFER), axis);

  const counts = await executeCommandTargets({ kind: "advance_top", targets, workspaceId: WS_NO_OFFER, origin: "http://localhost" });
  assert.equal(counts.heldAtOffer, 1);
  assert.equal(counts.count, 0);
  const fresh = getPipelineEntry(e.id, WS_NO_OFFER)!;
  assert.equal(fresh.stage, "Applied");
  assert.equal(fresh.approvalKind, "offer_review", "the drafted offer approval survives");
  assert.equal(fresh.approvalDetail, drafted, "the drafted terms survive byte-for-byte");
  assert.deepEqual(listOffersForEntry(e.id), [], "the bar never mints or extends an offer");
});

// ---- case 7: one write door ------------------------------------------------
test("execute.ts writes only through runPipelineEntryAction (grep guard)", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const exec = readFileSync(path.join(dir, "execute.ts"), "utf8");
  assert.doesNotMatch(exec, /\bactOnPipelineEntry\b/, "no direct store write");
  assert.doesNotMatch(exec, /\bdispatchRejection\b/, "the rejection comm belongs to the core");
  assert.match(exec, /import \{[^}]*\brunPipelineEntryAction\b[^}]*\} from "@\/app\/_lib\/pipeline-entry-action"/);
});
