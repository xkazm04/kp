import { test } from "node:test";
import assert from "node:assert/strict";
import {
  candidateStatusFor,
  classifyStatusError,
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
  // role_closed (the role was filled/closed) reads as not_selected, not withdrawn —
  // the candidate didn't pull out; the role is simply no longer open to them (JOB2).
  assert.equal(candidateStatusFor("role_closed", "Interview"), "not_selected");
  assert.equal(candidateStatusFor("declined", "Offer"), "withdrawn");
});

test("candidateStatusFor falls back to received on an unknown stage", () => {
  assert.equal(candidateStatusFor("active", "Nonsense"), "received");
});

test("classifyStatusError distinguishes an invalid/expired link from a retryable fault", () => {
  // A bad/expired token (the route's 404) is a PERMANENT, link-level problem —
  // it must NOT read as a transient error the candidate should retry.
  assert.equal(classifyStatusError(404), "invalid");
  assert.equal(classifyStatusError(410), "invalid");
  assert.equal(classifyStatusError(400), "invalid");
  // Transient faults are retryable: no response at all (offline), 5xx, back-pressure.
  assert.equal(classifyStatusError(null), "retryable");
  assert.equal(classifyStatusError(500), "retryable");
  assert.equal(classifyStatusError(503), "retryable");
  assert.equal(classifyStatusError(408), "retryable");
  assert.equal(classifyStatusError(429), "retryable");
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
