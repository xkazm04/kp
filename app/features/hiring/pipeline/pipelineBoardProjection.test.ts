// board-poll-carries-only-what-it-draws — GET /api/pipeline projects each stamped
// store row through BOARD_ENTRY_FIELDS instead of serializing the row verbatim.
//
// The allowlist is pinned by NAME here, and the omissions are named too. That
// direction matters more than the count: rowToEntry fills every PipelineEntry field
// whether or not listPipeline's SELECT asked for the column, so before this
// projection existed a column added to `pipeline_entries` reached the browser by
// default. `contact` (the candidate's email/phone) is the one worth stating out
// loud — it was null on this payload only because the SELECT omits it, which is an
// accident of the query, not a contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOARD_ENTRY_FIELDS, boardEntryView } from "@/app/_lib/db/pipeline.ts";
import type { PipelineEntry } from "@/app/_lib/db/core.ts";

// Every field the store row carries, all non-null, so an omission cannot hide behind
// a null the projection would have produced anyway.
const storeRow = {
  id: "e1",
  candidateId: "c1",
  candidateLabel: "Ada Lovelace",
  archetype: "switcher",
  roleFamily: "backend",
  jobId: "j1",
  jobTitle: "Backend Engineer",
  stage: "Interview",
  matchScore: 78,
  status: "active",
  approvalKind: "scorecard_review",
  approvalDetail: '{"recommendation":"advance"}',
  createdAt: "2026-01-01T00:00:00.000Z",
  stageChangedAt: "2026-02-01T00:00:00.000Z",
  intakeDegraded: false,
  intakeDegradedReason: null,
  contact: "ada@example.com",
  locale: "cs",
  githubEvidence: null,
  githubHandle: "ada",
  sourceChannel: "sourcing",
  sourceCampaign: "spring",
  sourceVariant: "b",
  devCaseId: "dc-1",
  devSubmissionId: "ds-1",
  notes: "Called Tuesday.",
  consentGivenAt: "2026-01-02T00:00:00.000Z",
  consentExpiresAt: "2027-01-02T00:00:00.000Z",
  consentSource: "apply",
  anonymizedAt: null,
  workspaceId: "ws-a",
} as unknown as PipelineEntry;

const stamped = { ...storeRow, canonicalScore: 81, scoreProvenance: { source: "analysis" }, transferScore: 64 } as never;

// What the board payload must NOT carry. Each was checked against every consumer of
// GET /api/pipeline — the board, the drawer, the bulk bar, the off-axis strip, the
// Decisions queue, the Schedule grid, the Channels tab, the simulation engine, the
// jobs lifecycle strip and the interview attach dialog — and none of them reads one.
const OMITTED = [
  "contact",
  "locale",
  "workspaceId",
  "consentGivenAt",
  "consentExpiresAt",
  "consentSource",
  "anonymizedAt",
  "devCaseId",
  "devSubmissionId",
];

test("the board view carries exactly the allowlist plus the three stamped scores", () => {
  const view = boardEntryView(stamped);
  assert.deepEqual(
    Object.keys(view).sort(),
    [...BOARD_ENTRY_FIELDS, "canonicalScore", "scoreProvenance", "transferScore"].sort()
  );
});

test("no unread store column reaches the wire — contact above all", () => {
  const view = boardEntryView(stamped) as Record<string, unknown>;
  for (const field of OMITTED) {
    assert.equal(field in view, false, `${field} must not ride the board payload`);
    assert.equal(field in storeRow, true, `${field} is expected to exist on the store row`);
  }
});

test("every field a consumer reads survives, with its value", () => {
  const view = boardEntryView(stamped) as Record<string, unknown>;
  // The drawer hydrates its scratchpad and evidence card from the board-opened entry;
  // the Decisions queue and the Schedule grid both parse approvalDetail. These three
  // are the expensive fields and they stay, because dropping them would break a read.
  assert.equal(view.notes, "Called Tuesday.");
  assert.equal(view.approvalDetail, '{"recommendation":"advance"}');
  assert.equal(view.githubHandle, "ada");
  assert.equal(view.sourceCampaign, "spring");
  assert.equal(view.canonicalScore, 81);
  assert.equal(view.transferScore, 64);
});

test("a row with no stamps still answers the three score fields, as null", () => {
  const view = boardEntryView(storeRow as never) as Record<string, unknown>;
  assert.equal(view.canonicalScore, null);
  assert.equal(view.scoreProvenance, null);
  assert.equal(view.transferScore, null);
});
