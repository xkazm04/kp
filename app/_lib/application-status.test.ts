import { test } from "node:test";
import assert from "node:assert/strict";
import {
  candidateStatusFor,
  isTerminalCandidateStatus,
  timelineIndex,
  CANDIDATE_TIMELINE,
} from "./application-status.ts";

test("candidateStatusFor maps each live stage", () => {
  assert.equal(candidateStatusFor("active", "Accepted"), "received");
  assert.equal(candidateStatusFor("active", "Screened"), "under_review");
  assert.equal(candidateStatusFor("active", "Interview"), "interview");
  assert.equal(candidateStatusFor("active", "Offer"), "offer");
  assert.equal(candidateStatusFor("active", "Hired"), "hired");
});

test("candidateStatusFor maps terminal statuses regardless of stage", () => {
  assert.equal(candidateStatusFor("rejected", "Screened"), "not_selected");
  assert.equal(candidateStatusFor("rematched", "Interview"), "not_selected");
  assert.equal(candidateStatusFor("declined", "Offer"), "withdrawn");
});

test("candidateStatusFor falls back to received on an unknown stage", () => {
  assert.equal(candidateStatusFor("active", "Nonsense"), "received");
});

test("terminal + timeline helpers", () => {
  assert.equal(isTerminalCandidateStatus("hired"), true);
  assert.equal(isTerminalCandidateStatus("not_selected"), true);
  assert.equal(isTerminalCandidateStatus("withdrawn"), true);
  assert.equal(isTerminalCandidateStatus("interview"), false);
  assert.equal(timelineIndex("interview"), 2);
  assert.equal(timelineIndex("not_selected"), -1); // off the happy path
  assert.equal(CANDIDATE_TIMELINE.length, 5);
});
