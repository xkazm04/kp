// The work-sample arrival hook: entering a `homework` column gets the candidate their
// assignment, and their submission comes back bound to the entry we invited.
//
// unit-db.ts MUST be the first project import (sets KP_DB_PATH before any store
// module resolves db-path.ts).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry, getPipelineEntry } from "./db/pipeline.ts";
import {
  approveLifecycleCase,
  createSubmission,
  getLifecycle,
  getOpenPosting,
  getSubmission,
  listLifecycles,
  listOutboxFiltered,
  saveDevCase,
  saveSubmissionEvaluation,
  updateLifecycle,
} from "./db/devcase.ts";
import { saveJd } from "./db/jobs.ts";
import { insertJob } from "./job-ingest.ts";
import { jdJobId } from "./jd-limits.ts";
import { setDecisionConfig } from "./decision-config-store.ts";
import { promoteSubmission } from "./devcase-run.ts";
import { runStageEnteredHook } from "./stage-hooks.ts";
import { runHomeworkArrival } from "./stage-hooks-homework.ts";
import type { JobRecord } from "./db/core.ts";

after(() => cleanupUnitDb());

// The Enterprise funnel's first two columns, plus a terminal so the axis validates.
const AXIS = {
  stages: [
    { id: "Accepted", label: "Accepted", role: "entry" },
    { id: "Homework", label: "Homework", role: "homework" },
    { id: "Hired", label: "Hired", role: "terminal" },
  ],
  retired: [],
};

/** The plan is saved and the homework column sends the case unattended. */
const WS_AUTO = "team-hw-auto";
/** The plan is saved and a human approves the case before it goes out. */
const WS_HUMAN = "team-hw-human";

for (const ws of [WS_AUTO, WS_HUMAN]) {
  setDecisionConfig("pipelineStages", AXIS, ws);
}
setDecisionConfig("interviewPlan", { steps: [{ stageId: "Homework", gate: "auto", rounds: [] }] }, WS_AUTO);
setDecisionConfig("interviewPlan", { steps: [{ stageId: "Homework", gate: "human", rounds: [] }] }, WS_HUMAN);

let seq = 0;

/** A saved JD plus the matchable `jd-<slug>` opening it ingests to — the pair the hook
 *  needs to build a need from, and the pair `resolveCaseJobId` re-derives to link a
 *  designed case back to this job. */
function jobWithJd(workspaceId: string): { slug: string; jobId: string; title: string } {
  seq += 1;
  const title = `Homework Test Role ${seq}`;
  const { slug } = saveJd({ title, body: `We need someone to do ${title}. Stack: TypeScript.` }, workspaceId);
  const jobId = jdJobId(slug);
  insertJob({ id: jobId, title, roleFamily: "software_engineering" } as JobRecord, undefined, "published", workspaceId);
  return { slug, jobId, title };
}

/** An APPROVED dev case cut for that job — the state a homework column can send from. */
function approvedCaseFor(slug: string, title: string, workspaceId: string): string {
  return saveDevCase(
    { need: { jdSlug: slug, title }, analysis: {}, role: { title, seniority: "mid" }, case: { title: `${title} case` } },
    workspaceId
  ).id;
}

function entryAt(workspaceId: string, jobId: string, jobTitle: string, contact: string | null) {
  seq += 1;
  return createPipelineEntry({
    candidateId: `hw-c${seq}`,
    candidateLabel: `Homework Candidate ${seq}`,
    jobId,
    jobTitle,
    contact,
    stage: "Homework",
    archetype: "student",
    workspaceId,
  }).entry;
}

const invites = (entryId: string, ws: string) => listOutboxFiltered({ ref: entryId, kind: "case_invite" }, ws);

