// Pins the person-first silver-medalist feed (challenge-r08 candidate-rediscovery/B).
//
// The feed used to list person x role PAIRS in insertion order, while its outcome
// state was keyed by PERSON: adding Jana to role Y painted "Added" on Jana x Z too
// and refused to add her to Z at all. These cases pin the replacement: one group
// per person, her roles ranked by the SAME band-limited comparator the on-demand
// panel uses (byPriorAwareRank), outcomes keyed by pair, and only an anonymization
// refusal lifted to the whole person.
//
// Runner: node --test with type stripping (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { reachOutVerdict } from "../../../_lib/useReachOut.ts";
import { extractRow, restoreRow } from "./jobsRediscoveryDismiss.ts";
import {
  applyAddOutcome,
  applyReachOut,
  emptyOutcomes,
  groupAlertsByPerson,
  groupView,
  markPair,
  pairStatus,
} from "./jobsRediscoveryFeedGroups.ts";
import type { Alert } from "./jobsRediscoveryFeedTypes.ts";

function alert(candidateId: string, jobId: string, score: number, depth: number | null, stage: string | null = "Screen"): Alert {
  return {
    id: `${candidateId}-${jobId}`,
    jobId,
    jobTitle: `Role ${jobId}`,
    candidateId,
    label: candidateId === "jana" ? "Jana K." : "Petr N.",
    archetype: "builder",
    score,
    prior: { kind: "rejected", label: "Rejected", stage, depth },
  };
}

const ids = (as: Alert[]) => as.map((a) => a.jobId);

test("groups one row per person, best group first, her roles ranked by the panel's comparator", () => {
  const groups = groupAlertsByPerson([alert("jana", "Y", 78, 0), alert("jana", "Z", 71, 0), alert("petr", "Y", 80, 0)]);
  assert.deepEqual(groups.map((g) => g.candidateId), ["petr", "jana"]);
  const jana = groups[1];
  assert.deepEqual(ids(jana.roles), ["Y", "Z"]);
  assert.equal(jana.best.jobId, "Y");
  assert.equal(jana.label, "Jana K.");
});

test("the prior-depth boost reorders within the band and never across it", () => {
  const inBand = groupAlertsByPerson([alert("petr", "Y", 78, 0), alert("jana", "Y", 76, 3)]);
  assert.deepEqual(inBand.map((g) => g.candidateId), ["jana", "petr"], "76 + 3 outranks 78 + 0");
  const acrossBand = groupAlertsByPerson([alert("jana", "Y", 70, 5), alert("petr", "Y", 80, 0)]);
  assert.deepEqual(acrossBand.map((g) => g.candidateId), ["petr", "jana"], "a 10-point lead is never crossed");
});

test("an outcome belongs to the pair, not to the person", () => {
  const s = markPair(emptyOutcomes(), "jana", "Y", "added");
  assert.equal(pairStatus(s, "jana", "Y"), "added");
  assert.equal(pairStatus(s, "jana", "Z"), "open");
  assert.equal(pairStatus(emptyOutcomes(), "jana", "Y"), "open");
});

test("the row's next action targets the best role still open, not the one already filed", () => {
  const [jana] = groupAlertsByPerson([alert("jana", "Y", 78, 0), alert("jana", "Z", 71, 0)]);
  const view = groupView(jana, markPair(emptyOutcomes(), "jana", "Y", "added"));
  assert.equal(view.next?.jobId, "Z");
  assert.deepEqual(ids(view.done), ["Y"]);
  assert.deepEqual(ids(view.rest), []);
  assert.deepEqual(ids(view.withheld), []);
});

test("an anonymization refusal withholds the whole person; any other verdict moves only its pair", () => {
  const [jana] = groupAlertsByPerson([alert("jana", "Y", 78, 0), alert("jana", "Z", 71, 0), alert("jana", "W", 60, 0)]);
  const anon = applyReachOut(emptyOutcomes(), "jana", "Y", reachOutVerdict("suppressed_anonymized"));
  for (const job of ["Y", "Z", "W"]) assert.equal(pairStatus(anon, "jana", job), "withheld");
  const anonView = groupView(jana, anon);
  assert.equal(anonView.next, null, "nothing is offered for a withheld person");
  assert.deepEqual(ids(anonView.withheld), ["Y", "Z", "W"]);

  const sent = applyReachOut(emptyOutcomes(), "jana", "Y", reachOutVerdict("already_sent"));
  assert.equal(pairStatus(sent, "jana", "Y"), "reached");
  assert.equal(pairStatus(sent, "jana", "Z"), "open");

  // A consent / sequence suppression is not lifted to the person (critic: scope the
  // person-level mark to anonymization) — only the pair it was answered for.
  const suppressed = applyReachOut(emptyOutcomes(), "jana", "Y", reachOutVerdict("suppressed_consent_expired"));
  assert.equal(pairStatus(suppressed, "jana", "Y"), "withheld");
  assert.equal(pairStatus(suppressed, "jana", "Z"), "open");

  const failed = applyReachOut(emptyOutcomes(), "jana", "Y", {
    ok: false,
    suppression: null,
    code: null,
    capability: null,
    status: null,
  });
  assert.equal(pairStatus(failed, "jana", "Y"), "error");
  assert.equal(groupView(jana, failed).next?.jobId, "Y", "a failed pair stays actionable (retry)");
});

test("dismissing a pair shrinks the person's group; restoring it re-sorts the group", () => {
  const flat = [alert("jana", "Y", 78, 0), alert("petr", "Y", 60, 0), alert("jana", "Z", 71, 0)];
  const first = extractRow(flat, "jana-Y");
  assert.deepEqual(ids(groupAlertsByPerson(first.next ?? []).find((g) => g.candidateId === "jana")!.roles), ["Z"]);
  const second = extractRow(first.next, "jana-Z");
  assert.equal(groupAlertsByPerson(second.next ?? []).some((g) => g.candidateId === "jana"), false);
  const back = restoreRow(first.next, first.removed);
  assert.deepEqual(ids(groupAlertsByPerson(back ?? []).find((g) => g.candidateId === "jana")!.roles), ["Y", "Z"]);
});

test("a legacy row (no stage, no depth) groups with depth treated as 0, never NaN", () => {
  const groups = groupAlertsByPerson([alert("jana", "Y", 70, null, null), alert("jana", "Z", 72, null, null), alert("petr", "Y", 71, 0)]);
  assert.deepEqual(groups.map((g) => g.candidateId), ["jana", "petr"]);
  assert.deepEqual(ids(groups[0].roles), ["Z", "Y"]);
});

test("the add door's eligibility refusal withholds the person; any other failure stays a retryable pair error", () => {
  const [jana] = groupAlertsByPerson([alert("jana", "Y", 78, 0), alert("jana", "Z", 71, 0)]);
  const refused = applyAddOutcome(emptyOutcomes(), "jana", "Y", { ok: false, code: "PIPELINE_ADD_CANDIDATE_WITHHELD" });
  assert.equal(groupView(jana, refused).next, null, "no Add or Reach out is offered on any of her roles");
  assert.deepEqual(ids(groupView(jana, refused).withheld), ["Y", "Z"]);
  const failed = applyAddOutcome(emptyOutcomes(), "jana", "Y", { ok: false, code: "FORBIDDEN_CAPABILITY" });
  assert.equal(pairStatus(failed, "jana", "Y"), "error");
  assert.equal(pairStatus(failed, "jana", "Z"), "open");
  assert.equal(pairStatus(applyAddOutcome(emptyOutcomes(), "jana", "Y", { ok: true }), "jana", "Y"), "added");
});
