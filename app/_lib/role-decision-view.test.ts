// CX S45 - the pure role decision view: all-absent, partial and full candidates, the
// active filter, and that no absent part is ever a 0.
import { test } from "node:test";
import assert from "node:assert/strict";
import { activeForDecision, assembleRoleDecisionView, roleViewCandidate, type RoleViewFacts } from "./role-decision-view.ts";

const TERMINAL = new Set(["Hired"]);

function facts(over: Partial<Omit<RoleViewFacts, "entry">> & { entry?: Partial<RoleViewFacts["entry"]> } = {}): RoleViewFacts {
  return {
    entry: {
      id: "e1",
      candidateLabel: "Ada",
      stage: "Screened",
      status: "active",
      canonicalScore: null,
      scoreProvenance: null,
      caseId: null,
      submissionId: null,
      ...over.entry,
    },
    submission: over.submission ?? null,
    humanScorecards: over.humanScorecards ?? [],
    aiScorecard: over.aiScorecard ?? null,
  };
}

test("all absent: every part is a null with its reason, never 0", () => {
  const c = roleViewCandidate(facts(), 5);
  assert.deepEqual(c.match, { score: null, provenance: null, reason: "not_scored" });
  assert.deepEqual(c.workSample, { transferScore: null, reason: "not_sent", source: null, grading: null, ladder: null });
  assert.deepEqual(c.interview.human, { average: null, count: 0, reason: "no_scorecard" });
  assert.deepEqual(c.interview.ai, { average: null, count: 0, reason: "no_scorecard" });
  assert.equal(c.interview.scale, 5);
});

test("partial: a work sample sent but not submitted keeps its ladder and says why there is no score", () => {
  const c = roleViewCandidate(facts({ entry: { caseId: "case-1", canonicalScore: 64, scoreProvenance: { source: "snapshot" } } }), 5);
  assert.deepEqual(c.match, { score: 64, provenance: { source: "snapshot" }, reason: null });
  assert.equal(c.workSample.transferScore, null);
  assert.equal(c.workSample.reason, "not_submitted");
  assert.deepEqual(c.workSample.ladder?.watched, { acts: null, witness: null, reason: "not_evaluated" });
  assert.equal(c.workSample.ladder?.hold, "none");
});

test("partial: a submission with no evaluation is not_evaluated, not a 0", () => {
  const c = roleViewCandidate(
    facts({ entry: { submissionId: "s1" }, submission: { transferScore: null, evaluation: null, debrief: { total: 0, recorded: false } } }),
    5,
  );
  assert.equal(c.workSample.transferScore, null);
  assert.equal(c.workSample.reason, "not_evaluated");
});

test("full: transfer score from the submission, its grading, the ladder summary and both interview averages", () => {
  const evaluation = {
    source: "deterministic",
    tooling: { signals: { editedTest: true } },
    observedChecks: { promptSignals: { verificationAsks: 2 } },
    integrity: { witness: { verdict: "witnessed" } },
  };
  const c = roleViewCandidate(
    facts({
      entry: { submissionId: "s1", canonicalScore: 70, scoreProvenance: { source: "scored", at: "2026-10-01" } },
      submission: {
        transferScore: 72.4,
        evaluation,
        debrief: { total: 2, recorded: true, findings: [{ kind: "supported" }, { kind: "supported" }], held: true, clearedBy: null },
      },
      humanScorecards: [
        { ratings: [{ competency: "A", rating: 4 }, { competency: "B", rating: 5 }] },
        { ratings: [{ competency: "Working with AI tools", rating: 3 }] },
      ],
      aiScorecard: { ratings: [{ competency: "A", rating: 3, evidence: "Not assessed." }, { competency: "B", rating: 2, evidence: "said so" }] },
    }),
    5,
  );
  assert.equal(c.workSample.transferScore, 72);
  assert.equal(c.workSample.source, "submission");
  assert.equal(c.workSample.grading, "template", "a deterministic bundle is the template instrument");
  assert.deepEqual(c.workSample.ladder, {
    watched: { acts: 3, witness: "witnessed", reason: null },
    defended: { supported: 2, total: 2, reason: null },
    hold: "held",
    quoted: { rated: true, count: 1, reason: null },
  });
  assert.deepEqual(c.interview.human, { average: 4, count: 2, reason: null });
  assert.deepEqual(c.interview.ai, { average: 2, count: 1, reason: null }, "the not-assessed sentinel is not a rating");
});

test("a cleared hold reads cleared; a scorecard with only sentinels has no average", () => {
  const c = roleViewCandidate(
    facts({
      entry: { submissionId: "s1" },
      submission: { transferScore: 50, evaluation: { source: "llm" }, debrief: { total: 0, held: false, clearedBy: "ops" } },
      aiScorecard: { ratings: [{ competency: "A", rating: 3, evidence: "Not assessed (auto-synthesis unavailable)." }] },
    }),
    5,
  );
  assert.equal(c.workSample.grading, "graded");
  assert.equal(c.workSample.ladder?.hold, "cleared");
  assert.deepEqual(c.workSample.ladder?.defended, { supported: null, total: null, reason: "no_followups" });
  assert.deepEqual(c.interview.ai, { average: null, count: 1, reason: "no_ratings" });
});

test("only active candidates: terminal statuses and the terminal stage drop out", () => {
  assert.equal(activeForDecision({ status: "active", stage: "Interview" }, TERMINAL), true);
  assert.equal(activeForDecision({ status: "active", stage: "Hired" }, TERMINAL), false);
  for (const status of ["rejected", "declined", "rematched", "role_closed"]) {
    assert.equal(activeForDecision({ status, stage: "Screened" }, TERMINAL), false, status);
  }
  const view = assembleRoleDecisionView(
    "jd-x",
    [facts({ entry: { id: "a" } }), facts({ entry: { id: "b", status: "rejected" } }), facts({ entry: { id: "c", stage: "Hired" } })],
    TERMINAL,
    5,
  );
  assert.deepEqual(view.candidates.map((c) => c.entryId), ["a"]);
  assert.equal(view.active, "status_active_not_terminal_stage");
});
