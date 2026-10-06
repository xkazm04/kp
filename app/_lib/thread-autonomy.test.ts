// Real native better-sqlite3 first: the DB half below runs the app's own migrations
// (ensureDb) and writes through recordEvent, never an inline CREATE TABLE copy.
import "better-sqlite3";
// IMPORT ORDER IS LOAD-BEARING: unit-db sets KP_DB_PATH before anything touches db-path.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  CANDIDATE_ACT_KINDS,
  EMPTY_THREAD_AUTONOMY,
  eventAttribution,
  eventRung,
  ladderPosition,
  threadAutonomy,
  type ThreadEvent,
} from "./thread-autonomy.ts";
import { listThreadAutonomyByJob } from "./db/thread-autonomy.ts";
import { ensureDb, recordEvent } from "./db/core.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";
import { SIM_TITLE_LIKE } from "@/app/features/shell/simulation/constants";
import type { StageDef } from "./pipeline-stages.ts";

before(() => ensureDb());
after(() => cleanupUnitDb());

const ev = (kind: string, actor: string | null, toStage: string | null, createdAt: string): ThreadEvent => ({ kind, actor, toStage, createdAt });

// ---- (a) the pure core ----------------------------------------------------------

test("an all-machine thread reaches every rung it touched and has no first human step", () => {
  const r = threadAutonomy([
    ev("matched", "auto:matcher", "Accepted", "2026-03-10T09:00:00Z"),
    ev("scored", "auto:screen-wave", "Screened", "2026-03-10T09:05:00Z"),
    ev("interview_invite_sent", "auto:comms", "Interview", "2026-03-11T09:00:00Z"),
    ev("interview_scorecard", "auto:interview", null, "2026-03-12T09:00:00Z"),
    ev("offer_drafted", "auto:offer", "Offer", "2026-03-13T09:00:00Z"),
  ]);
  assert.deepEqual(r, { stagesReached: 5, stagesAutonomous: 5, firstHumanStage: null, firstHumanKind: null, unknownEvents: 0, unplacedEvents: 0, candidateEvents: 0 });
  assert.ok(r.stagesReached > 0, "NON-VACUITY: the fixture reached rungs, so an all-zero default would fail here");
});

test("a human at stage 3 names that rung and kind, and that rung stops being autonomous", () => {
  const r = threadAutonomy([
    ev("matched", "auto:matcher", "Accepted", "2026-03-10T09:00:00Z"),
    ev("scored", "auto:screen-wave", "Screened", "2026-03-10T09:05:00Z"),
    ev("advanced", "human:recruiter", "Screened", "2026-03-10T10:00:00Z"),
    ev("interview_invite_sent", "auto:comms", "Interview", "2026-03-11T09:00:00Z"),
  ]);
  assert.equal(r.firstHumanStage, "screen", "NON-VACUITY: a fixture with a human step must not read null");
  assert.equal(ladderPosition("screen"), 3, "JD(1) -> sourced(2) -> screened(3)");
  assert.equal(r.firstHumanKind, "advanced");
  assert.equal(r.stagesReached, 3);
  assert.equal(r.stagesAutonomous, 2, "slate and interview stayed clean; screen holds a human event");
});

test("the lowest rung wins over the earliest clock time, and the earliest human event names the kind", () => {
  const r = threadAutonomy([
    ev("offer_sent", "human:recruiter", null, "2026-03-09T09:00:00Z"), // earliest in time, top rung
    ev("rejected", "human:recruiter", "Screened", "2026-03-12T09:00:00Z"), // lower rung, later
    ev("advanced", "human:Petra", "Screened", "2026-03-11T09:00:00Z"), // same rung, earlier
  ]);
  assert.equal(r.firstHumanStage, "screen");
  assert.equal(r.firstHumanKind, "advanced");
});

