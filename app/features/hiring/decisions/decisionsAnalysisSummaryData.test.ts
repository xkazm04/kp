// The Full-analysis modal's peer population — "the field" the Bench ranks against.
//
// The defect it locks out: GET /api/jobs/[id]/candidates ranks the whole workspace
// CANDIDATE POOL against the job and decorates each row with `inPipeline` (the
// candidate's stage on this role, null when they were never filed on it). This hook
// dropped that flag, so the Bench headed its list "The field · 87" and RankChips read
// "#12 of 84" on a role four people had actually applied to — a rank against a corpus
// that was never in contention, under a label promising this role's field.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { rolePeerRows, type CandRow } from "./decisionsAnalysisSummaryData.ts";
import type { MatchResultView } from "@/app/features/shared/matchTypes";

const result = (total: number) => ({ total }) as unknown as MatchResultView;

const row = (over: Partial<CandRow>): CandRow => ({
  candidateId: "c1",
  label: "Alice",
  result: result(70),
  inPipeline: "Screened",
  ...over,
});

test("only candidates filed on THIS role are the field", () => {
  const rows: CandRow[] = [
    row({ candidateId: "self" }),
    row({ candidateId: "peer-1", label: "Bob", result: result(80) }),
    row({ candidateId: "peer-2", label: "Cara", result: result(65), inPipeline: "Interview" }),
    // Ranked because they sit in the workspace corpus, but never applied to this role.
    row({ candidateId: "corpus-1", label: "Dan", result: result(90), inPipeline: null }),
    row({ candidateId: "corpus-2", label: "Eve", result: result(88), inPipeline: undefined }),
  ];
  const peers = rolePeerRows(rows, "self");
  assert.deepEqual(peers.map((p) => p.candidateId), ["peer-1", "peer-2"]);
  // The number the Bench prints: self + peers, i.e. "The field · 3" — not · 5.
  assert.equal(peers.length + 1, 3);
});

test("the candidate being decided is never their own peer", () => {
  const peers = rolePeerRows([row({ candidateId: "self" }), row({ candidateId: "peer-1", label: "Bob" })], "self");
  assert.deepEqual(peers.map((p) => p.candidateId), ["peer-1"]);
});

test("rows without a comparable result or a display label carry no signal", () => {
  const rows: CandRow[] = [
    row({ candidateId: "no-label", label: undefined }),
    row({ candidateId: "no-result", result: undefined as unknown as MatchResultView }),
    row({ candidateId: "ok", label: "Bob" }),
  ];
  assert.deepEqual(rolePeerRows(rows, "self").map((p) => p.candidateId), ["ok"]);
});

test("a job-less / unranked read yields no field at all rather than a fabricated one", () => {
  assert.deepEqual(rolePeerRows([], "self"), []);
  assert.deepEqual(rolePeerRows([row({ candidateId: "corpus", inPipeline: null })], null), []);
});
