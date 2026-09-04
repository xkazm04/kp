// A pipeline write on a role invalidates that role's cached group evaluations.
//
// The eval cache is a plain row keyed (role_key, workspace_id) with NO ttl and NO
// invalidation — `grep -n "ttl|expire|invalidat"` over group-eval*.ts found nothing.
// A selection eval ("compare these four") is cached under `<role>#sel:<n>-<hash>`,
// which is stable across pipeline writes by construction: the same four entry ids
// hash the same however far those candidates have since moved. So a recruiter who
// rejected two of the four, reopened the identical selection and was served the
// cached comparison saw a lead crowned over a field that no longer existed — and
// the modal's pool-drift diff (`evaluatedLabels` vs the live pending entries) only
// DISCLOSES the drift; it never expires the row.
//
// The cache lives in the group-eval store, and db/pipeline.ts must not import it,
// so the seam is an exported `invalidateGroupEvalSelection` that the entry-action
// layer calls after a successful write.
//
// unit-db.ts MUST be the FIRST project import. Run: npm run test:unit
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";

const { saveGroupEval, getGroupEval, invalidateGroupEvalSelection } = await import("./group-eval.ts");
const { selectionCacheKey } = await import("@/app/features/hiring/decisions/groupEval/cache-key");
const { createPipelineEntry, getPipelineEntry } = await import("./db/pipeline.ts");
const { runPipelineEntryAction } = await import("./pipeline-entry-action.ts");

after(() => cleanupUnitDb());

const payload = (marker: string) => ({ marker });

test("invalidating a role drops its top-N row AND every selection row for it", () => {
  const role = "inv-role";
  const selA = selectionCacheKey(role, ["e1", "e2"]);
  const selB = selectionCacheKey(role, ["e2", "e3", "e4"]);
  saveGroupEval(role, "Role", payload("topN"));
  saveGroupEval(selA, "Role", payload("selA"));
  saveGroupEval(selB, "Role", payload("selB"));
  saveGroupEval("inv-other-role", "Other", payload("other"));

  const dropped = invalidateGroupEvalSelection(role);

  assert.equal(dropped, 3, "the bare role row and both selection rows");
  assert.equal(getGroupEval(role), null);
  assert.equal(getGroupEval(selA), null, "a selection key is stable across pipeline writes — it MUST be invalidated explicitly");
  assert.equal(getGroupEval(selB), null);
  assert.ok(getGroupEval("inv-other-role"), "an unrelated role keeps its eval");
});

test("invalidation is scoped to one tenant", () => {
  const role = "inv-tenant-role";
  saveGroupEval(role, "Role", payload("a"), "workspace");
  saveGroupEval(role, "Role", payload("b"), "ws-other");

  invalidateGroupEvalSelection(role, "workspace");

  assert.equal(getGroupEval(role, "workspace"), null);
  assert.ok(getGroupEval(role, "ws-other"), "another team's eval of the same role key is not theirs to expire");
});

test("a role key containing LIKE wildcards cannot wipe unrelated rows", () => {
  // roleKeyOf falls back to the job TITLE, which is free text — "Data % Analyst"
  // or "senior_dev" are legal role keys, and an unescaped LIKE pattern built from
  // them would match half the table.
  saveGroupEval("inv-a%b", "Role", payload("wild"));
  saveGroupEval("inv-axb", "Role", payload("innocent"));
  saveGroupEval("inv-a_b", "Role", payload("underscore"));

  const dropped = invalidateGroupEvalSelection("inv-a%b");

  assert.equal(dropped, 1, "only the literal key matches");
  assert.equal(getGroupEval("inv-a%b"), null);
  assert.ok(getGroupEval("inv-axb"), "% must not be treated as a wildcard");
  assert.ok(getGroupEval("inv-a_b"), "_ must not be treated as a wildcard");
});

test("invalidating a role with no cached eval is a no-op, not an error", () => {
  assert.equal(invalidateGroupEvalSelection("inv-never-evaluated"), 0);
});

// ---- the hook: a pipeline write actually calls it ---------------------------

test("moving a candidate through the pipeline expires that role's cached evaluations", async () => {
  const jobId = "inv-hook-job";
  const entry = createPipelineEntry({
    candidateId: "inv-hook-c1",
    candidateLabel: "Hook Candidate",
    jobId,
    jobTitle: "Hook Role",
    stage: "Applied",
  }).entry;
  // roleKeyOf = jobId ?? jobTitle ?? "unassigned" (decisionsQueueTypes.ts).
  const sel = selectionCacheKey(jobId, [entry.id, "inv-hook-e2"]);
  saveGroupEval(jobId, "Hook Role", payload("topN"));
  saveGroupEval(sel, "Hook Role", payload("selection"));

  const res = await runPipelineEntryAction({
    id: entry.id,
    action: "set_stage",
    toStage: "Interview",
    origin: "http://localhost:3000",
    workspaceId: "workspace",
  });

  assert.equal(res.status, 200, `the move itself must succeed: ${JSON.stringify(res.body)}`);
  assert.equal(getPipelineEntry(entry.id)!.stage, "Interview");
  assert.equal(getGroupEval(jobId), null, "the role's top-N eval ranked a cohort that has now moved");
  assert.equal(getGroupEval(sel), null, "and the selection eval, whose key survives the move unchanged");
});

test("a pipeline write on one role leaves another role's eval alone", async () => {
  const entry = createPipelineEntry({
    candidateId: "inv-hook-c2",
    candidateLabel: "Other Candidate",
    jobId: "inv-hook-job-2",
    jobTitle: "Hook Role 2",
    stage: "Applied",
  }).entry;
  saveGroupEval("inv-untouched-job", "Untouched", payload("keep"));

  await runPipelineEntryAction({
    id: entry.id,
    action: "set_stage",
    toStage: "Interview",
    origin: "http://localhost:3000",
    workspaceId: "workspace",
  });

  assert.ok(getGroupEval("inv-untouched-job"), "invalidation must be keyed to the role that actually changed");
});
