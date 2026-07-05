import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { createPipelineEntry, listPipeline, getPipelineEntry, actOnPipelineEntry, setEntryNotes, listPipelineEventsForEntry } from "./pipeline.ts";

after(() => cleanupUnitDb());

// Behavioral tenant-isolation for pipeline_entries (P1) — proves the board reads,
// by-id reads, and mutations all honor the workspace boundary (closing the IDOR the
// scan flagged: "any session can mutate any entry by id").

test("candidate entries are isolated per team on the board and by id", () => {
  const a = createPipelineEntry({ candidateId: "cand-a", candidateLabel: "Alice", jobId: "job1", jobTitle: "Role", workspaceId: "ws-a" });
  const b = createPipelineEntry({ candidateId: "cand-b", candidateLabel: "Bob", jobId: "job1", jobTitle: "Role", workspaceId: "ws-b" });
  assert.ok(a.created && b.created);

  const boardA = listPipeline("ws-a").map((e) => e.id);
  assert.ok(boardA.includes(a.entry.id), "ws-a sees its own candidate");
  assert.ok(!boardA.includes(b.entry.id), "ws-a must NOT see ws-b's candidate");

  assert.ok(getPipelineEntry(a.entry.id, "ws-a"), "ws-a can open its own entry");
  assert.equal(getPipelineEntry(a.entry.id, "ws-b"), null, "ws-b cannot read ws-a's entry by id");
});

test("a cross-tenant mutation by id is a no-op (IDOR closed)", () => {
  const a = createPipelineEntry({ candidateId: "cand-c", candidateLabel: "Carol", jobId: "job2", jobTitle: "Role2", workspaceId: "ws-a" });

  // ws-b tries to advance / annotate ws-a's entry by its id → the scoped query matches
  // nothing under ws-b, so it's a no-op — never a cross-tenant tamper.
  assert.equal(actOnPipelineEntry(a.entry.id, "accept", undefined, undefined, "ws-b"), null);
  assert.equal(setEntryNotes(a.entry.id, "tampered", "ws-b"), null);

  // The owning team's action still works.
  assert.ok(actOnPipelineEntry(a.entry.id, "accept", undefined, undefined, "ws-a"));
});

test("the audit trail is tenant-isolated (recordEvent auto-derives the entry's workspace)", () => {
  const a = createPipelineEntry({ candidateId: "cand-ev", candidateLabel: "Eva", jobId: "job9", jobTitle: "Role9", workspaceId: "ws-a" });
  // createPipelineEntry recorded an "added" event — auto-tagged to ws-a via the entry.
  assert.ok(listPipelineEventsForEntry(a.entry.id, 50, "ws-a").length >= 1, "ws-a sees its entry's audit trail");
  assert.equal(listPipelineEventsForEntry(a.entry.id, 50, "ws-b").length, 0, "ws-b cannot read ws-a's audit trail");
});
