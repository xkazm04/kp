// Unit and acceptance tests for POST /api/devcase/source (Challenge r10 devcase-detail/B)
//
// Tests:
// 1. Preview mode: POST {caseId, preview: true} returns candidate rows with onBoard status,
//    does not write pipeline entries, does not rewrite outcome.
// 2. Commit mode: POST {caseId, candidateIds: [p1]} files only p1 at Accepted with
//    sourceChannel 'devcase', answers {added: 1, alreadyOnBoard: 0, dropped: []}.
// 3. Re-ranking dropped: POST {caseId, candidateIds: [p1, gone]} returns dropped: ['gone'].
// 4. seedPipelineFromMatches idempotency: returns {added: 0, alreadyOnBoard: 2} on repeat.
// 5. Validation refusals: invalid candidateIds returns 400 DEVCASE_SOURCE_SELECTION_INVALID.
// 6. Source pick helpers: defaultPicks and commitSummary correctness.
// 7. Source guard: UI components open DevSourcePreview instead of blind POST.

import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { register } from "node:module";
import type { NextRequest } from "next/server";

// Point next/server at the test shim BEFORE the route loads.
register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const { saveDevCase } = await import("../../../_lib/db/devcase.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../../../_lib/db/workspaces.ts");
const { createPipelineEntry, listEntriesForJob } = await import("../../../_lib/db/pipeline.ts");
const { seedPipelineFromMatches } = await import("../../../_lib/devcase-run.ts");
const { caseJobIdentity } = await import("../../../_lib/devcase-identity.ts");
const { defaultPicks, commitSummary } = await import("../../../_lib/devcase-source-pick.ts");
const { REFUSAL_ERRORS } = await import("../../../_lib/api-response.ts");
const { POST } = await import("./route.ts");

after(() => cleanupUnitDb());

