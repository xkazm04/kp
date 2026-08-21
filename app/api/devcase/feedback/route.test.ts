// TENANCY pin for the candidate-feedback door, driven through the REAL route handler.
//
// The defect: `getSubmission(body.submissionId)` is a by-id point read on a globally-unique
// id, so a submission belonging to ANOTHER team came back unguarded — and `recordOutbox`
// then files the drafted letter under `sub.workspaceId`. A foreign id therefore planted a
// candidate-facing letter (that team's candidate by name, with their strengths and growth
// areas) into THAT team's outbox, sitting there ready for their recruiter to dispatch —
// a message they never wrote about a candidate the caller cannot even see. The sibling
// door, `/api/devcase/promote`, already refuses a foreign submission with the same
// one-line ownership check (devcase-source-promote-tenancy.test.ts).
//
// The handler takes its tenant from currentWorkspace(), which reads cookies() — that
// throws outside a request and falls back to the DEFAULT workspace, so the caller here
// IS the default team and a submission owned by anyone else must be refused.
//
// unit-db.ts MUST be the first project import (sets KP_DB_PATH before any store resolves).
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// Point next/server at the test shim BEFORE the route loads (hooks only affect LATER
// resolutions — hence the dynamic imports below).
register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const { saveDevCase, createPosting, createSubmission, saveSubmissionEvaluation, listOutbox } = await import(
  "../../../_lib/db/devcase.ts"
);
const { DEFAULT_WORKSPACE_ID } = await import("../../../_lib/db/workspaces.ts");
const { POST } = await import("./route.ts");

after(() => cleanupUnitDb());

const WS_THEIRS = "ws-feedback-beta";

let seedN = 0;
/** A whole case → posting → EVALUATED submission chain owned by `ws`; each child
 *  inherits its parent's workspace, so nothing leaks into the default tenant. */
function seedEvaluatedSubmission(ws: string, candidate: string): string {
  const dc = saveDevCase({ need: {}, analysis: {}, role: { title: "Backend Engineer" }, case: { title: "API case" } }, ws);
  const posting = createPosting({
    caseId: dc.id,
    channel: "link",
    token: `tok-feedback-${++seedN}`,
    roleTitle: "Backend Engineer",
    caseTitle: "API case",
  });
  const { submission } = createSubmission({
    postingId: posting.id,
    candidateRef: candidate,
    repoRef: `https://example.test/${candidate}`,
    contact: `${candidate}@example.test`,
  });
  saveSubmissionEvaluation(
    submission.id,
    { evaluation: { strengths: ["clear tests"], concerns: ["thin error handling"] }, transfer: { gaps: ["observability"] } },
    62
  );
  return submission.id;
}

test("drafting feedback for ANOTHER team's submission is refused, and writes nothing to their outbox", async () => {
  const theirs = seedEvaluatedSubmission(WS_THEIRS, "dana");

  const res = await POST(
    new Request("http://localhost/api/devcase/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submissionId: theirs }),
    }) as never
  );

  // Pre-fix this was 200 and the letter landed in ws-feedback-beta's outbox.
  assert.equal(res.status, 404, "a known submission id from another team must not be actionable");
  assert.equal(
    listOutbox(20, WS_THEIRS).some((m) => m.kind === "feedback"),
    false,
    "no letter about their candidate may be planted in their outbox"
  );
});

test("drafting feedback for your OWN team's submission still queues it (the guard is not over-broad)", async () => {
  const mine = seedEvaluatedSubmission(DEFAULT_WORKSPACE_ID, "ada");

  const res = await POST(
    new Request("http://localhost/api/devcase/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submissionId: mine }),
    }) as never
  );

  assert.equal(res.status, 200);
  const queued = listOutbox(20, DEFAULT_WORKSPACE_ID).filter((m) => m.kind === "feedback" && m.ref === mine);
  assert.equal(queued.length, 1, "the owning team gets exactly one queued brief");
  assert.equal(queued[0]?.status, "queued", "queued, not sent — the recruiter dispatches it");
});
