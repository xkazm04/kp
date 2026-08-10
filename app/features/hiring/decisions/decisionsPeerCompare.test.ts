import test from "node:test";
import assert from "node:assert/strict";
import { peerScoreOf, peersForEntry, peerStanding, type PeerScore } from "./decisionsPeerCompare";
import type { Entry } from "@/app/features/shared/decisionsTypes";

const entry = (over: Partial<Entry>): Entry => ({
  id: "e1",
  candidateId: "c1",
  candidateLabel: "Alice",
  archetype: null,
  roleFamily: null,
  jobId: "jd-frontend",
  jobTitle: "Frontend Dev",
  stage: "Screened",
  matchScore: 50,
  status: "active",
  approvalKind: null,
  approvalDetail: null,
  ...over,
});

test("peerScoreOf prefers canonicalScore, falls back to matchScore, never fabricates", () => {
  assert.equal(peerScoreOf({ canonicalScore: 71, matchScore: 50 }), 71);
  assert.equal(peerScoreOf({ canonicalScore: null, matchScore: 50 }), 50);
  assert.equal(peerScoreOf({ canonicalScore: null, matchScore: null }), null);
});

test("peersForEntry keeps only active same-job entries and includes self", () => {
  const e = entry({ id: "a" });
  const peers = peersForEntry(
    [
      e,
      entry({ id: "b", candidateLabel: "Bob" }),
      entry({ id: "x", status: "rejected" }),
      entry({ id: "y", jobId: "jd-backend" }),
    ],
    e
  );
  assert.deepEqual(peers.map((p) => p.entryId).sort(), ["a", "b"]);
});

test("peersForEntry is empty for a job-less entry", () => {
  const e = entry({ jobId: null });
  assert.deepEqual(peersForEntry([e], e), []);
});

const p = (entryId: string, score: number | null): PeerScore => ({ entryId, label: entryId, stage: "Screened", score });

test("peerStanding ranks, computes best/median/deltaBest and counts unscored", () => {
  const peers = [p("a", 80), p("b", 60), p("c", 70), p("d", null)];
  const s = peerStanding(peers, "c");
  assert.ok(s);
  assert.equal(s.rank, 2);
  assert.equal(s.of, 3);
  assert.equal(s.best, 80);
  assert.equal(s.median, 70);
  assert.equal(s.deltaBest, -10);
  assert.equal(s.unscored, 1);
});

test("peerStanding for the leader reports margin over the runner-up", () => {
  const s = peerStanding([p("a", 80), p("b", 60)], "a");
  assert.ok(s);
  assert.equal(s.rank, 1);
  assert.equal(s.deltaBest, 20);
});

test("peerStanding ties share the better rank", () => {
  const s = peerStanding([p("a", 70), p("b", 70), p("c", 50)], "b");
  assert.ok(s);
  assert.equal(s.rank, 1);
});

test("peerStanding is null for unscored self or a lone scored candidate", () => {
  assert.equal(peerStanding([p("a", null), p("b", 60), p("c", 55)], "a"), null);
  assert.equal(peerStanding([p("a", 80), p("b", null)], "a"), null);
});
