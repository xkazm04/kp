import { test } from "node:test";
import assert from "node:assert/strict";
import { interviewScoringState } from "./interview-scoring-state.ts";

test("interviewScoringState acceptance criterion 1: unscored, scoring, scored, not_scorable", () => {
  const now = 1_000_000_000_000;
  const tenMinAgo = new Date(now - 10 * 60 * 1000).toISOString();
  const sixtySecAgo = new Date(now - 60 * 1000).toISOString();

  // completed candidate session with transcript, no scorecard, ended > grace -> unscored
  assert.equal(
    interviewScoringState(
      { mode: "candidate", status: "completed", hasTranscript: true, hasScorecard: false, endedAt: tenMinAgo },
      now
    ),
    "unscored"
  );

  // ended within grace window -> scoring
  assert.equal(
    interviewScoringState(
      { mode: "candidate", status: "completed", hasTranscript: true, hasScorecard: false, endedAt: sixtySecAgo },
      now
    ),
    "scoring"
  );

  // hasScorecard true -> scored
  assert.equal(
    interviewScoringState(
      { mode: "candidate", status: "completed", hasTranscript: true, hasScorecard: true, endedAt: tenMinAgo },
      now
    ),
    "scored"
  );

  // mode test -> not_scorable
  assert.equal(
    interviewScoringState(
      { mode: "test", status: "completed", hasTranscript: true, hasScorecard: false, endedAt: tenMinAgo },
      now
    ),
    "not_scorable"
  );

  // status failed -> not_scorable
  assert.equal(
    interviewScoringState(
      { mode: "candidate", status: "failed", hasTranscript: true, hasScorecard: false, endedAt: tenMinAgo },
      now
    ),
    "not_scorable"
  );

  // hasTranscript false -> not_scorable
  assert.equal(
    interviewScoringState(
      { mode: "candidate", status: "completed", hasTranscript: false, hasScorecard: false, endedAt: tenMinAgo },
      now
    ),
    "not_scorable"
  );
});
