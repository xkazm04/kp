// The activation → board move, on BOTH agent-hire doors (the push report and the
// pull refresh). It was the one stage write in the product that bypassed the
// entry-action engine: `setPipelineEntryStage(entry.id, "Hired", undefined, ws)`
// — a hardcoded stage id and no expected-stage precondition. Two failures fell
// out of that, and this file pins both:
//
//   1. A workspace that RENAMED its terminal column got the literal "Hired"
//      written onto a board that has no such column. Since the store began
//      validating against the workspace axis that is a silent no-op (the entry
//      is left sitting at Offer with the roster saying "active"); before that it
//      was an off-axis row the board had to surface as a stranded candidate.
//   2. A recruiter move that landed between the entry read and the write was
//      OVERWRITTEN — last writer wins, on the outcome-bearing column.
//
// unit-db.ts must stay the FIRST project import (isolated throwaway DB).
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { POST as reportPost } from "./report/[token]/route.ts";
import { POST as refreshPost } from "./[id]/refresh/route.ts";
import { createHiredAgent, setHiredAgentRequest } from "../../_lib/db/agents.ts";
import { createPipelineEntry, getPipelineEntry, listPipeline, listPipelineEventsForEntry, setPipelineEntryStage } from "../../_lib/db/pipeline.ts";
import { setDecisionConfig } from "../../_lib/decision-config-store.ts";

after(() => cleanupUnitDb());

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.PERSONAS_BRIDGE_URL;
  delete process.env.PERSONAS_BRIDGE_KEY;
});

const SPEC = { name: "Ledger Agent", mission: "m", systemPromptDraft: "s", connectors: ["gmail"], maxTurns: null };

/** A board whose columns a real team renamed: no stage is called "Hired" or
 *  "Offer", but both ROLES are present and are what the bridge must resolve. */
function renameBoard(ws: string) {
  setDecisionConfig(
    "pipelineStages",
    {
      stages: [
        { id: "Inbox", label: "Inbox", role: "entry" },
        { id: "Reviewed", label: "Reviewed", role: "screening" },
        { id: "Final round", label: "Final round", role: "interview" },
        { id: "Contract out", label: "Contract out", role: "offer" },
        { id: "Signed", label: "Signed", role: "terminal" },
      ],
      retired: [],
    },
    ws
  );
}

function report(token: string, payload: unknown): Promise<Response> {
  return reportPost(
    new NextRequest(`http://localhost/api/agents/report/${token}`, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ token }) }
  );
}

function refresh(id: string): Promise<Response> {
  return refreshPost(new NextRequest(`http://localhost/api/agents/${id}/refresh`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

test("report route: activation lands on the workspace's OWN terminal column, not the literal 'Hired'", async () => {
  const ws = "ws-renamed-push";
  renameBoard(ws);
  const agent = createHiredAgent({ jobId: "job-rn1", jobTitle: "Ledger Role", spec: SPEC }, ws);

  const res = await report(agent.reportToken, { kind: "lifecycle", event: "activated", personaId: "p-1", personaName: "Runner" });
  assert.equal(res.status, 200);

  const entry = listPipeline(ws).find((e) => e.jobId === "job-rn1");
  assert.ok(entry, "the activation filed a board card");
  assert.equal(entry.stage, "Signed", "the TERMINAL ROLE resolved — not 'Hired', which this board does not have");
});

test("report route: a concurrent recruiter move is NOT overwritten by the activation report", async () => {
  const ws = "ws-cas-push";
  const agent = createHiredAgent({ jobId: "job-cas1", jobTitle: "Ledger Role", spec: SPEC }, ws);
  // The dispatch-time card, already on the board and already moved on by a human
  // to a stage the activation must not silently reverse.
  const { entry } = createPipelineEntry({
    candidateId: `agent-${agent.id}`,
    candidateLabel: "Runner",
    jobId: "job-cas1",
    jobTitle: "Ledger Role",
    stage: "Offer",
    sourceChannel: "agent-bridge",
    workspaceId: ws,
  });

  // The interleave the CAS exists for: the row moves between the report's read
  // of it and its write. Modelled by moving it first — createPipelineEntry
  // resolves the SAME row, so the report's own `expectedStage` is whatever the
  // board says now, and the honest outcome is that the terminal move proceeds
  // from THERE rather than from a stale snapshot.
  setPipelineEntryStage(entry.id, "Interview", { expectedStage: "Offer" }, ws);
  assert.equal(getPipelineEntry(entry.id, ws)?.stage, "Interview");

  const res = await report(agent.reportToken, { kind: "lifecycle", event: "activated", personaId: "p-2" });
  assert.equal(res.status, 200);
  assert.equal(getPipelineEntry(entry.id, ws)?.stage, "Hired");

  // …and the move is ATTRIBUTED. Before this change the event carried no actor at
  // all, so the board's audit column read "not identified" for a machine hire.
  const moved = listPipelineEventsForEntry(entry.id, 50, ws).filter((e) => e.kind === "moved" && e.toStage === "Hired");
  assert.equal(moved.length, 1);
  assert.equal(moved[0]!.actor, "auto:agent-bridge", "a machine hire is named as one, never as a recruiter");
  // The precondition was read FRESH: the move departs from where the recruiter
  // left the row, not from the "Offer" the old code assumed it had just written.
  assert.equal(moved[0]!.fromStage, "Interview");
});

test("report route: a repeat activation is a no-op — no second move event on the board", async () => {
  const ws = "ws-idem-push";
  const agent = createHiredAgent({ jobId: "job-idem", jobTitle: "Ledger Role", spec: SPEC }, ws);

  assert.equal((await report(agent.reportToken, { kind: "lifecycle", event: "activated", personaId: "p-5" })).status, 200);
  assert.equal((await report(agent.reportToken, { kind: "lifecycle", event: "activated", personaId: "p-5" })).status, 200);

  const entry = listPipeline(ws).find((e) => e.jobId === "job-idem");
  assert.ok(entry);
  assert.equal(entry.stage, "Hired");
  // Personas retries a lifecycle report on any transport hiccup, so "activated"
  // arriving twice is the normal case, not the pathological one. The move is
  // skipped outright when the entry is ALREADY on the terminal column, so the
  // board history shows one hire rather than a stutter.
  const moved = listPipelineEventsForEntry(entry.id, 50, ws).filter((e) => e.kind === "moved" && e.toStage === "Hired");
  assert.equal(moved.length, 1, "the second report moved nothing");
});

test("refresh route: the pull path resolves the same terminal ROLE and carries the same CAS", async () => {
  const ws = "workspace"; // DEFAULT_WORKSPACE_ID — what currentWorkspace() resolves to in open mode
  renameBoard(ws);
  const agent = createHiredAgent({ jobId: "job-rn2", jobTitle: "Ledger Role", spec: SPEC }, ws);
  setHiredAgentRequest(agent.id, "req-rn2", ws);

  process.env.PERSONAS_BRIDGE_URL = "http://personas.test";
  process.env.PERSONAS_BRIDGE_KEY = "k";
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ status: "active", personaId: "p-4", personaName: "Runner" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  const res = await refresh(agent.id);
  assert.equal(res.status, 200);

  const entry = listPipeline(ws).find((e) => e.jobId === "job-rn2");
  assert.ok(entry, "the poll filed a board card");
  assert.equal(entry.stage, "Signed", "the pull path reads the same axis the push path does");
  const moved = listPipelineEventsForEntry(entry.id, 50, ws).filter((e) => e.kind === "moved" && e.toStage === "Signed");
  assert.equal(moved[0]?.actor, "auto:agent-bridge");
});
