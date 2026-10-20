// GET /api/interview/compare carries EVERY human scorecard on a candidate, not the
// `humanScorecard` headline mirror (r09 follow-up to schedule-interview-prep/A). Human
// scorecards are keyed by (interviewer, round); the grid used to read the one key the
// store rewrites on every save, so a second interviewer's card hid the first one's at
// the exact surface where the hire decision is weighed. Each record says whose it is
// (a display label — never the signed-in user id) and which round, and a card saved
// before attribution existed is marked legacy. Isolated throwaway DB (unit-db.ts is the
// first project import); outside a request currentWorkspace() is the default workspace.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { GET } from "./route.ts";
import { createPipelineEntry } from "../../../_lib/db/pipeline.ts";
import { saveHumanScorecard, saveInterviewPrep } from "../../../_lib/interview-prep.ts";

after(() => cleanupUnitDb());

const JOB = "job-compare-human-panel";

test("a human-led candidate carries every interviewer's scorecard, attributed, with no user id on the wire", async () => {
  const e = createPipelineEntry({ candidateId: "cand-hp", candidateLabel: "Hedvika Panel", jobId: JOB, jobTitle: "Backend Engineer" });
  saveInterviewPrep(e.entry.id, "Hedvika Panel", "Backend Engineer", { scenario: "pair" });
  saveHumanScorecard(
    e.entry.id,
    { recommendation: "advance", summary: "round one", ratings: [{ competency: "Technical depth", rating: 5 }] },
    { author: "user-111", authorLabel: "Alena", stage: "interview" },
  );
  saveHumanScorecard(
    e.entry.id,
    { recommendation: "hold", summary: "round two", ratings: [{ competency: "Technical depth", rating: 2 }] },
    { author: "user-222", authorLabel: "Boris", stage: "interview-2" },
  );

  const res = await GET(new NextRequest(`http://localhost/api/interview/compare?job=${JOB}`));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { candidates: Record<string, unknown>[] };
  const c = body.candidates.find((x) => x.candidateLabel === "Hedvika Panel");
  assert.ok(c, "the human-led candidate is in the cohort");
  assert.equal(c.humanOnly, true);
  const cards = c.humanScorecards as { authorLabel: string | null; stage: string | null; legacy: boolean; recommendation?: string }[];
  assert.ok(Array.isArray(cards), "the grid gets the list, not one card");
  assert.deepEqual(
    cards.map((r) => [r.authorLabel, r.stage, r.legacy, r.recommendation]),
    [
      ["Boris", "interview-2", false, "hold"],
      ["Alena", "interview", false, "advance"],
    ],
    "both rounds, newest first",
  );
  assert.equal("humanScorecard" in c, false, "the single-card headline no longer rides the grid");
  const wire = JSON.stringify(body);
  assert.ok(!wire.includes("user-111") && !wire.includes("user-222"), "user ids stay off the compare wire");
});
