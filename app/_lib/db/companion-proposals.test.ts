import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import {
  appendTurnWithProposals,
  claimProposal,
  countOpenProposals,
  createThread,
  getProposal,
  listProposals,
  listProposalsForThread,
  listTurns,
  releaseProposal,
  resolveProposal,
  stampProposalOutcome,
} from "./companion.ts";

after(() => cleanupUnitDb());

// Behavioral coverage for the proposal half of the companion store (WP3).
// companion-tenancy.test.ts is the SOURCE guard — it proves every query binds
// workspace_id; this proves the behaviour those queries were written for:
//
//   • a reply and the proposals it offered are ONE write,
//   • an accept is claim → run → stamp, so a failed accept is re-armable and a
//     double-click cannot run twice,
//   • a resolved proposal can never be re-opened by anything,
//   • and every read is scoped, so a leaked proposal id is not a bearer token.

const PAYLOAD = { actionId: "run_analysis", params: { candidate: "A. Novak" }, summary: { key: "runAnalysis" } };

function threadWith(workspaceId: string, proposals: { kind: string; payload: unknown }[]) {
  const thread = createThread("", workspaceId);
  const written = appendTurnWithProposals(
    { threadId: thread.id, role: "assistant", content: "I could re-screen her.", proposals },
    workspaceId
  );
  assert.ok(written, "the turn should have been written");
  return { thread, written };
}

test("a reply and its proposals land as ONE write, with the turn pointing at the rows", () => {
  const { thread, written } = threadWith("ws-atomic", [
    { kind: "run_analysis", payload: PAYLOAD },
    { kind: "generate_digest", payload: { actionId: "generate_digest", params: {}, summary: { key: "generateDigest" } } },
  ]);
  assert.equal(written.proposals.length, 2);
  // The pointer is IN the turn's meta, written in the same INSERT — a card the
  // dock paints under a sentence can never point at a row that was not inserted.
  assert.deepEqual(
    written.turn.meta?.proposalIds,
    written.proposals.map((p) => p.id)
  );
  const stored = listTurns(thread.id, "ws-atomic");
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0].meta?.proposalIds, written.proposals.map((p) => p.id));
  for (const proposal of listProposalsForThread(thread.id, "ws-atomic")) {
    assert.equal(proposal.status, "open");
    assert.equal(proposal.threadId, thread.id);
    assert.equal(proposal.resolvedAt, null);
  }
});

test("a turn with NO proposals writes no meta pointer and no rows", () => {
  const { thread, written } = threadWith("ws-empty", []);
  assert.equal(written.proposals.length, 0);
  assert.equal(written.turn.meta, null);
  assert.equal(listProposalsForThread(thread.id, "ws-empty").length, 0);
});

test("a turn against another tenant's thread writes NOTHING - not the turn, not the proposals", () => {
  const thread = createThread("", "ws-owner");
  const stolen = appendTurnWithProposals(
    { threadId: thread.id, role: "assistant", content: "hello", proposals: [{ kind: "run_analysis", payload: PAYLOAD }] },
    "ws-intruder"
  );
  assert.equal(stolen, null);
  // The transaction must have rolled back whole: a proposal row from a refused
  // turn would be an Accept button under a message that does not exist.
  assert.equal(listProposals("ws-intruder").length, 0);
  assert.equal(listProposalsForThread(thread.id, "ws-owner").length, 0);
});

test("every proposal read is workspace-scoped - a leaked id is not a bearer token", () => {
  const { thread, written } = threadWith("ws-a", [{ kind: "run_analysis", payload: PAYLOAD }]);
  const id = written.proposals[0].id;
  assert.ok(getProposal(id, "ws-a"));
  assert.equal(getProposal(id, "ws-b"), null, "another tenant must not resolve a known proposal id");
  assert.equal(listProposalsForThread(thread.id, "ws-b").length, 0);
  assert.equal(countOpenProposals("ws-b"), 0);
  assert.ok(countOpenProposals("ws-a") >= 1);
});

