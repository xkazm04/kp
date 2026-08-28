// ONE THREAD — "promote joins, never mints".
//
// promoteSubmission used to invent three things it had no right to invent: a job
// (`dc-<caseId>`), a candidate (`ds-<submissionId>`), and an archetype ("bau"). The
// consequences compounded: the same person sat on the board twice under two job ids,
// Matrix/Match could not rank the assignment half because no `profiles` row stood
// behind a "ds-" id, and every dev-case candidate was permanently labelled an
// experienced professional — which, being outside the fairness-protected set, removed
// their shield from automated rejection.
//
// These pin the joins that replaced each invention, and — just as important — the
// states where a join is NOT available and the honest fallback has to survive: a case
// whose JD was never sourced into a job, and a candidate this team has never seen.
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
  getPipelineEntry,
  listPipeline,
  listPipelineEventsForEntry,
  saveDevCase,
  saveDevCaseScenario,
  saveProfile,
  saveSubmissionEvaluation,
} from "./db.ts";
import { getProfileRecord } from "./db/profiles.ts";
import { insertJob } from "./job-ingest.ts";
import type { JobRecord } from "./db/core.ts";
import { promoteSubmission } from "./devcase-run.ts";
import { devCaseIdForEntry, DEVCASE_FALLBACK_ROLE_FAMILY, DEVCASE_PROMOTE_STAGE, submissionIdForEntry } from "./devcase-identity.ts";
import { plannedInterviewMinutes } from "./interview-planned-minutes.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";

after(() => cleanupUnitDb());

const FLOOR = 55;
let seq = 0;

function bundle() {
  return {
    evaluation: { summary: "Solid work.", strengths: ["testing"], concerns: [], confidence: 0.8 },
    transfer: { transferScore: 80, roleFitRationale: "Fits." },
    authenticity: { band: "authentic", score: 90 },
  };
}

/** A whole assignment, from the JD down to an evaluated submission. `jdSlug` is what
 *  decides whether the case has a linked job — saveDevCase resolves it and VERIFIES
 *  the `jobs` row exists, so passing a slug with no job is how the unlinked state is
 *  reached honestly rather than by nulling a column by hand. */
function assignment(opts: {
  jdSlug?: string | null;
  needRoleFamily?: string;
  candidateRef: string;
  contact?: string;
  workspaceId?: string;
  scenario?: Record<string, unknown>;
}): { submissionId: string; caseId: string } {
  seq += 1;
  const ws = opts.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const kase = saveDevCase(
    {
      need: { title: `Need ${seq}`, jdSlug: opts.jdSlug ?? undefined, roleFamily: opts.needRoleFamily },
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
    token: `tok-${seq}`,
    roleTitle: `Backend Engineer ${seq}`,
    caseTitle: `Case ${seq}`,
  });
  const { submission } = createSubmission({
    postingId: posting.id,
    candidateRef: opts.candidateRef,
    repoRef: `repo-${seq}`,
    contact: opts.contact,
  });
  saveSubmissionEvaluation(submission.id, bundle(), 80);
  return { submissionId: submission.id, caseId: kase.id };
}

const job = (id: string, title: string, roleFamily?: string): JobRecord =>
  ({ id, title, roleFamily }) as unknown as JobRecord;

// --- job identity -----------------------------------------------------------

