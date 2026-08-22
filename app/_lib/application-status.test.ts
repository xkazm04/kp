import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  candidateStatusFor,
  classifyStatusError,
  isTerminalCandidateStatus,
  timelineIndex,
  CANDIDATE_TIMELINE,
} from "./application-status.ts";
import { DEFAULT_STAGE_AXIS } from "./pipeline-stages.ts";

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

// ---------------------------------------------------------------------------
// The stage-ROLE projection — the axis-independent half. A workspace composes its
// own columns (Settings → Hiring / the setup wizard), so the stage NAME map only
// covers the shipped axis; the role map is what keeps a renamed or invented
// column honest to the candidate.
// ---------------------------------------------------------------------------

test("the role map wins over the stage NAME, so a renamed column still reads honestly", () => {
  // "Final call" is nobody's shipped stage id — without the role it falls back to
  // `received` and tells an offer-stage candidate we merely got their CV.
  assert.equal(candidateStatusFor("active", "Final call", "offer"), "offer");
  assert.equal(candidateStatusFor("active", "Final call"), "received");
});

test("EVERY stage role a workspace can compose projects to something other than `received`", () => {
  // The bug this guards: `scoring` is a real, composable role (SETUP_STAGE_ROLES /
  // pipelineAxisDraft offer it) that was ABSENT from the role map, and its column
  // id is whatever the workspace typed — so it missed the name map too and a
  // candidate who had already finished an AI interview was told "Application
  // received". Derive the vocabulary from pipeline-stages.ts itself so a role
  // added there can never again be silently unmapped here.
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "pipeline-stages.ts"), "utf8");
  const union = /export type StageRole =([^;]+);/.exec(src);
  assert.ok(union, "could not read the StageRole vocabulary from pipeline-stages.ts");
  const roles = [...union[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(roles.length >= 7, `expected the full role vocabulary, got ${JSON.stringify(roles)}`);
  assert.ok(roles.includes("scoring"), "the regression this test exists for");
  for (const role of roles) {
    // An id no map knows, so ONLY the role can answer.
    const projected = candidateStatusFor("active", "Kolo 2", role);
    if (role === "entry") {
      assert.equal(projected, "received", "the entry column is the one honest `received`");
    } else {
      assert.notEqual(projected, "received", `stage role "${role}" is unmapped — it understates to "received"`);
    }
  }
});

test("the role map and the stage-NAME map agree on the shipped axis", () => {
  // The module comment claims this; pin it. Both maps must answer identically for
  // every default column, or a workspace that has not touched its axis would see
  // one answer before an edit and another after.
  for (const stage of DEFAULT_STAGE_AXIS) {
    assert.equal(
      candidateStatusFor("active", stage.id, stage.role),
      candidateStatusFor("active", stage.id),
      `the two maps disagree on the shipped stage "${stage.id}" (role "${stage.role}")`
    );
  }
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