test("the open count is the attention bucket: it moves on resolve and only for the right tenant", () => {
  const before = countOpenProposals("ws-count");
  const { written } = threadWith("ws-count", [
    { kind: "run_analysis", payload: PAYLOAD },
    { kind: "generate_digest", payload: PAYLOAD },
  ]);
  assert.equal(countOpenProposals("ws-count"), before + 2);
  assert.equal(resolveProposal(written.proposals[0].id, "declined", "ws-count"), true);
  assert.equal(countOpenProposals("ws-count"), before + 1);
});

test("an accept is claim, run, stamp - and a double-click loses the claim rather than running twice", () => {
  const { written } = threadWith("ws-claim", [{ kind: "run_analysis", payload: PAYLOAD }]);
  const id = written.proposals[0].id;

  assert.equal(claimProposal(id, "ws-claim"), true, "the first caller wins the claim");
  assert.equal(claimProposal(id, "ws-claim"), false, "a second caller must lose it");
  // Claimed but not finished: status has moved, the answer time has not, which is
  // precisely what makes the release below safe.
  const claimed = getProposal(id, "ws-claim");
  assert.equal(claimed?.status, "accepted");
  assert.equal(claimed?.resolvedAt, null);

  assert.equal(stampProposalOutcome(id, { key: "analysisQueued", ref: "t-1" }, "ws-claim"), true);
  const done = getProposal(id, "ws-claim");
  assert.equal(done?.status, "accepted");
  assert.ok(done?.resolvedAt, "the answer time is stamped when the work finished");
  // The outcome MERGES into the payload rather than replacing it: the proposal's
  // whole story - what was offered and what came of it - stays in one row.
  const payload = done?.payload as Record<string, unknown>;
  assert.equal(payload.actionId, "run_analysis");
  assert.deepEqual(payload.outcome, { key: "analysisQueued", ref: "t-1" });
});

test("a failed accept is released, so an accept that ran nothing never reads as done", () => {
  const { written } = threadWith("ws-release", [{ kind: "run_analysis", payload: PAYLOAD }]);
  const id = written.proposals[0].id;
  assert.equal(claimProposal(id, "ws-release"), true);
  assert.equal(releaseProposal(id, "ws-release"), true);
  assert.equal(getProposal(id, "ws-release")?.status, "open", "the operator can try again");
  assert.equal(countOpenProposals("ws-release"), 1);
});

test("a RESOLVED proposal can never be re-opened, stamped again, or flipped", () => {
  const { written } = threadWith("ws-final", [{ kind: "run_analysis", payload: PAYLOAD }]);
  const id = written.proposals[0].id;
  assert.equal(claimProposal(id, "ws-final"), true);
  assert.equal(stampProposalOutcome(id, { key: "analysisQueued" }, "ws-final"), true);

  // The release path is guarded on `resolved_at IS NULL`, so it cannot undo a
  // completed acceptance even though the status matches.
  assert.equal(releaseProposal(id, "ws-final"), false);
  // A second stamp finds resolved_at already set and changes nothing, so a
  // retried request cannot overwrite the outcome that was actually produced.
  assert.equal(stampProposalOutcome(id, { key: "declined" }, "ws-final"), false);
  // And the companion may not re-open her own answered suggestion.
  assert.equal(resolveProposal(id, "declined", "ws-final"), false);
  const final = getProposal(id, "ws-final");
  assert.equal(final?.status, "accepted");
  assert.deepEqual((final?.payload as Record<string, unknown>).outcome, { key: "analysisQueued" });
});

test("claim, release and stamp are all workspace-scoped - another tenant cannot answer a proposal", () => {
  const { written } = threadWith("ws-owner2", [{ kind: "run_analysis", payload: PAYLOAD }]);
  const id = written.proposals[0].id;
  assert.equal(claimProposal(id, "ws-intruder"), false);
  assert.equal(resolveProposal(id, "declined", "ws-intruder"), false);
  assert.equal(stampProposalOutcome(id, { key: "declined" }, "ws-intruder"), false);
  assert.equal(getProposal(id, "ws-owner2")?.status, "open", "the proposal is untouched");
  // And the claim path still works for the owner afterwards.
  assert.equal(claimProposal(id, "ws-owner2"), true);
  assert.equal(releaseProposal(id, "ws-intruder"), false);
  assert.equal(getProposal(id, "ws-owner2")?.status, "accepted");
});