function postReq(body: unknown): NextRequest {
  return new Request("http://localhost/api/devcase/source", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

test("acceptance 1: POST /api/devcase/source {caseId, preview: true} previews without writing", async () => {
  const kase = saveDevCase(
    {
      need: {},
      analysis: {},
      role: { title: "Senior Backend Engineer" },
      case: { title: "Distributed Cache" },
    },
    DEFAULT_WORKSPACE_ID
  );

  const identity = caseJobIdentity({
    caseId: kase.id,
    jobId: kase.jobId ?? null,
    jobTitle: null,
    roleTitle: "Senior Backend Engineer",
  });

  // Pre-seed one candidate on the job board (p2)
  createPipelineEntry({
    candidateId: "p2",
    candidateLabel: "Bob Smith",
    jobId: identity.jobId,
    jobTitle: identity.jobTitle,
    stage: "Screen",
    workspaceId: DEFAULT_WORKSPACE_ID,
  });

  // Stub matcher returning 3 candidates
  const stubCandidates = [
    { candidateId: "p1", label: "Alice Johnson", archetype: "builder", score: 85, matchedSkills: ["Node.js", "Redis"] },
    { candidateId: "p2", label: "Bob Smith", archetype: "specialist", score: 92, matchedSkills: ["TypeScript", "Distributed Systems"] },
    { candidateId: "p3", label: "Charlie Brown", archetype: "generalist", score: 78, matchedSkills: ["PostgreSQL"] },
  ];

  (globalThis as { __kpStubSourceForRole?: unknown }).__kpStubSourceForRole = () =>
    Promise.resolve({ candidates: stubCandidates, skipped: 0, skippedReasons: [] });

  const entriesBefore = listEntriesForJob(identity.jobId, DEFAULT_WORKSPACE_ID);
  assert.equal(entriesBefore.length, 1);

  const res = await POST(postReq({ caseId: kase.id, preview: true }));
  assert.equal(res.status, 200);

  const body = (await res.json()) as {
    ok: boolean;
    preview: boolean;
    candidates: Array<{
      candidateId: string;
      label: string;
      archetype?: string;
      score?: number;
      matchedSkills?: string[];
      onBoard?: { status: string; stage?: string } | null;
    }>;
    skipped: number;
    skippedReasons: unknown[];
  };

  assert.equal(body.ok, true);
  assert.equal(body.preview, true);
  assert.equal(body.candidates.length, 3);
  assert.equal(body.skipped, 0);

  // p2 is already on board
  const p2Row = body.candidates.find((c) => c.candidateId === "p2");
  assert.ok(p2Row?.onBoard);
  assert.equal(p2Row.onBoard.status, "active");
  assert.equal(p2Row.onBoard.stage, "Screen");

  // p1 and p3 are not on board
  const p1Row = body.candidates.find((c) => c.candidateId === "p1");
  assert.equal(p1Row?.onBoard, null);
  const p3Row = body.candidates.find((c) => c.candidateId === "p3");
  assert.equal(p3Row?.onBoard, null);

  // Row count in pipeline_entries is unchanged
  const entriesAfter = listEntriesForJob(identity.jobId, DEFAULT_WORKSPACE_ID);
  assert.equal(entriesAfter.length, 1, "preview must NOT write to pipeline_entries");
});

test("acceptance 2: POST {caseId, candidateIds: [p1]} files only p1 at Accepted", async () => {
  const kase = saveDevCase(
    {
      need: {},
      analysis: {},
      role: { title: "Lead Architect" },
      case: { title: "Event Sourcing" },
    },
    DEFAULT_WORKSPACE_ID
  );

  const identity = caseJobIdentity({
    caseId: kase.id,
    jobId: kase.jobId ?? null,
    jobTitle: null,
    roleTitle: "Lead Architect",
  });

  const stubCandidates = [
    { candidateId: "p1", label: "Alice Johnson", archetype: "builder", score: 88, matchedSkills: ["Kafka"] },
    { candidateId: "p2", label: "Bob Smith", archetype: "specialist", score: 80, matchedSkills: ["Go"] },
  ];

  (globalThis as { __kpStubSourceForRole?: unknown }).__kpStubSourceForRole = () =>
    Promise.resolve({ candidates: stubCandidates, skipped: 0, skippedReasons: [] });

  const res = await POST(postReq({ caseId: kase.id, candidateIds: ["p1"] }));
  assert.equal(res.status, 200);

  const body = (await res.json()) as {
    ok: boolean;
    added: number;
    alreadyOnBoard: number;
    dropped: string[];
  };

  assert.equal(body.ok, true);
  assert.equal(body.added, 1);
  assert.equal(body.alreadyOnBoard, 0);
  assert.deepEqual(body.dropped, []);

  const entries = listEntriesForJob(identity.jobId, DEFAULT_WORKSPACE_ID);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].candidateId, "p1");
  assert.equal(entries[0].stage, "Accepted");
  assert.equal(entries[0].sourceChannel, "devcase");
});

test("acceptance 3: POST {caseId, candidateIds: [p1, gone]} drops candidates not in fresh ranking", async () => {
  const kase = saveDevCase(
    {
      need: {},
      analysis: {},
      role: { title: "Security Engineer" },
      case: { title: "Auth Protocol" },
    },
    DEFAULT_WORKSPACE_ID
  );

  // Fresh ranking only includes p1 (gone was deleted or fell below floor)
  const stubCandidates = [
    { candidateId: "p1", label: "Alice Johnson", archetype: "builder", score: 90, matchedSkills: ["OAuth"] },
  ];

  (globalThis as { __kpStubSourceForRole?: unknown }).__kpStubSourceForRole = () =>
    Promise.resolve({ candidates: stubCandidates, skipped: 0, skippedReasons: [] });

  const res = await POST(postReq({ caseId: kase.id, candidateIds: ["p1", "gone"] }));
  assert.equal(res.status, 200);

  const body = (await res.json()) as {
    ok: boolean;
    added: number;
    alreadyOnBoard: number;
    dropped: string[];
  };

  assert.equal(body.ok, true);
  assert.equal(body.added, 1);
  assert.deepEqual(body.dropped, ["gone"]);
});

