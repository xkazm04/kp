// A reloaded walk resumes at the chapter the BOARD proves it reached, instead of
// Reset-and-replay. These cases pin the derivation (resumePointOf over the board's
// entries and its live axis), that only the walk's own (SIM) rows can ever become a
// resume target, that a finished walk offers Reset rather than Resume, and the
// chapter list a resume runs. The route's no-purge claim is pinned beside the route
// (app/api/sim/reset/reset-route.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STAGE_AXIS, screenedLandingStage, stageIndex, stageWithRole, type StageDef } from "@/app/_lib/pipeline-stages";
import { SIM_MARKER } from "./constants.ts";
import { chaptersFrom, readResume, resumePointOf, type ResumeEntry } from "./simWalkResume.ts";

const axis = DEFAULT_STAGE_AXIS;
const ENTRY = stageWithRole("entry", axis) as string;
const SCREENED = screenedLandingStage(axis);
const PAST_SCREENED = axis[stageIndex(SCREENED, axis) + 1].id;
const OFFER = stageWithRole("offer", axis) as string;
const TERMINAL = stageWithRole("terminal", axis) as string;
const SIM_JOB_TITLE = `Senior Java Backend Engineer ${SIM_MARKER}`;

let n = 0;
function entry(p: Partial<ResumeEntry> = {}): ResumeEntry {
  n += 1;
  return {
    id: `e-${n}`,
    candidateLabel: `Candidate ${n}`,
    jobId: "job-sim",
    jobTitle: SIM_JOB_TITLE,
    stage: ENTRY,
    status: "active",
    approvalKind: null,
    matchScore: 50,
    createdAt: `2026-09-23T10:00:${String(n).padStart(2, "0")}Z`,
    ...p,
  };
}

test("an empty board has nothing to resume: Start stays the action", () => {
  assert.equal(resumePointOf({ entries: [], axis: DEFAULT_STAGE_AXIS }), null);
  assert.equal(readResume({ entries: [], axis }).reason, "empty");
});

test("a real candidate, even at the offer stage, is never a resume target", () => {
  const real = entry({ jobId: "job-real", jobTitle: "Senior Java Backend Engineer", stage: OFFER, approvalKind: "offer_review" });
  assert.equal(resumePointOf({ entries: [real], axis }), null, "no (SIM) row, no resume");
  // Beside a (SIM) walk still at the entry column, the real row changes nothing.
  const sim = entry();
  assert.deepEqual(resumePointOf({ entries: [real, sim], axis }), { phase: "match", jobId: "job-sim" });
});

test("a (SIM) job whose entries all sit on the entry-role stage resumes at match", () => {
  assert.deepEqual(resumePointOf({ entries: [entry(), entry(), entry()], axis }), { phase: "match", jobId: "job-sim" });
});

test("screened entries with no approval resume at screen, following the best match", () => {
  const low = entry({ stage: SCREENED, matchScore: 61 });
  const top = entry({ stage: SCREENED, matchScore: 88 });
  const unscored = entry({ stage: SCREENED, matchScore: null });
  const straggler = entry({ stage: ENTRY });
  assert.deepEqual(resumePointOf({ entries: [low, unscored, top, straggler], axis }), {
    phase: "screen",
    jobId: "job-sim",
    targetId: top.id,
    targetLabel: top.candidateLabel,
  });
});

test("interview, offer and hired are read off the target's stage and approval", () => {
  const cohort = [entry({ stage: SCREENED, status: "rejected" }), entry({ stage: SCREENED })];
  const atInterview = entry({ stage: PAST_SCREENED, approvalKind: "calendar" });
  assert.equal(resumePointOf({ entries: [...cohort, atInterview], axis })?.phase, "interview");
  assert.equal(resumePointOf({ entries: [...cohort, atInterview], axis })?.targetId, atInterview.id);

  const drafted = entry({ stage: OFFER, approvalKind: "offer_review" });
  assert.equal(resumePointOf({ entries: [...cohort, drafted], axis })?.phase, "offer");

  const sent = entry({ stage: OFFER, approvalKind: null });
  assert.deepEqual(resumePointOf({ entries: [...cohort, sent], axis }), {
    phase: "hired",
    jobId: "job-sim",
    targetId: sent.id,
    targetLabel: sent.candidateLabel,
  });
});

test("a walk that reached the terminal stage is complete: Reset, not Resume", () => {
  const hired = entry({ stage: TERMINAL });
  const read = readResume({ entries: [entry({ stage: SCREENED, status: "rejected" }), hired], axis });
  assert.equal(read.point, null);
  assert.equal(read.reason, "complete");
});

test("stages are resolved by ROLE from the live axis, not by the shipped names", () => {
  const renamed: StageDef[] = [
    { id: "Inbox", label: "Inbox", role: "entry" },
    { id: "Vetted", label: "Vetted", role: "screening" },
    { id: "Round 1", label: "Round 1", role: "interview" },
    { id: "Round 2", label: "Round 2", role: "interview" },
    { id: "Proposal", label: "Proposal", role: "offer" },
    { id: "Joined", label: "Joined", role: "terminal" },
  ];
  assert.equal(resumePointOf({ entries: [entry({ stage: "Inbox" })], axis: renamed })?.phase, "match");
  assert.equal(resumePointOf({ entries: [entry({ stage: "Vetted" })], axis: renamed })?.phase, "screen");
  assert.equal(resumePointOf({ entries: [entry({ stage: "Round 2" })], axis: renamed })?.phase, "interview");
  assert.equal(resumePointOf({ entries: [entry({ stage: "Proposal", approvalKind: "offer_review" })], axis: renamed })?.phase, "offer");
  assert.equal(readResume({ entries: [entry({ stage: "Joined" })], axis: renamed }).reason, "complete");
});

test("chaptersFrom runs the rest of the walk in SIM_CHAPTERS order, and refuses an unknown id", () => {
  assert.deepEqual(chaptersFrom("offer").map((c) => c.id), ["offer", "hired"]);
  assert.deepEqual(chaptersFrom("design").map((c) => c.id), ["design", "source", "match", "screen", "interview", "offer", "hired"]);
  assert.throws(() => chaptersFrom("teardown" as never), /unknown sim chapter/);
});
