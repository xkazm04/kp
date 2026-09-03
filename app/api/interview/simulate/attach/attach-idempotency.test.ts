// Pins the attach annotation's IDEMPOTENCY KEY (wave 18b).
//
// `recordSimTranscriptAttached` de-duplicates on the event DETAIL string. That
// detail used to be `jobTitle · completed`, which is the SAME value for every
// practice run of a given sim mode — so the store's dedup was keyed on the mode,
// not on the run. Two consequences, both wrong in the same place:
//
//   * two DIFFERENT practice interviews attached to one candidate collapsed into
//     a single drawer line (the second attach silently vanished), and
//   * the only thing stopping ONE run from being annotated twice was a client
//     latch in InterviewAttachToCandidate — which a reload, a second tab or a
//     retried fetch does not survive.
//
// `simAttachDetail` folds a stable opaque per-session ref into the string, which
// turns the store's detail-keyed dedup into exactly "idempotent per (session,
// entry)". These are the two halves of that: the key is per-session and stable,
// and the store collapses a repeat while keeping a genuinely different run.
//
// Runner: node --test with type stripping (npm run test:unit).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { simAttachDetail, simRunRef } from "./sim-session.ts";
import { cleanupUnitDb } from "../../../../_lib/testing/unit-db.ts";
import { createPipelineEntry, recordSimTranscriptAttached } from "../../../../_lib/db/pipeline.ts";
import { ensureDb } from "../../../../_lib/db/core.ts";
import { DEFAULT_WORKSPACE_ID } from "../../../../_lib/db/workspaces.ts";

after(() => cleanupUnitDb());

const session = (id: string) => ({ id, jobTitle: "Junior Backend Developer (case demo)", status: "completed", endedAt: "2026-09-02T10:00:00.000Z" });

test("the attach key is stable per session and opaque — never the id or the token", () => {
  const ref = simRunRef("sess-abc");
  assert.equal(ref, simRunRef("sess-abc"), "the same session must key the same annotation on every POST");
  assert.notEqual(ref, simRunRef("sess-xyz"), "two runs must not share an annotation");
  assert.match(ref, /^[0-9a-f]{6}$/);
  assert.ok(!simAttachDetail(session("sess-abc")).includes("sess-abc"), "the session id must not reach the drawer line");
});

test("two different practice runs produce two different details; the same run always the same one", () => {
  assert.equal(simAttachDetail(session("s-1")), simAttachDetail(session("s-1")));
  assert.notEqual(simAttachDetail(session("s-1")), simAttachDetail(session("s-2")));
});

test("a repeat attach of one run writes ONE event; a second run writes its own", () => {
  const { entry } = createPipelineEntry({
    candidateId: "cand-attach-1",
    candidateLabel: "Ada",
    jobId: "job-attach-1",
    jobTitle: "Junior Backend Developer",
  });
  const count = () =>
    (
      ensureDb()
        .prepare(`SELECT COUNT(*) AS n FROM pipeline_events WHERE entry_id = ? AND kind = 'sim_attached'`)
        .get(entry.id) as { n: number }
    ).n;

  assert.equal(recordSimTranscriptAttached(entry.id, simAttachDetail(session("s-1")), DEFAULT_WORKSPACE_ID), true);
  assert.equal(count(), 1);
  // The second POST of the SAME run — a reload, a second tab, a retried fetch.
  assert.equal(recordSimTranscriptAttached(entry.id, simAttachDetail(session("s-1")), DEFAULT_WORKSPACE_ID), true);
  assert.equal(count(), 1, "a repeat attach of the same run must not add a second drawer line");
  // A genuinely different practice run of the same mode must still land.
  assert.equal(recordSimTranscriptAttached(entry.id, simAttachDetail(session("s-2")), DEFAULT_WORKSPACE_ID), true);
  assert.equal(count(), 2, "a different practice run must not be swallowed as a duplicate");
});