test("acceptance 4: seedPipelineFromMatches accurately counts created:true vs alreadyOnBoard", () => {
  const matches = [
    { candidateId: "dup-1", label: "Dev 1", archetype: "builder", score: 85 },
    { candidateId: "dup-2", label: "Dev 2", archetype: "specialist", score: 80 },
  ];

  const opts = {
    caseId: "dc-dup-test",
    roleTitle: "Staff Engineer",
    workspaceId: DEFAULT_WORKSPACE_ID,
  };

  // First seed -> added: 2, alreadyOnBoard: 0
  const first = seedPipelineFromMatches(matches as never, opts);
  assert.equal(first.added, 2);
  assert.equal(first.alreadyOnBoard, 0);

  // Second seed -> added: 0, alreadyOnBoard: 2
  const second = seedPipelineFromMatches(matches as never, opts);
  assert.equal(second.added, 0);
  assert.equal(second.alreadyOnBoard, 2);
});

test("acceptance 5: invalid candidateIds payloads return 400 DEVCASE_SOURCE_SELECTION_INVALID", async () => {
  const kase = saveDevCase(
    {
      need: {},
      analysis: {},
      role: { title: "Dev" },
      case: { title: "Case" },
    },
    DEFAULT_WORKSPACE_ID
  );

  const invalidPayloads = [
    { caseId: kase.id, candidateIds: [] },
    { caseId: kase.id, candidateIds: [""] },
    { caseId: kase.id, candidateIds: ["   "] },
    { caseId: kase.id, candidateIds: [123] },
    { caseId: kase.id, candidateIds: "p1" },
    { caseId: kase.id, candidateIds: {} },
  ];

  for (const payload of invalidPayloads) {
    const res = await POST(postReq(payload));
    assert.equal(res.status, 400, `payload ${JSON.stringify(payload)} should return 400`);
    const body = (await res.json()) as { code: string };
    assert.equal(body.code, "DEVCASE_SOURCE_SELECTION_INVALID");
  }

  // Refusal error code is registered in REFUSAL_ERRORS
  assert.ok("DEVCASE_SOURCE_SELECTION_INVALID" in REFUSAL_ERRORS);
});

test("acceptance 6: devcase-source-pick defaultPicks and commitSummary logic", () => {
  const rows = [
    { candidateId: "c1", label: "Cand 1", onBoard: null },
    { candidateId: "c2", label: "Cand 2", onBoard: { status: "active" } },
    { candidateId: "c3", label: "Cand 3", onBoard: null },
  ];
  assert.deepEqual(defaultPicks(rows), ["c1", "c3"]);

  assert.equal(commitSummary({ added: 2, alreadyOnBoard: 1, dropped: [] }).key, "filed");
  assert.equal(commitSummary({ added: 0, alreadyOnBoard: 2, dropped: [] }).key, "nothingNew");
  assert.equal(commitSummary({ added: 0, alreadyOnBoard: 0, dropped: ["c1"] }).key, "dropped");
});

test("acceptance 7: source guard - DevLifecycleRow and DevCaseDetailHeader open DevSourcePreview", () => {
  const root = path.resolve(import.meta.dirname, "../../../features/tools/devcases");
  const headerSrc = readFileSync(path.join(root, "DevCaseDetailHeader.tsx"), "utf8");
  const rowSrc = readFileSync(path.join(root, "DevLifecycleRow.tsx"), "utf8");

  // Neither file makes a raw POST to /api/devcase/source
  assert.doesNotMatch(
    headerSrc,
    /fetch\(\s*["']\/api\/devcase\/source["']/,
    "DevCaseDetailHeader must not make raw fetch to /api/devcase/source"
  );
  assert.doesNotMatch(
    rowSrc,
    /fetch\(\s*["']\/api\/devcase\/source["']/,
    "DevLifecycleRow must not make raw fetch to /api/devcase/source"
  );

  // Both reference DevSourcePreview
  assert.match(headerSrc, /<DevSourcePreview\b/, "DevCaseDetailHeader must render DevSourcePreview");
  assert.match(rowSrc, /<DevSourcePreview\b/, "DevLifecycleRow must render DevSourcePreview");
});