test("a promote with a LINKED job files the candidate on that real opening", () => {
  insertJob(job("jd-linked-backend", "Backend Engineer (Prague)", "data_ai"), undefined, "published", DEFAULT_WORKSPACE_ID);
  const { submissionId, caseId } = assignment({ jdSlug: "linked-backend", candidateRef: "Linked Lena" });

  const result = promoteSubmission(submissionId, FLOOR);
  assert.ok(result);
  const entry = getPipelineEntry(result.entryId);
  assert.ok(entry);

  // NON-VACUITY: before this change the id was `dc-<caseId>` — a value that exists in
  // no `jobs` row and that the JD's own board could never show.
  assert.equal(entry.jobId, "jd-linked-backend", "the entry lands on the JD's own opening");
  assert.equal(entry.jobTitle, "Backend Engineer (Prague)", "…under that opening's title, not the case's");
  assert.equal(entry.roleFamily, "data_ai", "the family is STATED by the job, not the old hardcoded literal");
  // The assignment is not lost by moving the job id to a real one — it moved to a column.
  assert.equal(entry.devCaseId, caseId);
  assert.equal(entry.devSubmissionId, submissionId);
  assert.equal(devCaseIdForEntry(entry), caseId, "so the case-grounded interview still resolves");
  assert.equal(submissionIdForEntry(entry), submissionId, "and so does the eval bundle");
  assert.equal(entry.stage, DEVCASE_PROMOTE_STAGE);
});

test("a case whose JD was never sourced keeps the synthetic job — the link is not invented", () => {
  // The load-bearing NULL. `resolveCaseJobId` refuses to write `jd-<slug>` for a JD
  // with no ingested job, so this is the state a real best-effort ingest failure
  // produces, reached the same way the product reaches it.
  const { submissionId, caseId } = assignment({ jdSlug: "never-ingested", candidateRef: "Unlinked Ulla" });
  const result = promoteSubmission(submissionId, FLOOR);
  const entry = getPipelineEntry(result!.entryId);
  assert.equal(entry?.jobId, `dc-${caseId}`, "no job to join to ⇒ the honest synthetic id, not a dangling jd- reference");
  assert.equal(entry?.devCaseId, caseId, "and the assignment link is present either way");
  assert.equal(entry?.roleFamily, DEVCASE_FALLBACK_ROLE_FAMILY, "with nothing stating a family, the documented last resort");
});

test("with no job, the NEED's stated role family still beats the last-resort literal", () => {
  const { submissionId } = assignment({ jdSlug: null, needRoleFamily: "skilled_trades", candidateRef: "Trades Tomas" });
  const result = promoteSubmission(submissionId, FLOOR);
  assert.equal(getPipelineEntry(result!.entryId)?.roleFamily, "skilled_trades");
});

// --- candidate identity -----------------------------------------------------

test("a candidateRef that IS a profile id resolves to that person", () => {
  const profile = saveProfile({ label: "Known Klara", archetype: "student", roleFamily: null, completeness: 0.4, payload: {} });
  const { submissionId } = assignment({ candidateRef: profile.id });
  const result = promoteSubmission(submissionId, FLOOR);
  const entry = getPipelineEntry(result!.entryId);
  assert.equal(entry?.candidateId, profile.id, "a real profile id, never `ds-<submissionId>`");
  assert.equal(entry?.archetype, "student", "and the archetype is the PERSON's, not a hardcoded 'bau'");
});

test("the same person who applied to the JD directly ends up as ONE row, not two", () => {
  // The defect the milestone is named for. Jana applies to the opening; later she does
  // the work sample under a free-text name. Both must be the same candidate on the
  // same job — which is only possible because the entry now holds a real job id and a
  // real profile id, so the (candidate, job) dedupe key actually collides.
  insertJob(job("jd-onethread", "One Thread Role", "software_engineering"), undefined, "published", DEFAULT_WORKSPACE_ID);
  const profile = saveProfile({ label: "Jana Nová", archetype: "bau", roleFamily: null, completeness: 0.7, payload: {} });
  const applied = createPipelineEntry({
    candidateId: profile.id,
    candidateLabel: "Jana Nová",
    jobId: "jd-onethread",
    jobTitle: "One Thread Role",
    contact: "jana.novak@example.com",
    workspaceId: DEFAULT_WORKSPACE_ID,
  });
  assert.equal(applied.created, true);
  const before = listPipeline(DEFAULT_WORKSPACE_ID).filter((e) => e.candidateId === profile.id).length;
  assert.equal(before, 1);

  const { submissionId, caseId } = assignment({
    jdSlug: "onethread",
    // Deliberately NOT her profile id and NOT her exact label — the address is the
    // only thing tying the two events together, which is the realistic case.
    candidateRef: "jana n.",
    contact: "JANA.NOVAK@example.com",
  });
  const result = promoteSubmission(submissionId, FLOOR);

  assert.equal(result!.entryId, applied.entry.id, "the promote lands on the entry she already had");
  const after = listPipeline(DEFAULT_WORKSPACE_ID).filter((e) => e.candidateId === profile.id);
  assert.equal(after.length, 1, "one person, one row — this was TWO before the change");
  const entry = getPipelineEntry(applied.entry.id);
  assert.equal(entry?.devCaseId, caseId, "the assignment is backfilled onto that row");
  assert.equal(entry?.devSubmissionId, submissionId);
});

