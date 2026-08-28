// ONE THREAD (gap 3) — observed skills flow from the case AND the interview into
// scoring, for ANY archetype.
//
// The deepest evidence this product produces is an `observed`-provenance skill:
// taxonomy.py weights it 1.0, above `professional`, against a self-declared claim's
// 0.4. Two things kept it from reaching the candidates it was minted for:
//
//   * `mintObservedFromCaseInterview` returned early unless `isEarlyCareer(entry.archetype)`,
//     so a case-grounded interview was evidence for students and career switchers only;
//   * every promoted dev-case entry was hardcoded `archetype: "bau"` and
//     `candidateId: "ds-<submissionId>"` — an id with no `profiles` row behind it — so
//     BOTH mint paths missed: the interview one by archetype, the take-home one because
//     there was no profile to credit.
//
// d60fa012 gave the promoted entry a real profile and its real archetype; this suite
// runs the whole thread end to end on a real SQLite file and the real (deterministic,
// LLM-free) `devcase_cli` — promote a BAU candidate, mint from the submission's own
// evaluation, mint again from a case-grounded interview — and asserts the profile ends
// up carrying `observed` evidence both times. The scoring half (that the matcher really
// weights it for a bau profile, not just a student one) is pinned on the Python side in
// `pipeline/jobfit/tests/test_live_case.py::ObservedIsArchetypeIndependentTest`.
//
// IMPORT ORDER IS LOAD-BEARING: unit-db sets KP_DB_PATH before db-path.ts is evaluated.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  createPosting,
  createSubmission,
  getPipelineEntry,
  getProfileRecord,
  saveDevCase,
  saveDevCaseScenario,
  saveProfile,
  saveSubmissionEvaluation,
} from "./db.ts";
import { isEarlyCareer } from "./archetypes.ts";
import { mintObservedFromCaseInterview, mintObservedFromSubmission, promoteSubmission } from "./devcase-run.ts";

after(() => cleanupUnitDb());

// The constructs the case-grounded interview phases feed, mirrored from
// pipeline/jobfit/live_case.py's CASE_CONSTRUCTS (derived there from
// interview-script.json). Every one must be rated on real quoted evidence or the
// Python gate refuses to mint.
const CASE_CONSTRUCTS = ["Conceptual depth", "Problem decomposition", "Coachability", "Learning agility"];

function caseScorecard(rating = 4) {
  return {
    ratings: CASE_CONSTRUCTS.map((competency) => ({
      competency,
      rating,
      evidence: `"quoted answer about ${competency}"`,
    })),
    summary: "Strong case discussion.",
    recommendation: "advance",
    confidence: { level: "moderate", reason: "test" },
  };
}

let seq = 0;

/** An experienced ("bau") candidate this team already knows, whose skills are only
 *  SELF-DECLARED — the shape the observed mint is supposed to upgrade. */
function seedExperiencedCandidate(label: string): string {
  const { id } = saveProfile({
    label,
    archetype: "bau",
    roleFamily: "software_engineering",
    completeness: 0.5,
    payload: {
      displayName: label,
      archetype: "bau",
      roleFamily: "software_engineering",
      seniority: "mid",
      languages: ["English"],
      skillClaims: [
        { skill: "Python", provenance: "self_declared" },
        { skill: "SQL", provenance: "self_declared" },
      ],
    },
  });
  return id;
}

/** A whole assignment: an approved case with its role + case artifacts, a posting,
 *  and one evaluated submission from `candidateRef`. */
function seedAssignment(candidateRef: string, opts: { withScenario?: boolean } = {}) {
  seq += 1;
  const kase = saveDevCase({
    need: { title: "Backend Engineer", roleFamily: "software_engineering" },
    analysis: {},
    role: {
      title: "Backend Engineer",
      seniority: "mid",
      roleFamily: "software_engineering",
      mustHaves: ["Python", "SQL"],
    },
    case: { title: "Mini API" },
  });
  if (opts.withScenario) {
    // Only a case that carries a generated interview scenario counts as
    // case-grounded — the gate that REMAINS after the archetype one was lifted.
    saveDevCaseScenario(kase.id, { phases: [{ id: "case", caseGrounded: true }] });
  }
  const posting = createPosting({
    caseId: kase.id,
    channel: "local",
    token: `tok-observed-${seq}`,
    roleTitle: "Backend Engineer",
    caseTitle: "Mini API",
  });
  const { submission } = createSubmission({
    postingId: posting.id,
    candidateRef,
    repoRef: `repo-observed-${seq}`,
  });
  saveSubmissionEvaluation(
    submission.id,
    {
      evaluation: { summary: "Handled ambiguity well.", strengths: ["testing"], concerns: [], confidence: 0.8 },
      transfer: {
        transferScore: 82,
        transfers: ["Python", "SQL"],
        confidence: 0.8,
        roleFitRationale: "Both must-haves carried across.",
      },
      authenticity: { band: "authentic", score: 90 },
    },
    82
  );
  return { caseId: kase.id, submissionId: submission.id };
}

