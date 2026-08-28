// ONE THREAD (gap 4) — "the voice screen is reachable from the assignment".
//
// A screen is minted for a pipeline ENTRY, and its whole brief is read off that entry.
// The reviewer looking at an evaluation holds a SUBMISSION id and never held an entry
// id, so a candidate who did the assignment was interviewable only after somebody
// remembered to promote them first — an ordering requirement that was never a product
// rule, only an artifact of which id each surface happened to hold.
//
// These pin the join that removed it, and — the half that matters more — the refusals
// that did NOT get removed with it: an unknown submission, another team's submission,
// and an unevaluated one all still stop here. Plus the reverse read the eval surface
// polls ("does this candidate already have a screen?") and the grounding that only
// works because the entry now carries a REAL job id: the case-grounded scenario, which
// used to be found by parsing `dc-` out of the job id and would silently vanish the
// moment the entry started naming the JD's actual opening.
//
// testing/unit-db.ts MUST be the first project import — it sets KP_DB_PATH before
// db-path.ts is evaluated by the transitive `@/app/_lib/db` import.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  createPipelineEntry,
  createPosting,
  createSubmission,
  findEntryByDevSubmission,
  getPipelineEntry,
  saveDevCase,
  saveDevCaseScenario,
  saveProfile,
  saveSubmissionEvaluation,
} from "./db.ts";
import { insertJob } from "./job-ingest.ts";
import type { JobRecord } from "./db/core.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";
import { resolveEntryForSubmission } from "./devcase-interview-entry.ts";
import { buildGroundedInterview } from "./interview-run.ts";
import { promoteSubmission } from "./devcase-run.ts";

after(() => cleanupUnitDb());

const FLOOR = 55;
const OTHER_WS = "team-elsewhere";
let seq = 0;

/** An evaluation with NO minted follow-ups. Load-bearing for the grounding test:
 *  `buildGroundedInterview` prefers the submission-debrief brief whenever follow-ups
 *  exist, so a bundle carrying them would pass the case-grounded assertion by taking a
 *  different branch entirely. */
function bundle() {
  return {
    evaluation: { summary: "Solid work.", strengths: ["testing"], concerns: [], confidence: 0.8 },
    transfer: { transferScore: 80, roleFitRationale: "Fits." },
    authenticity: { band: "authentic", score: 90 },
  };
}

const job = (id: string, title: string): JobRecord => ({ id, title }) as unknown as JobRecord;

/** A whole assignment, JD down to a submission. `evaluate: false` leaves the
 *  submission un-evaluated, which is a real product state (received, not yet run). */
function assignment(opts: {
  candidateRef: string;
  jdSlug?: string | null;
  workspaceId?: string;
  scenario?: Record<string, unknown>;
  evaluate?: boolean;
}): { submissionId: string; caseId: string } {
  seq += 1;
  const ws = opts.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const kase = saveDevCase(
    {
      need: { title: `Need ${seq}`, jdSlug: opts.jdSlug ?? undefined },
      analysis: {},
      role: { title: `Backend Engineer ${seq}` },
      case: { title: `Case ${seq}` },
    },
    ws
  );
  if (opts.scenario) saveDevCaseScenario(kase.id, opts.scenario);
  const posting = createPosting({
    caseId: kase.id,
    channel: "local",
    token: `tok-screen-${seq}`,
    roleTitle: `Backend Engineer ${seq}`,
    caseTitle: `Case ${seq}`,
  });
  const { submission } = createSubmission({
    postingId: posting.id,
    candidateRef: opts.candidateRef,
    repoRef: `repo-screen-${seq}`,
  });
  if (opts.evaluate !== false) saveSubmissionEvaluation(submission.id, bundle(), 80);
  return { submissionId: submission.id, caseId: kase.id };
}

// --- resolving the entry a screen hangs off ---------------------------------

test("an already-promoted submission resolves to the entry it is already on", () => {
  const { submissionId } = assignment({ candidateRef: "Promoted Petra" });
  const promoted = promoteSubmission(submissionId, FLOOR);
  assert.ok(promoted);

  const resolved = resolveEntryForSubmission(submissionId, DEFAULT_WORKSPACE_ID);
  assert.deepEqual(resolved, { ok: true, entryId: promoted.entryId, promoted: false });
});

test("an un-promoted submission is promoted ON DEMAND, through the shared promote door", () => {
  const { submissionId, caseId } = assignment({ candidateRef: "Screen-first Sara" });
  // Precondition, stated rather than assumed: nothing is on the board for this person.
  assert.equal(findEntryByDevSubmission(submissionId), null);

  const resolved = resolveEntryForSubmission(submissionId, DEFAULT_WORKSPACE_ID);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.ok && resolved.promoted, true, "the caller is told the screen also put them on the board");

  const entry = getPipelineEntry((resolved as { entryId: string }).entryId);
  assert.ok(entry);
  assert.equal(entry.devSubmissionId, submissionId, "the entry names this submission");
  assert.equal(entry.devCaseId, caseId, "…and the assignment it came from");
  // The proof it went through promoteSubmission rather than a second minting path: the
  // identity rules and the reviewer's card are promote's, not this module's.
  const candidateId = entry.candidateId ?? "";
  assert.ok(candidateId.length > 0 && !candidateId.startsWith("ds-"), "a real profile id, never the synthetic candidate id");
  assert.equal(entry.approvalKind, "screening_review", "the same review card a manual promote writes");
  assert.equal(entry.matchScore, null, "and the same honest null match score");
});

