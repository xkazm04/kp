// Pure logic for the Summary's Moves block (moves.ts): the one primary move by stage, and a
// lead split into one sentence and the rest.
// Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { leadSentence, nextMove, type MoveFacts } from "./moves.ts";

const F: MoveFacts = {
  brief: true,
  plans: 0,
  plansBusy: false,
  accepted: false,
  proposalTrack: false,
  proposalFile: false,
  proposalWriting: false,
  draftOnDesk: false,
  kpDraft: false,
  report: false,
  reportWriting: false,
  closed: false,
};

test("nextMove: research first, then plans, then the pick", () => {
  assert.equal(nextMove({ ...F, brief: false, plans: null }), "research");
  assert.equal(nextMove({ ...F, brief: false }), "research", "no brief outranks everything but a draft on the desk");
  assert.equal(nextMove(F), "generatePlans");
  assert.equal(nextMove({ ...F, plansBusy: true }), "goPlans", "plans being written: watch them, never propose twice");
  assert.equal(nextMove({ ...F, plans: 2 }), "goPlans", "plans wait for a pick");
});

test("nextMove: plans still loading gives no primary unless a report can be opened", () => {
  assert.equal(nextMove({ ...F, plans: null }), null);
  assert.equal(nextMove({ ...F, plans: null, report: true }), "openReport");
});

test("nextMove: a freelance bid with a plan accepted prepares, then opens, the client proposal", () => {
  const bid = { ...F, plans: 1, accepted: true, proposalTrack: true };
  assert.equal(nextMove(bid), "prepareProposal");
  assert.equal(nextMove({ ...bid, proposalFile: true }), "openProposal");
  assert.equal(nextMove({ ...bid, proposalWriting: true }), null, "a write in flight is not a move");
  assert.equal(nextMove({ ...bid, proposalWriting: true, report: true }), "openReport");
});

test("nextMove: the build track after the pick is the sign-off's Dispatch; the Summary offers the report", () => {
  const build = { ...F, plans: 1, accepted: true };
  assert.equal(nextMove(build), "writeReport");
  assert.equal(nextMove({ ...build, reportWriting: true }), null);
  assert.equal(nextMove({ ...build, report: true }), "openReport");
});

test("nextMove: a draft on the desk goes to the draft; kp's own bid opens the proposal", () => {
  assert.equal(nextMove({ ...F, draftOnDesk: true }), "goDraft");
  assert.equal(nextMove({ ...F, brief: false, draftOnDesk: true }), "goDraft");
  assert.equal(nextMove({ ...F, draftOnDesk: true, kpDraft: true, proposalTrack: true, proposalFile: true }), "openProposal");
  assert.equal(nextMove({ ...F, draftOnDesk: true, kpDraft: true, proposalTrack: true }), "goBid");
});

test("nextMove: a gig off the line only opens its report", () => {
  assert.equal(nextMove({ ...F, closed: true }), null);
  assert.equal(nextMove({ ...F, closed: true, draftOnDesk: true, report: true }), "openReport");
});

test("leadSentence: one sentence as the lead, the rest as body, never a cut", () => {
  assert.deepEqual(leadSentence("A client needs a workbook. It has 20 forms.\nDone means a file."), { lead: "A client needs a workbook.", rest: "It has 20 forms. Done means a file." });
  assert.deepEqual(leadSentence("One sentence only"), { lead: "One sentence only", rest: "" });
  assert.deepEqual(leadSentence("Version 1.2 ships. Then more."), { lead: "Version 1.2 ships.", rest: "Then more." }, "a dot inside a number does not end the sentence");
  const long = `${"word ".repeat(60).trim()}. Short.`;
  assert.deepEqual(leadSentence(long), { lead: "", rest: long }, "a first sentence too long to be a lead is all body");
});
