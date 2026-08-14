// `recordAutomationEvent` writes the event to the RIGHT tenant — recordEvent
// derives that from the entry with an unscoped by-id read — but looked its display
// metadata up with a TENANT-SCOPED query that defaulted to the single workspace.
// So on any other team the lookup missed and the row was written with NULL
// candidate_label / job_title / archetype / to_stage: every automation event
// (outreach sent, interview scheduled, rejection sent, offer sent, onboarding
// started) rendered in the Activity feed and the drawer history as an anonymous
// row with no name, no role and no stage.
//
// The fix was structural rather than per-call-site: PipelineEntry now surfaces
// `workspaceId` (the row always carried it; rowToEntry dropped it), so the ~24
// callers holding an entry pass `entry.workspaceId` instead of nothing. This pins
// the behaviour AND the two structural facts it rests on.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry, listPipelineEventsForEntry, recordAutomationEvent } from "./db/pipeline.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";

after(() => cleanupUnitDb());

const WS_B = "team-events-b";

function entryIn(ws: string, tag: string) {
  return createPipelineEntry({
    candidateId: `evt-${tag}`,
    candidateLabel: `Event Candidate ${tag}`,
    jobId: `evt-job-${tag}`,
    jobTitle: "Event Test Role",
    contact: `evt-${tag}@example.com`,
    stage: "Screened",
    workspaceId: ws,
  }).entry;
}

test("an entry carries its own tenant, so a caller holding one never has to be told", () => {
  const a = entryIn(DEFAULT_WORKSPACE_ID, "a");
  const b = entryIn(WS_B, "b");
  assert.equal(a.workspaceId, DEFAULT_WORKSPACE_ID);
  assert.equal(b.workspaceId, WS_B, "this field is the whole point — without it the callers below cannot be correct");
});

test("a scoped automation event keeps its metadata on ANY workspace", () => {
  for (const ws of [DEFAULT_WORKSPACE_ID, WS_B]) {
    const entry = entryIn(ws, `meta-${ws}`);
    recordAutomationEvent(entry.id, "outreach_sent", "detail", entry.workspaceId);

    const ev = listPipelineEventsForEntry(entry.id, 10, ws).find((e) => e.kind === "outreach_sent");
    assert.ok(ev, `${ws}: the event must be recorded`);
    assert.equal(ev.candidateLabel, entry.candidateLabel, `${ws}: candidate must not be blank`);
    assert.equal(ev.jobTitle, "Event Test Role", `${ws}: role must not be blank`);
    assert.equal(ev.toStage, "Screened", `${ws}: stage must not be blank`);
  }
});

test("the blank-metadata failure is real, and only an omitted tenant causes it", () => {
  // Non-vacuity: the assertions above pass trivially if the metadata lookup were
  // unscoped. Drive the exact old call shape and prove it still degrades — which is
  // also why the default argument is the footgun worth naming in review.
  const entry = entryIn(WS_B, "bare");
  recordAutomationEvent(entry.id, "offer_sent", "detail"); // no tenant — the old shape

  const ev = listPipelineEventsForEntry(entry.id, 10, WS_B).find((e) => e.kind === "offer_sent");
  assert.ok(ev, "the event still lands on the right tenant (recordEvent derives it)");
  assert.equal(ev.candidateLabel, null, "…but arrives stripped — this is the defect being guarded");
  assert.equal(ev.toStage, null);
});

// --- source contract on the dispatchers ------------------------------------
// comms-dispatch owns 16 of the call sites. A new dispatcher that forgets the
// argument reintroduces the whole class, and no behavioural test would catch it.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const dispatchSrc = readFileSync(path.join(HERE, "comms-dispatch.ts"), "utf8");

test("every comms dispatcher threads a tenant into recordAutomationEvent", () => {
  const calls = dispatchSrc.match(/recordAutomationEvent\((?:[^;]*?)\);/g) ?? [];
  assert.ok(calls.length >= 15, `expected the full dispatcher set, found ${calls.length}`);
  for (const call of calls) {
    assert.match(
      call,
      /(entry\.workspaceId|opts\?\.workspaceId)/,
      `a dispatcher dropped the tenant — the event would be written blank:\n${call}`
    );
  }
});
