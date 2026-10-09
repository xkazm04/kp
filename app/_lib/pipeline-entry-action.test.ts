// The two OUTCOME guards in runPipelineEntryAction, exercised against a
// WORKSPACE-COMPOSED board rather than only the shipped five columns.
//
// Both guards used to be expressed as "is the entry standing on the OFFER-role
// column". That is a proxy for the real rules, and it only holds on the shipped
// axis, where Offer immediately precedes Hired. validatePipelineStages requires
// only an entry stage and a terminal stage, so a workspace may legitimately:
//   (a) put a column BETWEEN offer and terminal, or
//   (b) carry no offer column at all,
// and under either shape the proxy answers the wrong question:
//   (a) a bare accept on the last pre-terminal column hand-set the outcome-bearing
//       terminal stage — the exact phantom hire the set_stage path 422s;
//   (b) `atOfferStage` was false EVERYWHERE, so approving a drafted offer never
//       reached extendDraftedOffer: it fell through to the generic advance, which
//       NULLs approval_detail — the drafted terms were destroyed and the candidate
//       was "hired" with no offer sent, no offers row and no acceptance.
//
// The shipped-axis cases below are the non-regression half: on the default board
// the new form is byte-identical to the old one.
//
// unit-db.ts MUST be the first project import (sets KP_DB_PATH before any store
// module resolves db-path.ts).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry, getPipelineEntry, listPipelineEventsForEntry, setApproval } from "./db/pipeline.ts";
import { ensureDb } from "./db/core.ts";
import { setDecisionConfig } from "./decision-config-store.ts";
import { listDecisionRecords, sealDecisionSafe } from "./decision-record-store.ts";
import { runPipelineEntryAction, type EntryActionDeps } from "./pipeline-entry-action.ts";

after(() => cleanupUnitDb());

const ORIGIN = "http://localhost:3000";

let seq = 0;
function entryFixture(workspaceId: string, stage: string) {
  seq += 1;
  return createPipelineEntry({
    candidateId: `ea-c${seq}`,
    candidateLabel: `Axis Candidate ${seq}`,
    jobId: `ea-job-${seq}`,
    jobTitle: "Axis Test Role",
    contact: `ea-c${seq}@example.com`,
    stage,
    workspaceId,
  }).entry;
}

const OFFER_DRAFT = JSON.stringify({ subject: "Offer", body: "Hi", recommended: 140000, currency: "CZK" });

// ---- (b) a board with NO offer column -------------------------------------
// Applied → Interview → Hired. Perfectly valid: entry first, terminal last.
const WS_NO_OFFER = "team-axis-no-offer";
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

