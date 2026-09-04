// The two approval writes that land AFTER an await had no precondition, although
// the store has offered `expectedApprovalKind` since the automation CAS shipped:
//
//   • extendDraftedOffer clears the approval after `await dispatchOffer(...)` — a
//     comms round trip. A human who resolved (or re-raised) the gate during it had
//     their decision overwritten by a stale NULL, and a dispatch that THREW left a
//     minted offer token with the approval never cleared and no record of it.
//   • the hybrid handoff arms the calendar gate after `await humanActor()` + the
//     plan read, with the same hole.
//
// Store behavior is driven against a real isolated DB; the two call sites are
// source-guarded (they sit behind a comms dispatcher and a session read that the
// bare unit runner cannot stand up) in the same style as authz-parity.test.ts.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPipelineEntry, getPipelineEntry, setApproval, reinstatePipelineEntry, actOnPipelineEntry } from "./db/pipeline.ts";

after(() => cleanupUnitDb());

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(HERE, rel), "utf8").replace(/\r\n/g, "\n");

let seq = 0;
function makeEntry() {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `cas-c${seq}`,
    candidateLabel: `CAS Candidate ${seq}`,
    jobId: `cas-job-${seq}`,
    jobTitle: "CAS Role",
  });
  return entry;
}

test("setApproval with expectedApprovalKind refuses a write decided against a stale approval", () => {
  const entry = makeEntry();
  setApproval(entry.id, "offer_review", '{"recommended":100}');

  // A human resolves the gate while the slow hop (dispatchOffer) is in flight.
  setApproval(entry.id, "calendar", "Tue 14:00");

  // The stale writer now tries to clear the approval it decided on.
  const applied = setApproval(entry.id, null, "", undefined, { expectedApprovalKind: "offer_review" });
  assert.equal(applied, false, "the stale clear must be refused, not applied");
  const fresh = getPipelineEntry(entry.id);
  assert.equal(fresh?.approvalKind, "calendar", "the human's decision survives");
  assert.equal(fresh?.approvalDetail, "Tue 14:00");
});

test("setApproval with a matching expectedApprovalKind applies, and null is a real expectation", () => {
  const entry = makeEntry();
  setApproval(entry.id, "offer_review", "{}");
  assert.equal(setApproval(entry.id, null, "", undefined, { expectedApprovalKind: "offer_review" }), true);
  assert.equal(getPipelineEntry(entry.id)?.approvalKind, null);

  // `null` means "nothing was pending when I decided" — a gate raised in the gap
  // must not be clobbered by it.
  setApproval(entry.id, "scorecard_review", "{}");
  assert.equal(setApproval(entry.id, "calendar", "x", undefined, { expectedApprovalKind: null }), false);
  assert.equal(getPipelineEntry(entry.id)?.approvalKind, "scorecard_review");

  // …and applies when nothing IS pending.
  setApproval(entry.id, null, "");
  assert.equal(setApproval(entry.id, "calendar", "x", undefined, { expectedApprovalKind: null }), true);
});

test("setApproval left unguarded still writes — the automation writers that RAISE a gate are unchanged", () => {
  const entry = makeEntry();
  setApproval(entry.id, "screening_review", "{}");
  assert.equal(getPipelineEntry(entry.id)?.approvalKind, "screening_review");
});

test("reinstatePipelineEntry takes its write lock at BEGIN (.immediate)", () => {
  const src = read("./db/pipeline.ts");
  const fn = src.slice(src.indexOf("export function reinstatePipelineEntry"));
  const body = fn.slice(0, fn.indexOf("export type CreatePipelineInput"));
  assert.match(body, /return tx\.immediate\(\);/, "the reinstate read→compute→write must lock at BEGIN");
  assert.doesNotMatch(body, /return tx\(\);/, "a deferred tx() takes the lock only at the first write");

  // …and still does its job.
  const entry = makeEntry();
  actOnPipelineEntry(entry.id, "reject", "no");
  assert.equal(getPipelineEntry(entry.id)?.status, "rejected");
  const restored = reinstatePipelineEntry(entry.id, undefined, "human:Tester");
  assert.equal(restored?.status, "active");
  assert.equal(reinstatePipelineEntry(entry.id), null, "a second reinstate is a no-op, not a churn");
});

test("both post-await approval writes in pipeline-entry-action carry the approval kind read BEFORE the await", () => {
  const src = read("./pipeline-entry-action.ts");
  const writes = src.match(/setApproval\([\s\S]{0,200}?\);/g) ?? [];
  assert.equal(writes.length, 2, "exactly the two known approval writes live here");
  for (const w of writes) {
    assert.match(w, /expectedApprovalKind:/, `an approval write after an await must be guarded: ${w.slice(0, 70)}…`);
  }
  // The expectation must come from the PRE-write snapshot, never from a re-read
  // (a re-read would just observe the value the race already changed).
  assert.match(src, /expectedApprovalKind: entry\.approvalKind/, "the offer clear guards on the snapshot it was decided from");
  assert.match(src, /expectedApprovalKind: current\.approvalKind/, "the handoff arm guards on the snapshot it was decided from");
  // A refused write is a CONFLICT, never a silent success.
  assert.match(src, /if \(!cleared\) \{[\s\S]{0,400}?err\(409/, "a refused approval clear answers the conflict");
  assert.match(src, /if \(!armed\) \{[\s\S]{0,300}?staleResponse\(fresh\)/, "a refused calendar arm answers the stale conflict");
});

test("a throwing offer dispatch leaves the approval OPEN so the retry re-sends the same link", () => {
  const src = read("./pipeline-entry-action.ts");
  const fn = src.slice(src.indexOf("export async function extendDraftedOffer"));
  const body = fn.slice(0, fn.indexOf("export async function runPipelineEntryAction"));
  const dispatchAt = body.indexOf("await dispatchOffer(");
  const catchAt = body.indexOf("} catch (dispatchError) {", dispatchAt);
  const clearAt = body.indexOf("setApproval(entry.id, null,");
  assert.ok(dispatchAt >= 0 && catchAt > dispatchAt, "the dispatch must be caught, not left to blow up the request");
  assert.ok(clearAt > catchAt, "the approval clear must come AFTER the catch — never on the failure path");
  const handler = body.slice(catchAt, clearAt);
  assert.match(handler, /recordAutomationEvent\(/, "the un-sent offer is recorded for the audit trail");
  assert.doesNotMatch(handler, /setApproval\(/, "the failure path must not clear the gate — that is what orphans the token");
  assert.match(handler, /return err\(502/, "the caller is told the offer was drafted but not sent");
});
