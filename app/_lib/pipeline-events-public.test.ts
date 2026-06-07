// Locks the public projection of the Activity feed (idea-4c41d103): the
// unauthenticated /api/pipeline/events payload must never carry a full
// candidate name, the internal entry id (an IDOR handle other entry-keyed
// routes accept), or the archetype. Identity is reduced to initials; the
// operational fields the feed verbs need (kind/stages/detail/time) survive.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { initialsLabel, toPublicPipelineEvent } from "./pipeline-events-public.ts";

test("initialsLabel reduces names to initials and never echoes the input", () => {
  assert.equal(initialsLabel("Marie Kovová"), "M. K.");
  assert.equal(initialsLabel("Jan"), "J.");
  assert.equal(initialsLabel("Jean-Claude van Damme"), "J. V."); // first two tokens only
  assert.equal(initialsLabel("  "), null);
  assert.equal(initialsLabel(null), null);
});

test("the public event shape drops entryId and archetype, keeps the operational fields", () => {
  const pub = toPublicPipelineEvent({
    id: 7,
    entryId: "pe_secret_internal",
    candidateLabel: "Marie Kovová",
    jobTitle: "Senior Backend Engineer",
    archetype: "BAU",
    kind: "rejected",
    fromStage: "Screened",
    toStage: "Screened",
    detail: "policy: score below floor",
    createdAt: "2026-06-07T10:00:00.000Z",
  });
  assert.deepEqual(pub, {
    id: 7,
    candidateLabel: "M. K.",
    jobTitle: "Senior Backend Engineer",
    kind: "rejected",
    fromStage: "Screened",
    toStage: "Screened",
    detail: "policy: score below floor",
    createdAt: "2026-06-07T10:00:00.000Z",
  });
  // The serialized payload must not contain the internal id or the full name.
  const json = JSON.stringify(pub);
  assert.ok(!json.includes("pe_secret_internal"));
  assert.ok(!json.includes("Kovová"));
  assert.ok(!json.includes("archetype"));
});