test("no offer column: approving a drafted offer EXTENDS it instead of destroying the draft", async () => {
  const entry = entryFixture(WS_NO_OFFER, "Interview");
  setApproval(entry.id, "offer_review", OFFER_DRAFT, WS_NO_OFFER);

  const res = await runPipelineEntryAction({
    id: entry.id,
    action: "accept",
    expectedStage: "Interview",
    origin: ORIGIN,
    workspaceId: WS_NO_OFFER,
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.offerExtended, true, "the drafted offer must be extended to the candidate");
  assert.match(String(res.body.link), /\/offer\//, "the candidate gets a secure accept/decline link");
  const fresh = getPipelineEntry(entry.id, WS_NO_OFFER)!;
  assert.equal(fresh.stage, "Interview", "extending an offer is not hiring — the stage must not move");
  assert.notEqual(fresh.stage, "Hired", "no phantom hire without an accepted offer");
});

test("no offer column: a BARE accept on the last pre-terminal column is refused (422)", async () => {
  const entry = entryFixture(WS_NO_OFFER, "Interview");
  const res = await runPipelineEntryAction({
    id: entry.id,
    action: "accept",
    expectedStage: "Interview",
    origin: ORIGIN,
    workspaceId: WS_NO_OFFER,
  });
  assert.equal(res.status, 422);
  assert.match(String(res.body.error), /accepts an offer/);
  assert.equal(getPipelineEntry(entry.id, WS_NO_OFFER)!.stage, "Interview", "the entry must not move");
});

// ---- (a) a column BETWEEN offer and terminal ------------------------------
const WS_POST_OFFER = "team-axis-post-offer";
setDecisionConfig(
  "pipelineStages",
  {
    stages: [
      { id: "Applied", label: "Applied", role: "entry" },
      { id: "Screened", label: "Screened", role: "screening" },
      { id: "Interview", label: "Interview", role: "interview" },
      { id: "Offer", label: "Offer", role: "offer" },
      { id: "Reference check", label: "Reference check", role: "custom" },
      { id: "Hired", label: "Hired", role: "terminal" },
    ],
    retired: [],
  },
  WS_POST_OFFER
);

test("a column between offer and terminal: accept on it cannot hand-set the outcome (422)", async () => {
  const entry = entryFixture(WS_POST_OFFER, "Reference check");
  const res = await runPipelineEntryAction({
    id: entry.id,
    action: "accept",
    expectedStage: "Reference check",
    origin: ORIGIN,
    workspaceId: WS_POST_OFFER,
  });
  assert.equal(res.status, 422, "the terminal stage is reached only by an accepted offer");
  assert.equal(getPipelineEntry(entry.id, WS_POST_OFFER)!.stage, "Reference check");
});

test("a column between offer and terminal: the OFFER step itself still refuses a bare accept", async () => {
  const entry = entryFixture(WS_POST_OFFER, "Offer");
  const res = await runPipelineEntryAction({
    id: entry.id,
    action: "accept",
    expectedStage: "Offer",
    origin: ORIGIN,
    workspaceId: WS_POST_OFFER,
  });
  assert.equal(res.status, 422);
  assert.equal(getPipelineEntry(entry.id, WS_POST_OFFER)!.stage, "Offer");
});

test("a column between offer and terminal: a mid-funnel accept still advances normally", async () => {
  const entry = entryFixture(WS_POST_OFFER, "Screened");
  const res = await runPipelineEntryAction({
    id: entry.id,
    action: "accept",
    expectedStage: "Screened",
    origin: ORIGIN,
    workspaceId: WS_POST_OFFER,
  });
  assert.equal(res.status, 200);
  assert.equal(getPipelineEntry(entry.id, WS_POST_OFFER)!.stage, "Interview");
});

// ---- non-regression on the SHIPPED axis ------------------------------------
const WS_SHIPPED = "team-axis-shipped"; // no override → DEFAULT_STAGE_AXIS

test("shipped axis: a bare accept at Offer is still 422 and Interview still advances to Offer", async () => {
  const atOffer = entryFixture(WS_SHIPPED, "Offer");
  const refused = await runPipelineEntryAction({
    id: atOffer.id,
    action: "accept",
    expectedStage: "Offer",
    origin: ORIGIN,
    workspaceId: WS_SHIPPED,
  });
  assert.equal(refused.status, 422);
  assert.equal(getPipelineEntry(atOffer.id, WS_SHIPPED)!.stage, "Offer");

  const atInterview = entryFixture(WS_SHIPPED, "Interview");
  const advanced = await runPipelineEntryAction({
    id: atInterview.id,
    action: "accept",
    expectedStage: "Interview",
    origin: ORIGIN,
    workspaceId: WS_SHIPPED,
  });
  assert.equal(advanced.status, 200);
  assert.equal(getPipelineEntry(atInterview.id, WS_SHIPPED)!.stage, "Offer");
});

test("shipped axis: an accept on an entry ALREADY at the terminal stage stays a no-op clear, not a 422", async () => {
  // The store's own rule: at the last column there is no next stage, so accept just
  // consumes the approval without bumping stage_changed_at. The new guard must not
  // turn that into a refusal.
  const hired = entryFixture(WS_SHIPPED, "Hired");
  setApproval(hired.id, "decision", "", WS_SHIPPED);
  const res = await runPipelineEntryAction({
    id: hired.id,
    action: "accept",
    expectedStage: "Hired",
    origin: ORIGIN,
    workspaceId: WS_SHIPPED,
  });
  assert.equal(res.status, 200);
  const fresh = getPipelineEntry(hired.id, WS_SHIPPED)!;
  assert.equal(fresh.stage, "Hired");
  assert.equal(fresh.approvalKind, null, "the approval is consumed");
});

test("shipped axis: offer_review at Offer still extends (the legitimate path is unchanged)", async () => {
  const entry = entryFixture(WS_SHIPPED, "Offer");
  setApproval(entry.id, "offer_review", OFFER_DRAFT, WS_SHIPPED);
  const res = await runPipelineEntryAction({
    id: entry.id,
    action: "accept",
    expectedStage: "Offer",
    origin: ORIGIN,
    workspaceId: WS_SHIPPED,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.offerExtended, true);
  assert.equal(getPipelineEntry(entry.id, WS_SHIPPED)!.stage, "Offer");
});

// ---- a rejection comm that throws AFTER the committed write -----------------
// challenge-r05 pipeline-actions-commands/A. The reject is committed before the comm
// is queued, so a comms throw used to escape the core: the ATS `candidate.rejected`
// event and the group-eval expiry below it were skipped, and the single route
// answered 500 for a reject that had in fact happened. Now the throw is recorded as
// a `rejection_comms_failed` marker, the caller hears `commsFailed: true` on a 200,
// and both mirrors still run.
test("reject: a throwing dispatchRejection still answers 200, marks the entry, and runs the ATS + cache mirrors", async () => {
  const entry = entryFixture(WS_SHIPPED, "Screened");
  const ats: string[] = [];
  const expired: string[] = [];
  const res = await runPipelineEntryAction(
    { id: entry.id, action: "reject", expectedStage: "Screened", origin: ORIGIN, workspaceId: WS_SHIPPED },
    {
      dispatchRejection: async () => {
        throw new Error("relay down");
      },
      dispatchAtsEvent: async (event, entryId) => {
        ats.push(`${event}:${entryId}`);
      },
      invalidateGroupEvalSelection: (roleKey) => {
        expired.push(roleKey);
        return 0;
      },
    }
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.commsFailed, true);
  const fresh = getPipelineEntry(entry.id, WS_SHIPPED)!;
  assert.equal(fresh.status, "rejected", "the committed reject stands");
  const kinds = listPipelineEventsForEntry(entry.id, 50, WS_SHIPPED).map((e) => e.kind);
  assert.ok(kinds.includes("rejection_comms_failed"), `a nudge marker is recorded (got ${kinds.join(",")})`);
  assert.deepEqual(ats, [`candidate.rejected:${entry.id}`], "the ATS mirror still fires");
  assert.deepEqual(expired, [entry.jobId], "the group-eval cache is still expired");
});

// ---- SEAL FIRST: no seal, no decision -----------------------------------------
// Council d676869f (compliant-hiring-decision), line 3. The accept/reject seal ran
// AFTER the write, through sealDecisionSafe with its result discarded: a seal that
// failed still answered 200, emailed the candidate and fired the ATS event, and only
// a server log recorded that the decision had no tamper-evident record. The record is
// now the precondition (the screen-wave.ts rule): sealed first, and a failed seal is a
// coded 503 with nothing changed.
const WS_SEAL = "team-seal-first";

type Spied = { deps: Partial<EntryActionDeps>; sent: string[]; ats: string[]; expired: string[] };
function spied(seal?: EntryActionDeps["seal"]): Spied {
  const sent: string[] = [];
  const ats: string[] = [];
  const expired: string[] = [];
  return {
    sent,
    ats,
    expired,
    deps: {
      ...(seal ? { seal } : {}),
      dispatchRejection: async (e) => {
        sent.push(e.id);
        return { claim: "queued", status: "queued", outboxId: `spy-${e.id}`, detail: null };
      },
      dispatchAtsEvent: async (event, entryId) => {
        ats.push(`${event}:${entryId}`);
      },
      invalidateGroupEvalSelection: (roleKey) => {
        expired.push(roleKey);
        return 0;
      },
    },
  };
}

const decisionKinds = (entryId: string) => listPipelineEventsForEntry(entryId, 50, WS_SEAL).map((e) => e.kind);
const recordsFor = (entryId: string) => listDecisionRecords({ candidateRef: entryId, workspaceId: WS_SEAL });
const sealedInputs = (payloadJson: string) => (JSON.parse(payloadJson) as { inputs: Record<string, unknown> }).inputs;

test("seal-first (1): a reject whose record cannot be sealed is refused with a code — no state change, no letter, no ATS event", async () => {
  const entry = entryFixture(WS_SEAL, "Screened");
  const s = spied(() => null);
  const res = await runPipelineEntryAction(
    { id: entry.id, action: "reject", expectedStage: "Screened", origin: ORIGIN, workspaceId: WS_SEAL },
    s.deps
  );
  assert.equal(res.status, 503);
  assert.equal(res.body.code, "PIPELINE_DECISION_NOT_SEALED");
  assert.equal((res.body.entry as { id?: string } | undefined)?.id, entry.id, "the fresh entry rides along");
  const fresh = getPipelineEntry(entry.id, WS_SEAL)!;
  assert.equal(fresh.status, "active", "the candidate was not rejected");
  assert.equal(fresh.stage, "Screened", "the entry keeps its stage");
  assert.ok(!decisionKinds(entry.id).includes("rejected"), "no rejected event was written");
  assert.deepEqual(s.sent, [], "no rejection letter was dispatched");
  assert.deepEqual(s.ats, [], "no candidate.rejected ATS event fired");
  assert.deepEqual(s.expired, [], "nothing moved, so no cohort cache was expired");
  assert.equal(recordsFor(entry.id).length, 0);
});

test("seal-first (2): an accept whose record cannot be sealed is refused the same way — the entry does not advance", async () => {
  const entry = entryFixture(WS_SEAL, "Screened");
  setApproval(entry.id, "decision", "", WS_SEAL);
  const s = spied(() => null);
  const res = await runPipelineEntryAction(
    { id: entry.id, action: "accept", expectedStage: "Screened", origin: ORIGIN, workspaceId: WS_SEAL },
    s.deps
  );
  assert.equal(res.status, 503);
  assert.equal(res.body.code, "PIPELINE_DECISION_NOT_SEALED");
  const fresh = getPipelineEntry(entry.id, WS_SEAL)!;
  assert.equal(fresh.stage, "Screened", "the entry did not advance");
  assert.equal(fresh.approvalKind, "decision", "the approval gate is still open for a retry");
  assert.ok(!decisionKinds(entry.id).includes("advanced"), "no advanced event was written");
  assert.deepEqual(s.ats, []);
  assert.equal(recordsFor(entry.id).length, 0);
});

test("seal-first (3): a successful reject is sealed BEFORE the write — the record exists while the entry is still active", async () => {
  const entry = entryFixture(WS_SEAL, "Screened");
  let statusWhenSealed: string | undefined;
  const s = spied((input, ws) => {
    statusWhenSealed = getPipelineEntry(entry.id, WS_SEAL)?.status;
    return sealDecisionSafe(input, ws);
  });
  const res = await runPipelineEntryAction(
    { id: entry.id, action: "reject", expectedStage: "Screened", origin: ORIGIN, workspaceId: WS_SEAL },
    s.deps
  );
  assert.equal(res.status, 200);
  assert.equal(statusWhenSealed, "active", "the seal ran before actOnPipelineEntry wrote the rejection");
  assert.equal(getPipelineEntry(entry.id, WS_SEAL)!.status, "rejected");
  const records = recordsFor(entry.id);
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, "rejected");
  assert.equal(records[0].reasonCode, "reject", "the reasonCode vocabulary is unchanged");
  assert.deepEqual(s.sent, [entry.id], "the letter goes out once the decision is sealed and applied");
  assert.deepEqual(s.ats, [`candidate.rejected:${entry.id}`]);
});

test("seal-first: an accept on a closed-out entry is refused BEFORE anything is sealed", async () => {
  // actOnPipelineEntry refuses an accept on a terminal status. Sealed ahead of that
  // refusal, the chain would record an advance that never happened — so the core
  // answers it from the live row first.
  const entry = entryFixture(WS_SEAL, "Screened");
  await runPipelineEntryAction({ id: entry.id, action: "reject", expectedStage: "Screened", origin: ORIGIN, workspaceId: WS_SEAL }, spied().deps);
  const before = recordsFor(entry.id).length;
  const res = await runPipelineEntryAction(
    { id: entry.id, action: "accept", expectedStage: "Screened", origin: ORIGIN, workspaceId: WS_SEAL },
    spied().deps
  );
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "PIPELINE_STAGE_CHANGED");
  assert.equal(recordsFor(entry.id).length, before, "no advance was sealed");
});

// ---- a RATIFIED rejection carries the machine's reason ---------------------------
// Council d676869f, line 2. A rejection_review is the policy pass's reject queued for
// a human (automation-pass.ts). Ratified with no note, it sealed "Recruiter reject from
// Screened." — the policy's reason was in approval_detail, which the write NULLs.
const POLICY_REASON = "BAU score 31 < 40";
const queuedReject = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ recommendation: "reject", confidence: 31, rationale: POLICY_REASON, ...extra });