test("auto gate + an approved case: ONE assignment goes out, with the outbox's own claim", async () => {
  const job = jobWithJd(WS_AUTO);
  const caseId = approvedCaseFor(job.slug, job.title, WS_AUTO);
  const entry = entryAt(WS_AUTO, job.jobId, job.title, "hw-auto@example.com");

  const res = await runStageEnteredHook({ entryId: entry.id, stage: "Homework", workspaceId: WS_AUTO });

  assert.equal(res.outcome, "invited");
  // The truthful claim, not a green lie: no relay is configured in this process, so the
  // letter is QUEUED in the durable outbox — never reported as sent.
  assert.equal(res.outcome === "invited" && res.delivery, "queued");

  const rows = invites(entry.id, WS_AUTO);
  assert.equal(rows.length, 1, "exactly one assignment letter");
  assert.equal(rows[0].status, "queued");
  const posting = getOpenPosting(caseId, "local", WS_AUTO);
  assert.ok(posting?.token, "the case is live on an apply token");
  assert.ok(rows[0].body?.includes(posting!.token!), "the letter carries the apply link");

  // Re-entry, a retried poll and a bulk move touching the row twice all resolve to the
  // same (entry, posting) pair — nobody gets a second assignment.
  const again = await runStageEnteredHook({ entryId: entry.id, stage: "Homework", workspaceId: WS_AUTO });
  assert.equal(again.outcome, "already_invited");
  const third = await runHomeworkArrival(entry, "Homework", WS_AUTO);
  assert.equal(third.outcome, "already_invited");
  assert.equal(invites(entry.id, WS_AUTO).length, 1, "still exactly one letter");
});

test("a second candidate on the same job is invited to the SAME posting, not a new one", async () => {
  const job = jobWithJd(WS_AUTO);
  const caseId = approvedCaseFor(job.slug, job.title, WS_AUTO);
  const first = entryAt(WS_AUTO, job.jobId, job.title, "hw-first@example.com");
  const second = entryAt(WS_AUTO, job.jobId, job.title, "hw-second@example.com");

  await runHomeworkArrival(first, "Homework", WS_AUTO);
  const res = await runHomeworkArrival(second, "Homework", WS_AUTO);

  assert.equal(res.outcome, "invited");
  // Comparability: two candidates on one case must be handed the identical materials and
  // the identical submit channel, so the open posting is reused rather than re-minted.
  const posting = getOpenPosting(caseId, "local", WS_AUTO);
  assert.equal(res.outcome === "invited" && res.postingId, posting?.id);
  assert.equal(invites(first.id, WS_AUTO).length, 1);
  assert.equal(invites(second.id, WS_AUTO).length, 1);
});

test("no deliverable address: nothing is sent, nothing is published, the move still stands", async () => {
  const job = jobWithJd(WS_AUTO);
  const caseId = approvedCaseFor(job.slug, job.title, WS_AUTO);
  const entry = entryAt(WS_AUTO, job.jobId, job.title, null);

  const res = await runStageEnteredHook({ entryId: entry.id, stage: "Homework", workspaceId: WS_AUTO });

  assert.equal(res.outcome, "failed");
  assert.equal(res.outcome === "failed" && res.reason, "unaddressable");
  assert.equal(invites(entry.id, WS_AUTO).length, 0, "nothing claims an assignment went out");
  assert.equal(getOpenPosting(caseId, "local", WS_AUTO), null, "no live token was minted for a letter nobody can receive");
  // The choke point: the candidate is still standing where the committed move put them.
  assert.equal(getPipelineEntry(entry.id, WS_AUTO)?.stage, "Homework");
});

test("human gate + no case: the lifecycle parks at awaiting_approval and nothing is sent", async () => {
  const job = jobWithJd(WS_HUMAN);
  const entry = entryAt(WS_HUMAN, job.jobId, job.title, "hw-human@example.com");

  // The design chain is injected rather than spawned: this asserts the ARRIVAL's wiring
  // (which gate, which stop) and the unit suite is Node-only and keyless by contract.
  // The fake stands in for a lifecycle whose own human gate refused to auto-approve.
  const res = await runHomeworkArrival(entry, "Homework", WS_HUMAN, {
    runDesign: async (lifecycleId) => {
      updateLifecycle(lifecycleId, { stage: "awaiting_approval", detail: "human review before publishing" });
    },
  });

  assert.equal(res.outcome, "case_pending");
  assert.equal(res.outcome === "case_pending" && res.stage, "awaiting_approval");
  const lc = getLifecycle(res.outcome === "case_pending" ? res.lifecycleId : "");
  // The column's gate governs the LIFECYCLE's own human gate rather than adding a second
  // one, so the record the recruiter approves in Dev → Cases is NOT auto.
  assert.equal(lc?.auto, false);
  assert.equal(lc?.workspaceId, WS_HUMAN);
  assert.equal(invites(entry.id, WS_HUMAN).length, 0, "nothing claims an assignment went out");
});