test("an unknown candidate gets a REAL minimal profile, with the fail-closed archetype", () => {
  const { submissionId } = assignment({ candidateRef: "Stranger Stepan", contact: "stepan@example.com" });
  const result = promoteSubmission(submissionId, FLOOR);
  const entry = getPipelineEntry(result!.entryId);
  assert.ok(entry?.candidateId, "there is a candidate id");
  assert.ok(!entry!.candidateId!.startsWith("ds-"), "and it is not the old synthetic one");

  const rec = getProfileRecord(entry!.candidateId!);
  assert.ok(rec, "it names a profiles row Matrix/Match can actually rank");
  assert.equal(rec.row.label, "Stranger Stepan");
  assert.equal(rec.row.completeness, 0, "the schema's own 'nothing known yet' marker");
  // The fairness point, stated as an assertion because it is the reason for the
  // sentinel: "bau" is a concrete class (experienced) and is NOT fairness-protected,
  // so the old literal stripped every dev-case candidate's shield from auto-rejection.
  assert.equal(rec.row.archetype, "unknown");
  assert.equal(entry!.archetype, "unknown");
});

test("an AMBIGUOUS label mints rather than guessing between two real people", () => {
  saveProfile({ label: "Twin Tereza", archetype: "bau", roleFamily: null, completeness: null, payload: {} });
  saveProfile({ label: "Twin Tereza", archetype: "student", roleFamily: null, completeness: null, payload: {} });
  const { submissionId } = assignment({ candidateRef: "Twin Tereza" });
  const result = promoteSubmission(submissionId, FLOOR);
  const entry = getPipelineEntry(result!.entryId);
  const rec = getProfileRecord(entry!.candidateId!);
  assert.equal(rec?.row.archetype, "unknown", "a fresh stub — resolving would have written evidence onto a coin flip");
});

// --- the trail --------------------------------------------------------------

test("the automation trail records HOW each identity was reached", () => {
  // Reconstructing this later is impossible: the entry shows the OUTCOME, never
  // whether the job was joined or synthesized, or the candidate found or created —
  // and "we made this person up" is precisely what a reviewer needs to know.
  insertJob(job("jd-trail", "Trail Role"), undefined, "published", DEFAULT_WORKSPACE_ID);
  const { submissionId } = assignment({ jdSlug: "trail", candidateRef: "Trail Tomas" });
  const result = promoteSubmission(submissionId, FLOOR);

  const detail = listPipelineEventsForEntry(result!.entryId).find((e) => e.kind === "screening_hold")?.detail ?? "";
  assert.ok(detail.includes("floor 55"), "the verdict still explains itself against its floor");
  assert.ok(detail.includes("job jd-trail"), "…and names the opening it joined to");
  assert.ok(detail.includes("linked JD"), "…saying it was a join, not a synthesis");
  assert.ok(/candidate \S+ \(minted\)/.test(detail), "…and that this candidate was created, not recognized");

  // The unlinked/synthetic half says so just as plainly.
  const unlinked = promoteSubmission(assignment({ candidateRef: "Trail Tereza" }).submissionId, FLOOR);
  const unlinkedDetail = listPipelineEventsForEntry(unlinked!.entryId).find((e) => e.kind === "screening_hold")?.detail ?? "";
  assert.ok(unlinkedDetail.includes("no linked JD"), "an assignment with no opening is not passed off as one");
});

