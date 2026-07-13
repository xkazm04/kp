// Behavioral store tests for two bug-ui-scan-2026-07-09 (interview-simulation-comparison)
// fixes. Isolated throwaway DB (testing/unit-db.ts must be the FIRST project import).
//   #4 — interviewedForJob must NOT collapse two entry-less completed sessions that
//        share a candidate label into one (dedup falls back to the unique session id).
//   #5 — recordSimTranscriptAttached is idempotent: a duplicate attach with the same
//        detail adds no second sim_attached event.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { createInterviewSession, completeInterviewSession, interviewedForJob } from "./interviews.ts";
import { createPipelineEntry, recordSimTranscriptAttached } from "./pipeline.ts";
import { ensureDb } from "./core.ts";

after(() => cleanupUnitDb());

test("interviewedForJob keeps BOTH entry-less completed sessions that share a candidate label (#4)", () => {
  const jobId = "dedup-job-#4";
  // Two sessions filed under the same job with NO entry link and the SAME label —
  // different candidates whose real second interview used to vanish from compare
  // because the dedup key collapsed to candidate_label.
  const s1 = createInterviewSession({ provider: "openai", mode: "candidate", jobId, candidateLabel: "Alex Novak" });
  const s2 = createInterviewSession({ provider: "openai", mode: "candidate", jobId, candidateLabel: "Alex Novak" });
  completeInterviewSession(s1.id, { transcript: [] });
  completeInterviewSession(s2.id, { transcript: [] });

  const out = interviewedForJob(jobId);
  // Pre-fix: key = entry_id ?? candidate_label => both "Alex Novak" => 1 survived.
  assert.equal(out.length, 2, "both same-label entry-less completed sessions survive dedup");
  assert.ok(out.every((c) => c.candidateLabel === "Alex Novak"));
});

test("interviewedForJob still dedups multiple completed sessions for the SAME entry to the latest (#4 guard)", () => {
  const jobId = "dedup-job-#4-entry";
  const s1 = createInterviewSession({ provider: "openai", mode: "candidate", jobId, entryId: "entry-A", candidateLabel: "Same Person" });
  const s2 = createInterviewSession({ provider: "openai", mode: "candidate", jobId, entryId: "entry-A", candidateLabel: "Same Person" });
  completeInterviewSession(s1.id, { transcript: [] });
  completeInterviewSession(s2.id, { transcript: [] });
  const out = interviewedForJob(jobId);
  assert.equal(out.length, 1, "two sessions for one entry still collapse to the latest");
});

test("recordSimTranscriptAttached is idempotent on identical detail; a distinct detail is a new annotation (#5)", () => {
  const entry = createPipelineEntry({
    candidateId: "sim-cand-#5",
    candidateLabel: "Sim Cand",
    jobId: "sim-job-#5",
    jobTitle: "Backend (demo)",
  }).entry;
  const countSim = () =>
    (ensureDb()
      .prepare(`SELECT COUNT(*) AS n FROM pipeline_events WHERE entry_id = ? AND kind = 'sim_attached'`)
      .get(entry.id) as { n: number }).n;

  assert.equal(recordSimTranscriptAttached(entry.id, "Backend (demo) · completed"), true);
  // Pre-fix: this second identical call appended a duplicate event (count -> 2).
  assert.equal(recordSimTranscriptAttached(entry.id, "Backend (demo) · completed"), true, "duplicate still reports success");
  assert.equal(countSim(), 1, "the duplicate attach adds no second event");

  assert.equal(recordSimTranscriptAttached(entry.id, "Frontend (demo) · completed"), true);
  assert.equal(countSim(), 2, "a genuinely different practice run is a new annotation");

  assert.equal(recordSimTranscriptAttached("no-such-entry", "x"), false, "unknown entry still returns false");
});