test("auto gate + no case: the hook designs one and RE-RUNS to send it", async () => {
  const job = jobWithJd(WS_AUTO);
  const entry = entryAt(WS_AUTO, job.jobId, job.title, "hw-design@example.com");

  // The fake stands in for the orchestrator's auto-approve gate: it approves the
  // lifecycle's designed case exactly as `approveLifecycleCase` does in production. The
  // point under test is the SEAM — that the arrival comes back around once a sendable
  // case exists and mails it, instead of stopping at "designed".
  const res = await runHomeworkArrival(entry, "Homework", WS_AUTO, {
    runDesign: async (lifecycleId) => {
      const lc = getLifecycle(lifecycleId)!;
      approveLifecycleCase(
        lifecycleId,
        { need: lc.need, analysis: {}, role: { title: job.title }, case: { title: `${job.title} case` } },
        "clean (auto-approved)"
      );
    },
  });

  assert.equal(res.outcome, "invited");
  assert.equal(invites(entry.id, WS_AUTO).length, 1, "the designed assignment was mailed");
  // The need was built off the job's saved JD, which is what links the designed case back
  // to this job — without it the next arrival would design a second one.
  const lc = listLifecycles(50, WS_AUTO).find((l) => l.need?.jdSlug === job.slug);
  assert.ok(lc, "a lifecycle was created for this job's JD");
  assert.equal(lc!.auto, true);
});

test("a submission from an INVITED candidate binds to their existing entry", async () => {
  const job = jobWithJd(WS_AUTO);
  const caseId = approvedCaseFor(job.slug, job.title, WS_AUTO);
  const contact = "hw-bind@example.com";
  const entry = entryAt(WS_AUTO, job.jobId, job.title, contact);

  const invited = await runStageEnteredHook({ entryId: entry.id, stage: "Homework", workspaceId: WS_AUTO });
  assert.equal(invited.outcome, "invited");

  // …the candidate opens the link and hands their work in, under whatever name they
  // type. Before the invite ledger was consulted this came back as a stranger.
  const posting = getOpenPosting(caseId, "local", WS_AUTO)!;
  const { submission } = createSubmission({
    postingId: posting.id,
    candidateRef: "A Name They Typed",
    repoRef: "https://github.com/example/homework",
    contact,
  });
  saveSubmissionEvaluation(submission.id, { evaluation: { confidence: 0.9 }, transfer: { transferScore: 78 } }, 78);

  const promoted = promoteSubmission(submission.id, 0);
  assert.ok(promoted, "the evaluated submission promoted");
  assert.equal(promoted!.entryId, entry.id, "bound to THEIR entry, not a freshly minted duplicate");

  // …and the link the AI interview reads the submission through is now on that entry
  // (buildGroundedInterview → submissionFollowups → entry.devSubmissionId).
  const bound = getPipelineEntry(entry.id, WS_AUTO);
  assert.equal(bound?.devSubmissionId, submission.id);
  assert.equal(getSubmission(submission.id)?.postingId, posting.id);
});

test("an UNINVITED submission on the same posting is still resolved the old way", async () => {
  const job = jobWithJd(WS_AUTO);
  const caseId = approvedCaseFor(job.slug, job.title, WS_AUTO);
  const entry = entryAt(WS_AUTO, job.jobId, job.title, "hw-owner@example.com");
  await runStageEnteredHook({ entryId: entry.id, stage: "Homework", workspaceId: WS_AUTO });

  // Somebody the link was shared with. Matching no invite, they must NOT inherit the
  // invited candidate's entry — guessing between two people is the one failure worse
  // than promoting a stranger.
  const posting = getOpenPosting(caseId, "local", WS_AUTO)!;
  const { submission } = createSubmission({
    postingId: posting.id,
    candidateRef: "Passer By",
    repoRef: "https://github.com/example/shared-link",
    contact: "someone-else@example.com",
  });
  saveSubmissionEvaluation(submission.id, { evaluation: { confidence: 0.9 }, transfer: { transferScore: 61 } }, 61);

  const promoted = promoteSubmission(submission.id, 0);
  assert.ok(promoted);
  assert.notEqual(promoted!.entryId, entry.id);
  assert.equal(getPipelineEntry(entry.id, WS_AUTO)?.devSubmissionId ?? null, null);
});
