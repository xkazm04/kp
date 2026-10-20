// Pure logic for the proposal track (proposal.ts): kp's own draft, whether a proposal file
// exists to open, the brief-alone note, the client message and asks the Review tab prefers,
// the Pairing tab's gate, and a proposal rewritten after its draft.
// Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { GIG_PROPOSAL_SPECIALIST_ID, type GigBrief, type GigProposal } from "@/app/_lib/gigs/types.ts";
import { att, gig } from "./fixtures.ts";
import { clientAsksOf, clientMessageOf, isKpDraft, pairingOpen, proposalBasisNote, proposalHasFile, proposalMovedOn, trackOf } from "./proposal.ts";

const P: GigProposal = {
  path: "C:/gigs/_proposals/web/2026-09-30-x-abc123.html",
  status: "ready",
  source: "llm",
  model: "claude-sonnet-5-5",
  fallbackReason: null,
  costUsd: 0.04,
  generatedAt: "2026-09-30T10:00:00.000Z",
  planId: "plan-1",
  message: "Hello, here is how I would do it.",
  questions: ["Which format?"],
  artifacts: ["Sample files"],
};
const BRIEF = { outreachMessage: "Hi from the brief.", missingArtifacts: ["Logins"], createdAt: "2026-09-29T08:00:00.000Z" } as GigBrief;

test("trackOf: freelance is the proposal track, every other arena builds", () => {
  assert.equal(trackOf({ arena: "freelance" }), "proposal");
  for (const arena of ["security", "oss_bounty", "competition"] as const) assert.equal(trackOf({ arena }), "build");
});

test("isKpDraft: only the attempt kp wrote itself", () => {
  assert.equal(isKpDraft(att("a", "g", "drafted", { specialistId: GIG_PROPOSAL_SPECIALIST_ID })), true);
  assert.equal(isKpDraft(att("a", "g", "drafted", { specialistId: "sp-1" })), false);
  assert.equal(isKpDraft(null), false);
});

test("proposalHasFile: a first write in flight or failed has no file; a rewrite keeps the previous one", () => {
  assert.equal(proposalHasFile(null), false);
  assert.equal(proposalHasFile(P), true);
  assert.equal(proposalHasFile({ ...P, status: "writing", message: "" }), false, "first write");
  assert.equal(proposalHasFile({ ...P, status: "failed", message: "" }), false, "first write failed");
  assert.equal(proposalHasFile({ ...P, status: "writing" }), true, "rewrite: the previous file is readable");
});

test("proposalBasisNote: brief alone before a plan, stale once one is accepted, quiet from a plan", () => {
  assert.equal(proposalBasisNote(null, false), "will");
  assert.equal(proposalBasisNote(null, true), null);
  assert.equal(proposalBasisNote({ ...P, planId: null }, false), "was");
  assert.equal(proposalBasisNote({ ...P, planId: null }, true), "stale");
  assert.equal(proposalBasisNote(P, true), null);
  assert.equal(proposalBasisNote({ ...P, status: "writing", message: "", planId: null }, false), "will", "no file yet reads as not written");
});

test("clientMessageOf / clientAsksOf: the proposal first, the brief as the fallback", () => {
  const g = gig("g", "drafted", { proposal: P, brief: BRIEF });
  assert.deepEqual(clientMessageOf(g), { text: P.message, from: "proposal", at: P.generatedAt });
  assert.deepEqual(clientAsksOf(g), { artifacts: ["Sample files"], questions: ["Which format?"], from: "proposal" });
  const b = gig("g", "qualified", { brief: BRIEF });
  assert.deepEqual(clientMessageOf(b), { text: "Hi from the brief.", from: "brief", at: BRIEF.createdAt });
  assert.deepEqual(clientAsksOf(b), { artifacts: ["Logins"], questions: [], from: "brief" });
  assert.deepEqual(clientMessageOf(gig("g", "qualified", { brief: BRIEF, proposal: { ...P, status: "writing", message: " " } }))?.from, "brief", "an empty message never wins");
  assert.equal(clientMessageOf(gig("g", "new")), null);
});

test("pairingOpen: build track always; proposal track only for a gig a persona already worked", () => {
  assert.equal(pairingOpen({ arena: "oss_bounty" }, false, null), true);
  assert.equal(pairingOpen({ arena: "freelance" }, false, null), false);
  assert.equal(pairingOpen({ arena: "freelance" }, false, att("a", "g", "drafted", { specialistId: GIG_PROPOSAL_SPECIALIST_ID })), false);
  assert.equal(pairingOpen({ arena: "freelance" }, false, att("a", "g", "drafted", { specialistId: "niche-1" })), true, "legacy niche attempt");
  assert.equal(pairingOpen({ arena: "freelance" }, true, null), true, "its own persona");
});

test("proposalMovedOn: only two different non-empty messages", () => {
  assert.equal(proposalMovedOn(P, P.message), false);
  assert.equal(proposalMovedOn(P, `  ${P.message}\n`), false);
  assert.equal(proposalMovedOn(P, "Another text"), true);
  assert.equal(proposalMovedOn(null, "x"), false);
  assert.equal(proposalMovedOn({ ...P, message: "" }, "x"), false);
});
