// The postings view: ONE enrichment shared by the workspace postings route and the
// assignment detail's own channels route (challenge-r09 devcase-lifecycle/A). Submissions
// inlined, each carrying its latest recorded outcome and - when evaluated - the promote
// verdict at the server's floor; each posting carrying its in-flight counts.
//
// testing/unit-db.ts MUST be the first project import (it sets KP_DB_PATH).
import { cleanupUnitDb } from "@/app/_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createPosting, createSubmission, saveDevCase, saveSubmissionEvaluation, startDevSession } from "@/app/_lib/db/devcase.ts";
import { DEFAULT_WORKSPACE_ID } from "@/app/_lib/db/workspaces.ts";
import { recordOutcome } from "@/app/_lib/dev-outcomes.ts";
import { activePromoteFloor } from "@/app/_lib/devcase-orchestrator.ts";
import { promoteVerdict, promoteVerdictInputOf } from "@/app/_lib/devcase-promote-verdict.ts";
import { listCasePostings } from "@/app/_lib/db/devcase-case-postings.ts";
import { postingsView } from "./devcase-postings-view.ts";

after(() => cleanupUnitDb());

const ws = DEFAULT_WORKSPACE_ID;
const caseId = saveDevCase({ need: { title: "View" }, analysis: null, role: { title: "Engineer" }, case: { title: "View" } }, ws).id;
const busy = createPosting({ caseId, channel: "careers", token: "tok-view-busy", roleTitle: "Engineer", caseTitle: "View" });
const quiet = createPosting({ caseId, channel: "linkedin", token: "tok-view-quiet", roleTitle: "Engineer", caseTitle: "View" });
const { submission: evaluated } = createSubmission({ postingId: busy.id, candidateRef: "Eva", repoRef: "repo-eva" });
const { submission: pending } = createSubmission({ postingId: busy.id, candidateRef: "Pat", repoRef: "repo-pat" });
const bundle = {
  evaluation: { summary: "ok", strengths: [], concerns: [], confidence: 0.9 },
  transfer: { transferScore: 88, roleFitRationale: "fit" },
  authenticity: { band: "clean", score: 90 },
};
saveSubmissionEvaluation(evaluated.id, bundle, 88);
recordOutcome({ ref: pending.id, candidateRef: "Pat", outcome: "rejected" }, ws);
const live = startDevSession({ token: "tok-view-busy", candidateRef: "live-zz" });

test("submissions are inlined with outcome and (only when evaluated) a promote preview", () => {
  const view = postingsView(listCasePostings(caseId, ws), ws);
  const b = view.find((p) => p.id === busy.id);
  assert.ok(b);
  const ev = b.submissions.find((s) => s.id === evaluated.id)!;
  const pe = b.submissions.find((s) => s.id === pending.id)!;
  assert.deepEqual(ev.promotePreview, promoteVerdict(promoteVerdictInputOf(bundle, 88, activePromoteFloor())));
  assert.ok(!("promotePreview" in pe), "no preview for a submission nothing has evaluated");
  assert.equal(pe.outcome?.outcome, "rejected");
  assert.ok(!("outcome" in ev), "no outcome key when none was recorded");
});

test("every posting carries inFlight: counts on the busy one, zeros (not an absent key) on the quiet one", () => {
  const view = postingsView(listCasePostings(caseId, ws), ws);
  assert.deepEqual(view.find((p) => p.id === busy.id)?.inFlight, { live: 1, idle: 0, oldestLiveStartedAt: live.createdAt });
  assert.deepEqual(view.find((p) => p.id === quiet.id)?.inFlight, { live: 0, idle: 0, oldestLiveStartedAt: null });
  assert.deepEqual(view.find((p) => p.id === quiet.id)?.submissions, []);
});

test("an empty list stays empty and reads nothing else", () => {
  assert.deepEqual(postingsView([], ws), []);
});
