// ONE THREAD (gap 2) — "a transfer score is not a match score".
//
// What this pins, end to end on a real SQLite file:
//   1. `promoteSubmission` no longer writes the work-sample TRANSFER score into
//      `pipeline_entries.match_score`, and no longer mints a `?? 0` for a
//      submission that carries no transfer score at all. The entry lands honestly
//      UNSCORED for match.
//   2. The number is not lost with it: the entry's `dev_submission_id` link
//      resolves back to `dev_submissions.transfer_score`, and `withTransferScores`
//      stamps it onto the board payload as its OWN field.
//   3. `displayScoreOf` shows it WITH its kind, and a real match score always wins
//      the slot — while `canonicalScoreOf` (what every ranking/banding read in the
//      app uses) never sees the transfer score at all. That split is the whole
//      point: shown, never ranked.
//   4. Legacy "ds-" entries — written before the link column existed — resolve
//      through the prefix fallback, so history keeps its number.
//   5. The resolution is workspace-scoped: one team's board can never read a score
//      off another team's submission.
//
// IMPORT ORDER IS LOAD-BEARING: unit-db sets KP_DB_PATH before db-path.ts is
// evaluated by the transitive `@/app/_lib/db` import.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  createPipelineEntry,
  createPosting,
  createSubmission,
  getPipelineEntry,
  saveSubmissionEvaluation,
  transferScoresBySubmissionIds,
} from "./db.ts";
import { promoteSubmission } from "./devcase-run.ts";
import { withTransferScores } from "./pipeline-transfer-score.ts";
import { canonicalScoreOf, displayScoreOf } from "./match-score.ts";

after(() => cleanupUnitDb());

let seq = 0;

/** An evaluated submission on its own posting. `transferScore: null` models the
 *  submission whose evaluation carries no transfer score — the case the old
 *  `?? 0` turned into a genuine-looking zero. */
function makeSubmission(transferScore: number | null, candidateRef = `Candidate ${++seq}`): string {
  const posting = createPosting({
    caseId: `case-transfer-${seq}`,
    channel: "local",
    token: `tok-transfer-${seq}`,
    roleTitle: "Backend Engineer",
    caseTitle: "Mini API",
  });
  const { submission } = createSubmission({
    postingId: posting.id,
    candidateRef,
    repoRef: `repo-transfer-${seq}`,
  });
  saveSubmissionEvaluation(
    submission.id,
    {
      evaluation: { summary: "Solid work.", strengths: ["testing"], concerns: [], confidence: 0.8 },
      transfer: { transferScore: transferScore ?? 0, roleFitRationale: "Good fit." },
      authenticity: { band: "authentic", score: 90 },
    },
    // The column is what the board reads; a submission with no transfer score has
    // NULL here, not 0.
    transferScore as number
  );
  return submission.id;
}

test("promote leaves match_score NULL — the transfer score is not written in as a match", () => {
  const subId = makeSubmission(82);
  const result = promoteSubmission(subId, 55);
  assert.ok(result);
  const entry = getPipelineEntry(result!.entryId);
  assert.ok(entry, "the promote created an entry");
  assert.equal(
    entry!.matchScore,
    null,
    "match_score answers 'how does this profile fit the opening?' — a work-sample transfer score is a different question and must not occupy it"
  );
  assert.equal(entry!.devSubmissionId, subId, "…and the entry links to the submission the number really lives on");
});

test("a submission with NO transfer score mints no fabricated 0 anywhere", () => {
  const subId = makeSubmission(null);
  const result = promoteSubmission(subId, 55);
  assert.ok(result);
  const entry = getPipelineEntry(result!.entryId);
  assert.equal(entry!.matchScore, null, "an unmeasured candidate stays unmeasured (null-score policy)");
  const [stamped] = withTransferScores([entry!]);
  assert.equal(stamped.transferScore, null, "…and absence stays absent on the transfer axis too, never 0");
  assert.equal(displayScoreOf(stamped), null, "so the board shows no number at all, not a genuine-looking zero");
});

test("the transfer score reaches the board through the submission link, as its own kind", () => {
  const subId = makeSubmission(82);
  const result = promoteSubmission(subId, 55);
  const entry = getPipelineEntry(result!.entryId)!;

  const [stamped] = withTransferScores([entry]);
  assert.equal(stamped.transferScore, 82, "the board payload carries the work-sample score");

  const display = displayScoreOf(stamped);
  assert.deepEqual(display, { score: 82, provenance: { source: "transfer" }, kind: "transfer" });

  // The half that keeps it out of every ranking: canonicalScoreOf is what the board
  // sort, the score bands, the decisions peer rank and screen-wave all read.
  assert.equal(canonicalScoreOf(stamped), null, "a transfer score never ranks a candidate as if it were a match");
});

test("a real match score always wins the displayed slot, and keeps its own kind", () => {
  const subId = makeSubmission(82);
  const result = promoteSubmission(subId, 55);
  const entry = getPipelineEntry(result!.entryId)!;
  const [stamped] = withTransferScores([entry]);
  // As the automation sweep does once it scores the (now real) profile.
  const scored = { ...stamped, matchScore: 64 };
  const display = displayScoreOf(scored);
  assert.equal(display?.score, 64, "the match score is the score of record once one exists");
  assert.equal(display?.kind, "match");
  assert.equal(canonicalScoreOf(scored), 64);
});

test("a LEGACY ds- entry still resolves its transfer score, through the prefix fallback", () => {
  // Written before dev_submission_id existed: the meaning lived in the id.
  const subId = makeSubmission(71);
  const { entry } = createPipelineEntry({
    candidateId: `ds-${subId}`,
    candidateLabel: "Legacy Lena",
    jobId: "dc-case-legacy",
    jobTitle: "Dev case",
  });
  assert.equal(entry.devSubmissionId, null, "the legacy row carries nothing in the column");
  const [stamped] = withTransferScores([entry]);
  assert.equal(stamped.transferScore, 71, "…and is resolved from the prefix instead, so its history keeps its number");
});

test("one team's entry can never resolve a score off another team's submission", () => {
  const subId = makeSubmission(90);
  assert.equal(transferScoresBySubmissionIds([subId]).get(subId), 90, "resolves in its own workspace");
  assert.equal(
    transferScoresBySubmissionIds([subId], "some-other-team").size,
    0,
    "and not from a foreign one — submission ids are globally unique, so the WHERE is the only guard"
  );
});

test("entries with no assignment behind them cost no lookup and stamp null", () => {
  const { entry } = createPipelineEntry({
    candidateId: "profile-ordinary",
    candidateLabel: "Ordinary Ola",
    jobId: "jd-marketing",
    jobTitle: "Marketing",
    matchScore: 58,
  });
  const [stamped] = withTransferScores([entry]);
  assert.equal(stamped.transferScore, null);
  assert.equal(displayScoreOf(stamped)?.kind, "match", "the ordinary path is untouched");
});
