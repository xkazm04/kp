// The arrival hooks ask the SEND GATE before they mint (challenge-r09
// comms-locale-optout/A).
//
// Both post-commit arrival hooks used to ask addressability only before minting: a
// candidate whose consent had lapsed (but whom the sweep had not yet anonymized) still
// carried a contact, so the AI-interview hook burned a grounding build and reserved voice
// minutes, and the homework hook published a live apply token — and only then did
// `sendComm` refuse the letter.
//
// The AI-interview refusal is NOT a silent skip: like `unaddressable`, a suppressed
// arrival is parked on the `calendar` gate (the Schedule tab's AI-round docket), so a
// human SEES the candidate and whoever then tries to mint is refused with the coded 409.
//
// unit-db.ts MUST be the first project import.
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry, getPipelineEntry } from "./db/pipeline.ts";
import { ensureDb } from "./db/core.ts";
import { listRecentInterviewSessions } from "./db/interviews.ts";
import { getOpenPosting, listOutboxFiltered, saveDevCase } from "./db/devcase.ts";
import { saveJd } from "./db/jobs.ts";
import { insertJob } from "./job-ingest.ts";
import { jdJobId } from "./jd-limits.ts";
import { setDecisionConfig } from "./decision-config-store.ts";
import { runStageEnteredHook } from "./stage-hooks.ts";
import type { JobRecord } from "./db/core.ts";

after(() => cleanupUnitDb());

before(() => {
  // A configured voice provider, so a NON-suppressed control is actually minted.
  process.env.OPENAI_API_KEY = "test-key-not-used-for-any-call";
});

const WS_IV = "team-suppress-iv";
const WS_HW = "team-suppress-hw";

setDecisionConfig(
  "pipelineStages",
  {
    stages: [
      { id: "Applied", label: "Applied", role: "entry" },
      { id: "Interview", label: "Interview", role: "interview" },
      { id: "Hired", label: "Hired", role: "terminal" },
    ],
    retired: [],
  },
  WS_IV
);
setDecisionConfig(
  "interviewPlan",
  { steps: [{ stageId: "Interview", gate: "auto", rounds: [{ kind: "ai", gate: "auto", topN: null }] }] },
  WS_IV
);
setDecisionConfig(
  "pipelineStages",
  {
    stages: [
      { id: "Accepted", label: "Accepted", role: "entry" },
      { id: "Homework", label: "Homework", role: "homework" },
      { id: "Hired", label: "Hired", role: "terminal" },
    ],
    retired: [],
  },
  WS_HW
);
setDecisionConfig("interviewPlan", { steps: [{ stageId: "Homework", gate: "auto", rounds: [] }] }, WS_HW);

let seq = 0;
function entryAt(workspaceId: string, stage: string, jobId: string, jobTitle: string) {
  seq += 1;
  return createPipelineEntry({
    candidateId: `sup-hook-c${seq}`,
    candidateLabel: `Suppressed Hook Candidate ${seq}`,
    jobId,
    jobTitle,
    contact: `sup-hook-c${seq}@example.com`,
    stage,
    archetype: "student",
    workspaceId,
  }).entry;
}
function lapse(entryId: string) {
  ensureDb()
    .prepare(`UPDATE pipeline_entries SET consent_given_at = ?, consent_expires_at = ? WHERE id = ?`)
    .run("2019-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z", entryId);
}
const sessionsFor = (entryId: string, ws: string) => listRecentInterviewSessions(ws, 200).filter((s) => s.entryId === entryId);

test("case 6: an AI-interview arrival of a suppressed candidate is failed/suppressed, minted nothing, and PARKED for a human", async () => {
  const b = entryAt(WS_IV, "Interview", `sup-iv-job-${seq}`, "Suppressed Interview Role");
  lapse(b.id);

  const res = await runStageEnteredHook({ entryId: b.id, stage: "Interview", workspaceId: WS_IV });

  assert.equal(res.outcome, "failed");
  assert.equal(res.outcome === "failed" && res.reason, "suppressed");
  assert.equal(sessionsFor(b.id, WS_IV).length, 0, "no interview session is minted for a person the send gate refuses");
  // Not a silent skip: the Schedule docket shows the candidate, exactly like `unaddressable`.
  assert.equal(getPipelineEntry(b.id, WS_IV)?.approvalKind, "calendar");

  // The control: the same board, a consenting candidate, is invited.
  const a = entryAt(WS_IV, "Interview", `sup-iv-job-${seq}`, "Suppressed Interview Role");
  const ok = await runStageEnteredHook({ entryId: a.id, stage: "Interview", workspaceId: WS_IV });
  assert.equal(ok.outcome, "invited");
});

test("case 7: a homework arrival of a suppressed candidate is failed/suppressed and publishes no apply token", async () => {
  const title = "Suppressed Homework Role";
  const { slug } = saveJd({ title, body: `We need someone to do ${title}. Stack: TypeScript.` }, WS_HW);
  const jobId = jdJobId(slug);
  insertJob({ id: jobId, title, roleFamily: "software_engineering" } as JobRecord, undefined, "published", WS_HW);
  const caseId = saveDevCase(
    { need: { jdSlug: slug, title }, analysis: {}, role: { title, seniority: "mid" }, case: { title: `${title} case` } },
    WS_HW
  ).id;

  const b = entryAt(WS_HW, "Homework", jobId, title);
  lapse(b.id);

  const res = await runStageEnteredHook({ entryId: b.id, stage: "Homework", workspaceId: WS_HW });

  assert.equal(res.outcome, "failed");
  assert.equal(res.outcome === "failed" && res.reason, "suppressed");
  assert.equal(getOpenPosting(caseId, "local", WS_HW), null, "no live apply token is published for a suppressed candidate");
  assert.equal(listOutboxFiltered({ ref: b.id, kind: "case_invite" }, WS_HW).length, 0);
});