test("the actor prefix outranks the kind's attribution, and the kind answers only when there is no actor", () => {
  assert.equal(eventAttribution({ kind: "advanced", actor: "auto:policy" }), "auto", "advanced is human BY KIND; the actor says machine");
  assert.equal(eventAttribution({ kind: "scored", actor: "human:Petra" }), "human", "scored is auto BY KIND; the actor says a person");
  assert.equal(eventAttribution({ kind: "scored", actor: null }), "auto");
  assert.equal(eventAttribution({ kind: "advanced", actor: "  " }), "human");
  assert.equal(eventAttribution({ kind: "advanced", actor: "robot:x" }), "human", "an unparseable actor falls back to the kind");
  assert.equal(eventAttribution({ kind: "never_heard_of_it", actor: null }), "unknown");
});

test("an unknown-attribution event stays unknown: it is reported and never makes its rung autonomous", () => {
  const r = threadAutonomy([
    ev("scored", "auto:screen-wave", "Screened", "2026-03-10T09:00:00Z"),
    ev("brand_new_kind", null, "Interview", "2026-03-11T09:00:00Z"),
  ]);
  assert.equal(r.unknownEvents, 1, "NON-VACUITY: the unknown event must be counted, not dropped");
  assert.equal(r.stagesReached, 2);
  assert.equal(r.stagesAutonomous, 1, "the interview rung holds only an unknown event, so it is not autonomous");
  assert.equal(r.firstHumanStage, null, "unknown is not human either");
});

test("an event neither rule can place is counted as unplaced and moves no rung", () => {
  const r = threadAutonomy([ev("comm_resent_unmapped", "auto:comms", null, "2026-03-10T09:00:00Z"), ev("moved", "human:recruiter", "Retired column", "2026-03-10T09:01:00Z")]);
  assert.equal(r.unplacedEvents, 2);
  assert.equal(r.stagesReached, 0);
  assert.equal(r.firstHumanStage, null, "an unplaced human event has no rung to name");
});

test("an empty job is the all-zero answer", () => {
  assert.deepEqual(threadAutonomy([]), EMPTY_THREAD_AUTONOMY);
});

test("a stage is projected by its ROLE on the workspace's axis, so renaming a column moves nothing", () => {
  const axis: StageDef[] = [
    { id: "New", label: "New", role: "entry" },
    { id: "Work sample", label: "Work sample", role: "homework" },
    { id: "Signed", label: "Signed", role: "terminal" },
  ];
  assert.equal(eventRung({ kind: "moved", toStage: "Work sample" }, axis), "case_assignment");
  assert.equal(eventRung({ kind: "moved", toStage: "Signed" }, axis), "offer_draft");
  assert.equal(eventRung({ kind: "moved", toStage: "Screened" }, axis), null, "an id this axis does not declare has no meaning to resolve");
});

// ---- (a2) a candidate's own act is not a hiring-side human step (ADR-0011 amendment) ----

test("a thread whose only non-auto events are candidate acts has no first human step", () => {
  const r = threadAutonomy([
    ev("applied", null, null, "2026-03-10T09:00:00Z"),
    ev("profile_enriched", null, "Screened", "2026-03-10T09:30:00Z"),
    ev("offer_accepted", null, null, "2026-03-13T09:00:00Z"),
    ev("moved", "human:candidate", "Interview", "2026-03-11T09:00:00Z"),
  ]);
  assert.equal(r.stagesReached, 4, "NON-VACUITY: slate, screen, interview and offer rungs were all reached");
  assert.equal(r.firstHumanStage, null);
  assert.equal(r.firstHumanKind, null);
  assert.equal(r.stagesAutonomous, 4, "candidate acts leave their rungs clean");
  assert.equal(r.candidateEvents, 4, "the exclusion is counted, not silent");
  assert.equal(r.unknownEvents, 0);
});