test("ratified (4): a rejection_review rejected with NO note seals the policy's own rationale, and its inputs carry it", async () => {
  const entry = entryFixture(WS_SEAL, "Screened");
  // The exact shape automation-pass.ts queues (pinned in automation-pass.test.ts).
  setApproval(entry.id, "rejection_review", queuedReject(), WS_SEAL);
  const res = await runPipelineEntryAction(
    { id: entry.id, action: "reject", expectedStage: "Screened", origin: ORIGIN, workspaceId: WS_SEAL },
    spied().deps
  );
  assert.equal(res.status, 200);
  const [record] = recordsFor(entry.id);
  assert.equal(record.kind, "rejected");
  assert.equal(record.rationale, POLICY_REASON, "the policy's reason, not the 'Recruiter reject from …' template");
  assert.equal(record.reasonCode, "reject");
  const inputs = sealedInputs(record.payloadJson);
  assert.equal(inputs.aiRationale, POLICY_REASON);
  assert.ok("aiReasonCode" in inputs, "the machine's reason code is a sealed input");
  assert.equal(inputs.aiReasonCode, null, "the policy pass emits no structured code today");
  assert.equal(inputs.aiRecommendation, "reject");
  assert.equal(inputs.approvalKind, "rejection_review");
  assert.equal(inputs.detail, null);
});