// --- legacy compatibility ---------------------------------------------------

test("an entry written BEFORE this change still resolves its case and submission", () => {
  // Hand-built in the pre-milestone shape: everything in the ids, nothing in the
  // columns. These rows are real hiring history — they must never stop resolving.
  const { submissionId, caseId } = assignment({ candidateRef: "Legacy Lukas" });
  const legacy = createPipelineEntry({
    candidateId: `ds-${submissionId}`,
    candidateLabel: "Legacy Lukas",
    archetype: "student",
    jobId: `dc-${caseId}`,
    jobTitle: "Dev case",
    stage: DEVCASE_PROMOTE_STAGE,
    workspaceId: DEFAULT_WORKSPACE_ID,
  });
  assert.equal(legacy.entry.devCaseId, null, "precondition: the legacy row has no columns to read");
  assert.equal(devCaseIdForEntry(legacy.entry), caseId, "the case is still recovered, from the prefix");
  assert.equal(submissionIdForEntry(legacy.entry), submissionId, "and so is the submission");
});

test("the case-grounded interview resolves for BOTH id shapes", () => {
  // The consumer that broke first when the job id became real: plannedInterviewMinutes
  // resolves the case from the entry to promise the scenario's own length. A scenario
  // of 34 minutes is nothing else in the estimator's ladder, so a passing assertion
  // can only mean the case was found.
  const scenario = { caseId: "x", roleTitle: "R", caseIntro: "intro", durationMin: 34, phases: [{ phase: "Mechanism", probe: "why", caseGrounded: true }] };
  insertJob(job("jd-scenario", "Scenario Role"), undefined, "published", DEFAULT_WORKSPACE_ID);
  const early = saveProfile({ label: "Student Sara", archetype: "student", roleFamily: null, completeness: 0.3, payload: {} });
  const { submissionId, caseId } = assignment({ jdSlug: "scenario", candidateRef: early.id, scenario });

  const promoted = getPipelineEntry(promoteSubmission(submissionId, FLOOR)!.entryId);
  assert.equal(promoted?.jobId, "jd-scenario", "precondition: the job id no longer spells out the case");
  assert.equal(plannedInterviewMinutes(promoted!), 34, "the scenario is still found — via dev_case_id");

  const legacy = createPipelineEntry({
    candidateId: early.id,
    candidateLabel: "Student Sara",
    archetype: "student",
    jobId: `dc-${caseId}`,
    jobTitle: "Dev case",
    workspaceId: DEFAULT_WORKSPACE_ID,
  });
  assert.equal(plannedInterviewMinutes(legacy.entry), 34, "…and via the legacy prefix for older entries");
});

// --- tenancy ----------------------------------------------------------------

test("every identity promote resolves or creates belongs to the submission's own team", () => {
  // The tenancy shape devcase-source-promote-tenancy.test.ts pins for the entry, now
  // extended to the two writes this change adds: the profile lookup and the mint. A
  // minted profile landing on the default team would put a real candidate's record in
  // another company's roster — the worst version of the bug the tenant fix closed.
  const WS_B = "team-promote-identity-b";
  const { submissionId } = assignment({ candidateRef: "Tenant Tomas", contact: "tenant@example.com", workspaceId: WS_B });
  const result = promoteSubmission(submissionId, FLOOR);
  const entry = getPipelineEntry(result!.entryId, WS_B);
  assert.ok(entry, "the entry is on the promoting team's board");
  assert.equal(entry.workspaceId, WS_B);
  assert.equal(getPipelineEntry(result!.entryId, DEFAULT_WORKSPACE_ID), null, "and not on the default team's");

  assert.ok(getProfileRecord(entry.candidateId!, WS_B), "the minted profile is that team's");
  assert.equal(getProfileRecord(entry.candidateId!, DEFAULT_WORKSPACE_ID), null, "and invisible to the default team");
});