test("a recruiter act on a thread that also has candidate acts still counts as human", () => {
  const r = threadAutonomy([
    ev("applied", null, null, "2026-03-10T09:00:00Z"),
    ev("advanced", "human:recruiter", "Screened", "2026-03-10T10:00:00Z"),
  ]);
  assert.equal(r.firstHumanStage, "screen");
  assert.equal(r.firstHumanKind, "advanced");
  const s = threadAutonomy([
    ev("applied", null, null, "2026-03-10T09:00:00Z"),
    ev("interview_scorecard", "human:recruiter", null, "2026-03-12T09:00:00Z"),
  ]);
  assert.equal(s.firstHumanStage, "scorecard");
  assert.equal(s.candidateEvents, 1);
});

test("a candidate-act kind written by a machine stays auto, and an explicit human actor stays human whatever the kind", () => {
  assert.equal(eventAttribution({ kind: "applied", actor: "auto:intake" }), "auto");
  assert.equal(eventAttribution({ kind: "applied", actor: "human:recruiter" }), "human");
  assert.equal(eventAttribution({ kind: "offer_accepted", actor: "human:operator" }), "human");
  assert.equal(eventAttribution({ kind: "applied", actor: "human:Petra" }), "human");
  assert.equal(eventAttribution({ kind: "applied", actor: null }), "candidate");
  assert.equal(eventAttribution({ kind: "advanced", actor: "human:candidate" }), "candidate");
  assert.equal(eventAttribution({ kind: "advanced", actor: null }), "human", "a non-candidate kind with no actor keeps the shared map's answer");
  const r = threadAutonomy([ev("applied", "auto:intake", null, "2026-03-10T09:00:00Z")]);
  assert.equal(r.candidateEvents, 0);
  assert.equal(r.stagesAutonomous, 1);
  for (const kind of CANDIDATE_ACT_KINDS) assert.equal(eventAttribution({ kind, actor: null }), "candidate", kind);
});

// ---- (b) the server read, against the REAL schema -----------------------------------

const WS_A = DEFAULT_WORKSPACE_ID;
const WS_B = "team-autonomy-b";
const NOW = new Date("2026-03-31T12:00:00.000Z");

function entry(ws: string, jobId: string, jobTitle: string, tag: string) {
  return createPipelineEntry({ candidateId: `auto-${tag}`, candidateLabel: `Autonomy ${tag}`, jobId, jobTitle, workspaceId: ws }).entry;
}

function put(entryId: string | null, jobTitle: string, kind: string, actor: string | null, toStage: string | null, createdAt: string, workspaceId?: string) {
  recordEvent(ensureDb(), { entryId, jobTitle, kind, actor, toStage, createdAt, workspaceId });
}