test("ratified (5): a rejection_review rejected WITH a note seals the note, and the inputs still carry the policy's reason", async () => {
  const entry = entryFixture(WS_SEAL, "Screened");
  setApproval(entry.id, "rejection_review", queuedReject({ reasonCode: "belowFloor", reasonParams: { score: 31, floor: 40, junk: { nested: true } } }), WS_SEAL);
  const note = "Agree: no Kubernetes experience, which the role needs from day one.";
  const res = await runPipelineEntryAction(
    { id: entry.id, action: "reject", expectedStage: "Screened", detail: note, origin: ORIGIN, workspaceId: WS_SEAL },
    spied().deps
  );
  assert.equal(res.status, 200);
  const [record] = recordsFor(entry.id);
  assert.equal(record.rationale, note, "the recruiter's own words are the decision's rationale");
  const inputs = sealedInputs(record.payloadJson);
  assert.equal(inputs.detail, note);
  assert.equal(inputs.aiRationale, POLICY_REASON, "…and the machine's reason is sealed beside them");
  assert.equal(inputs.aiReasonCode, "belowFloor");
  assert.deepEqual(inputs.aiReasonParams, { score: 31, floor: 40 }, "params keep the string|number shape; a nested blob is dropped");
});

test("ratified: the machine's reject reason never becomes the rationale of an ACCEPT that overrides it", async () => {
  const entry = entryFixture(WS_SEAL, "Screened");
  setApproval(entry.id, "rejection_review", queuedReject(), WS_SEAL);
  const res = await runPipelineEntryAction(
    { id: entry.id, action: "accept", expectedStage: "Screened", origin: ORIGIN, workspaceId: WS_SEAL },
    spied().deps
  );
  assert.equal(res.status, 200);
  const [record] = recordsFor(entry.id);
  assert.equal(record.kind, "advanced");
  assert.equal(record.rationale, "Recruiter accept from Screened.");
  assert.equal(sealedInputs(record.payloadJson).aiRationale, POLICY_REASON, "the overridden reason is still sealed as an input");
});

