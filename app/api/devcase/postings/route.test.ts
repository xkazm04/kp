// challenge-r02 devcase-eval/B — the postings GET carries each EVALUATED submission's
// promote verdict (`promotePreview`) at the server's calibrated floor, so the EvalPanel
// shows advance-or-hold BEFORE the Promote click. An unevaluated submission carries no
// preview key at all: there is nothing to promote, and an absent score must not read as
// a hold computed on a 0.
//
// testing/unit-db.ts MUST be the first project import (it sets KP_DB_PATH).
import { cleanupUnitDb } from "@/app/_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createPosting, createSubmission, saveSubmissionEvaluation } from "@/app/_lib/db.ts";
import { activePromoteFloor } from "@/app/_lib/devcase-orchestrator.ts";
import { promoteVerdict, promoteVerdictInputOf } from "@/app/_lib/devcase-promote-verdict.ts";
import { GET } from "./route.ts";

after(() => cleanupUnitDb());

test("an evaluated submission carries promotePreview; an unevaluated one carries no key", async () => {
  const posting = createPosting({
    caseId: "case-preview",
    channel: "local",
    token: "tok-preview",
    roleTitle: "Backend Engineer",
    caseTitle: "Preview case",
  });
  const { submission: evaluated } = createSubmission({ postingId: posting.id, candidateRef: "Eva", repoRef: "repo-eva" });
  const { submission: pending } = createSubmission({ postingId: posting.id, candidateRef: "Pat", repoRef: "repo-pat" });
  const bundle = {
    evaluation: { summary: "ok", strengths: [], concerns: [], confidence: 0.3 },
    transfer: { transferScore: 91, roleFitRationale: "fit" },
    authenticity: { band: "suspect", score: 22 },
  };
  saveSubmissionEvaluation(evaluated.id, bundle, 91);

  const res = await GET();
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    postings: Array<{ id: string; submissions: Array<Record<string, unknown> & { id: string }> }>;
  };
  const subs = body.postings.find((p) => p.id === posting.id)!.submissions;
  const ev = subs.find((s) => s.id === evaluated.id)!;
  const pe = subs.find((s) => s.id === pending.id)!;

  assert.deepEqual(ev.promotePreview, promoteVerdict(promoteVerdictInputOf(bundle, 91, activePromoteFloor())));
  assert.equal((ev.promotePreview as { recommendation: string }).recommendation, "hold");
  assert.ok(!("promotePreview" in pe), "no preview for a submission nothing has evaluated");
});