test("resolving twice does not promote twice", () => {
  const { submissionId } = assignment({ candidateRef: "Twice Tomas" });
  const first = resolveEntryForSubmission(submissionId, DEFAULT_WORKSPACE_ID);
  const second = resolveEntryForSubmission(submissionId, DEFAULT_WORKSPACE_ID);
  assert.equal(first.ok && second.ok && first.entryId === second.entryId, true, "one entry, not two rows for one person");
  assert.equal(second.ok && second.promoted, false, "the second call finds what the first created");
});

test("an unknown submission id refuses", () => {
  assert.deepEqual(resolveEntryForSubmission("sub_does_not_exist", DEFAULT_WORKSPACE_ID), {
    ok: false,
    reason: "not_found",
  });
  assert.deepEqual(resolveEntryForSubmission("", DEFAULT_WORKSPACE_ID), { ok: false, reason: "not_found" });
});

test("another team's submission refuses — with the SAME answer as an unknown one", () => {
  const { submissionId } = assignment({ candidateRef: "Other-team Ondra", workspaceId: OTHER_WS });

  // Non-vacuity: the id is real and resolvable for its OWN team.
  assert.equal(resolveEntryForSubmission(submissionId, OTHER_WS).ok, true);

  // …and indistinguishable from nonsense for anybody else. A distinct refusal would
  // confirm which submission ids exist on other tenants, and this door can PROMOTE —
  // i.e. write a stranger's name and contact onto the caller's board.
  assert.deepEqual(resolveEntryForSubmission(submissionId, DEFAULT_WORKSPACE_ID), {
    ok: false,
    reason: "not_found",
  });
});

test("an unevaluated submission refuses rather than promoting an unmeasured candidate", () => {
  const { submissionId } = assignment({ candidateRef: "Unevaluated Ulla", evaluate: false });
  assert.deepEqual(resolveEntryForSubmission(submissionId, DEFAULT_WORKSPACE_ID), {
    ok: false,
    reason: "not_evaluated",
  });
  assert.equal(findEntryByDevSubmission(submissionId), null, "and nothing was written to the board");
});

// --- the reverse read the eval surface polls --------------------------------

test("the reverse lookup finds the entry from the submission, on the column and on the legacy id", () => {
  const linked = createPipelineEntry({
    candidateId: "profile-reverse",
    candidateLabel: "Reverse Rena",
    jobId: "jd-reverse",
    jobTitle: "Backend Engineer",
    devSubmissionId: "sub_reverse",
    workspaceId: DEFAULT_WORKSPACE_ID,
  });
  assert.equal(findEntryByDevSubmission("sub_reverse")?.id, linked.entry.id);

  // A pre-milestone row carries the meaning in the candidate id and NOTHING in the
  // column. Those rows are real hiring history; the read has to keep resolving them.
  const legacy = createPipelineEntry({
    candidateId: "ds-sub_legacy",
    candidateLabel: "Legacy Lada",
    jobId: "dc-case_legacy",
    jobTitle: "Dev case",
    workspaceId: DEFAULT_WORKSPACE_ID,
  });
  assert.equal(findEntryByDevSubmission("sub_legacy")?.id, legacy.entry.id);

  // Scoped: a submission id is globally unique, so an unscoped read would hand one
  // team another team's board row.
  assert.equal(findEntryByDevSubmission("sub_reverse", OTHER_WS), null);
  assert.equal(findEntryByDevSubmission("sub_never_promoted"), null);
});

// --- the grounding that only works on a real job id -------------------------

test("the case-grounded scenario still grounds the brief when the entry carries the JD's REAL job id", async () => {
  insertJob(job("jd-grounded-backend", "Backend Engineer (Prague)"), undefined, "published", DEFAULT_WORKSPACE_ID);
  // Early-career is the archetype the case-grounded script is written for, and it now
  // comes from the PERSON — so the candidate has to be one this team knows.
  const profile = saveProfile({
    label: "Grounded Gabca",
    archetype: "student",
    roleFamily: "software_engineering",
    completeness: 0.4,
    payload: {},
  });
  const scenario = {
    caseId: "will-be-ignored",
    roleTitle: "Backend Engineer",
    caseIntro: "Order notifications are sent twice to some customers.",
    durationMin: 25,
    phases: [{ phase: "Warm-up", caseGrounded: false }, { phase: "Mechanism probes", caseGrounded: true }],
  };
  const { submissionId } = assignment({ candidateRef: profile.id, jdSlug: "grounded-backend", scenario });

  const resolved = resolveEntryForSubmission(submissionId, DEFAULT_WORKSPACE_ID);
  assert.equal(resolved.ok, true);
  const entryId = (resolved as { entryId: string }).entryId;

  // NON-VACUITY: the entry names the JD's opening, NOT `dc-<caseId>`. Every consumer
  // that used to find the assignment by parsing that prefix sees nothing here — the
  // brief grounds only because devCaseIdForEntry reads the column instead.
  assert.equal(getPipelineEntry(entryId)?.jobId, "jd-grounded-backend");

  const grounded = await buildGroundedInterview(entryId);
  assert.deepEqual(grounded.runOfShow, ["Warm-up", "Mechanism probes"], "the run of show is the SCENARIO's, not the generic student script");
  assert.equal(grounded.durationMin, 25);
  assert.match(grounded.instructions, /Order notifications are sent twice/, "and the shared case material is narrated to the candidate");
  assert.equal(grounded.jobId, "jd-grounded-backend", "the screen is booked against the real opening");
});