test("one row per job over a window, scoped to the workspace — a second team's events never leak in", () => {
  const a1 = entry(WS_A, "job-auto", "Autonomous Role", "a1");
  const a2 = entry(WS_A, "job-human", "Hand-held Role", "a2");
  const b1 = entry(WS_B, "job-b", "Other Team Role", "b1");

  put(a1.id, "Autonomous Role", "matched", "auto:matcher", "Accepted", "2026-03-10T09:00:00Z");
  put(a1.id, "Autonomous Role", "scored", "auto:screen-wave", "Screened", "2026-03-10T09:05:00Z");
  put(a1.id, "Autonomous Role", "offer_drafted", "auto:offer", "Offer", "2026-03-12T09:00:00Z");

  put(a2.id, "Hand-held Role", "matched", "auto:matcher", "Accepted", "2026-03-10T09:00:00Z");
  put(a2.id, "Hand-held Role", "advanced", "human:recruiter", "Screened", "2026-03-10T10:00:00Z");
  put(a2.id, "Hand-held Role", "mystery_kind", null, "Interview", "2026-03-11T10:00:00Z");

  // Team B: every event is a human one. If any of these reached team A's read, job-b would
  // appear in it and the human counts below would move.
  put(b1.id, "Other Team Role", "advanced", "human:recruiter", "Screened", "2026-03-10T09:00:00Z");
  put(b1.id, "Other Team Role", "rejected", "human:recruiter", "Screened", "2026-03-10T09:30:00Z");

  // A row whose OWN workspace disagrees with its entry's is dropped, not leaked either way.
  put(a1.id, "Autonomous Role", "advanced", "human:recruiter", "Interview", "2026-03-15T09:00:00Z", WS_B);

  // Excluded by construction: out of the window, a guided-demo title, an entry-less event.
  put(a1.id, "Autonomous Role", "advanced", "human:recruiter", "Interview", "2026-01-01T09:00:00Z");
  put(a1.id, SIM_TITLE_LIKE.replaceAll("%", ""), "advanced", "human:recruiter", "Interview", "2026-03-16T09:00:00Z");
  put(null, "Autonomous Role", "ko_declined", "auto:ko", null, "2026-03-17T09:00:00Z", WS_A);

  const a = listThreadAutonomyByJob({ workspaceId: WS_A, now: NOW });
  assert.equal(a.truncated, false);
  assert.deepEqual(a.jobs.map((j) => j.jobId).sort(), ["job-auto", "job-human"], "NON-VACUITY: two jobs read, and neither is team B's");

  const auto = a.jobs.find((j) => j.jobId === "job-auto");
  assert.ok(auto);
  assert.equal(auto.jobTitle, "Autonomous Role");
  assert.equal(auto.events, 3, "window, sim marker, entry-less and cross-workspace rows are all outside the count");
  assert.deepEqual(
    { reached: auto.stagesReached, autonomous: auto.stagesAutonomous, first: auto.firstHumanStage, unknown: auto.unknownEvents },
    { reached: 3, autonomous: 3, first: null, unknown: 0 }
  );

  const human = a.jobs.find((j) => j.jobId === "job-human");
  assert.ok(human);
  assert.equal(human.firstHumanStage, "screen", "NON-VACUITY: the seeded human step must be found");
  assert.equal(human.firstHumanKind, "advanced");
  assert.equal(human.unknownEvents, 1);
  assert.equal(human.stagesReached, 3);
  assert.equal(human.stagesAutonomous, 1, "only the sourcing rung stayed clean");

  const b = listThreadAutonomyByJob({ workspaceId: WS_B, now: NOW });
  assert.deepEqual(b.jobs.map((j) => j.jobId), ["job-b"], "team B sees its own job and none of team A's");
  assert.equal(b.jobs[0].events, 2, "the mismatched-workspace row is in neither team's read");
  assert.equal(b.jobs[0].firstHumanStage, "screen");

});

test("an applied row with a null actor plus a machine scored row reads as no first human step", () => {
  const e = entry(WS_A, "job-candidate-act", "Candidate Act Role", "c1");
  put(e.id, "Candidate Act Role", "applied", null, "Accepted", "2026-03-20T09:00:00Z");
  put(e.id, "Candidate Act Role", "scored", "auto:screen-wave", "Screened", "2026-03-20T09:05:00Z");

  const job = listThreadAutonomyByJob({ workspaceId: WS_A, now: NOW }).jobs.find((j) => j.jobId === "job-candidate-act");
  assert.ok(job);
  assert.ok(job.stagesReached >= 2, "NON-VACUITY: the fixture reached at least two rungs");
  assert.equal(job.firstHumanStage, null);
  assert.equal(job.firstHumanKind, null);
  assert.equal(job.candidateEvents, 1);
  assert.equal(job.stagesAutonomous, job.stagesReached);
});

test("the read is bounded: a hit event cap is reported, never silent", () => {
  const capped = listThreadAutonomyByJob({ workspaceId: WS_A, now: NOW, maxEvents: 2 });
  assert.equal(capped.truncated, true);
  assert.equal(
    capped.jobs.reduce((n, j) => n + j.events, 0),
    2
  );
  const narrow = listThreadAutonomyByJob({ workspaceId: WS_A, now: new Date("2026-02-15T00:00:00.000Z"), windowDays: 1 });
  assert.deepEqual(narrow.jobs, [], "a window with no events yields no rows, not a default row");
});