test("a plain reject with no note and no machine verdict still seals the template (the open question this branch leaves)", async () => {
  const entry = entryFixture(WS_SEAL, "Screened");
  const res = await runPipelineEntryAction(
    { id: entry.id, action: "reject", expectedStage: "Screened", origin: ORIGIN, workspaceId: WS_SEAL },
    spied().deps
  );
  assert.equal(res.status, 200);
  const [record] = recordsFor(entry.id);
  assert.equal(record.rationale, "Recruiter reject from Screened.");
  const inputs = sealedInputs(record.payloadJson);
  assert.equal(inputs.aiRationale, null);
  assert.equal(inputs.aiReasonCode, null);
  assert.equal(inputs.aiReasonParams, null);
});

// ---- a reject on a CLOSED entry must not run again (R3-api-pipeline-1) -------------
// The guard before the seal covered only accept, so a repeat reject sealed another
// 'rejected' record, queued another letter and fired another ATS event; on a candidate's
// own 'declined' it overwrote their decision.
test("closed reject (i): rejecting twice seals, mails, mirrors and logs once; the repeat is a 409", async () => {
  const entry = entryFixture(WS_SEAL, "Screened");
  const s = spied();
  let sealed = 0;
  const deps = { ...s.deps, seal: ((input, ws) => { sealed += 1; return sealDecisionSafe(input, ws); }) as EntryActionDeps["seal"] };
  const run = () =>
    runPipelineEntryAction({ id: entry.id, action: "reject", expectedStage: "Screened", origin: ORIGIN, workspaceId: WS_SEAL }, deps);
  assert.equal((await run()).status, 200);
  const second = await run();
  assert.equal(second.status, 409);
  assert.equal(second.body.code, "PIPELINE_STAGE_CHANGED");
  assert.equal(sealed, 1);
  assert.deepEqual(s.sent, [entry.id]);
  assert.deepEqual(s.ats, [`candidate.rejected:${entry.id}`]);
  assert.equal(decisionKinds(entry.id).filter((k) => k === "rejected").length, 1);
});

test("closed reject (ii): a reject on a 'declined' entry is a 409 and the candidate's decline stands", async () => {
  const entry = entryFixture(WS_SEAL, "Screened");
  ensureDb().prepare(`UPDATE pipeline_entries SET status='declined' WHERE id=?`).run(entry.id);
  const s = spied();
  let sealed = 0;
  const deps = { ...s.deps, seal: ((input, ws) => { sealed += 1; return sealDecisionSafe(input, ws); }) as EntryActionDeps["seal"] };
  const res = await runPipelineEntryAction(
    { id: entry.id, action: "reject", expectedStage: "Screened", origin: ORIGIN, workspaceId: WS_SEAL },
    deps
  );
  assert.equal(res.status, 409);
  assert.equal(getPipelineEntry(entry.id, WS_SEAL)!.status, "declined");
  assert.equal(sealed, 0);
  assert.deepEqual(s.sent, []);
  assert.deepEqual(s.ats, []);
  assert.ok(!decisionKinds(entry.id).includes("rejected"));
});