function observedSkillsOf(profileId: string): string[] {
  const rec = getProfileRecord(profileId);
  assert.ok(rec, "the profile is still on file");
  const evidence = ((rec!.payload as { evidence?: Array<Record<string, unknown>> }).evidence ?? []).filter(
    (e) => e.provenance === "observed"
  );
  return evidence.flatMap((e) => (e.skills as string[]) ?? []);
}

test("the fixture really is the case the gate used to exclude", () => {
  assert.equal(isEarlyCareer("bau"), false, "'bau' is not early-career — the old gate returned false here and minted nothing");
});

test("promoting a bau candidate's work sample credits them observed skills", async () => {
  const profileId = seedExperiencedCandidate("Dana Novak");
  const { submissionId } = seedAssignment("Dana Novak");

  const promoted = promoteSubmission(submissionId, 55);
  assert.ok(promoted);
  const entry = getPipelineEntry(promoted!.entryId);
  assert.equal(entry!.candidateId, profileId, "promote resolved the person this team already knows");
  assert.equal(entry!.archetype, "bau", "…and carries their real archetype, not the old hardcoded one");

  const { credited, applied } = await mintObservedFromSubmission(submissionId, promoted!.entryId);
  assert.equal(applied, true, "the take-home mint runs for an experienced candidate");
  assert.deepEqual(credited.slice().sort(), ["Python", "SQL"]);

  assert.deepEqual(
    observedSkillsOf(profileId).slice().sort(),
    ["Python", "SQL"],
    "the demonstrated skills are persisted at observed provenance — taxonomy weight 1.0, against 0.4 for the self-declared claims they replace"
  );
});

test("a case-grounded interview credits a bau candidate too (the lifted archetype gate)", async () => {
  const profileId = seedExperiencedCandidate("Marek Dvorak");
  const { submissionId } = seedAssignment("Marek Dvorak", { withScenario: true });
  const promoted = promoteSubmission(submissionId, 55);
  assert.ok(promoted);

  const { credited, applied } = await mintObservedFromCaseInterview(promoted!.entryId, caseScorecard());
  assert.equal(applied, true, "an experienced candidate's case-grounded interview is evidence, not a no-op");
  assert.deepEqual(credited.slice().sort(), ["Python", "SQL"]);
  assert.deepEqual(observedSkillsOf(profileId).slice().sort(), ["Python", "SQL"]);
});

test("the gate that stays: an interview on a case with no scenario mints nothing", async () => {
  const profileId = seedExperiencedCandidate("Petra Havel");
  const { submissionId } = seedAssignment("Petra Havel"); // no scenario
  const promoted = promoteSubmission(submissionId, 55);

  const result = await mintObservedFromCaseInterview(promoted!.entryId, caseScorecard());
  assert.deepEqual(result, { credited: [], applied: false }, "without a generated scenario the conversation was not case-grounded");
  assert.deepEqual(observedSkillsOf(profileId), []);
});

test("the honest gates still bite: a weak case-grounded interview credits nothing", async () => {
  const profileId = seedExperiencedCandidate("Jana Kral");
  const { submissionId } = seedAssignment("Jana Kral", { withScenario: true });
  const promoted = promoteSubmission(submissionId, 55);

  // Every construct at 3/5, below the "Above bar" mean the Python gate requires.
  const result = await mintObservedFromCaseInterview(promoted!.entryId, caseScorecard(3));
  assert.deepEqual(result, { credited: [], applied: false }, "lifting the archetype gate did not lift the competence bar");
  assert.deepEqual(observedSkillsOf(profileId), []);
});
