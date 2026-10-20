// The `gig_proposal` runner on an isolated DB, over a FAKE proposal CLI and a temp gigs root:
// keyless (kp's composition), the model path, the draft attempt for a qualified gig (status
// moves, deliverable shape, cost), the no-attempt path for a gig a persona drafted, the
// REWRITE of kp's own draft, an approved gig left alone, the build track / no brief refusals,
// a suspect gig that never reaches the model, a failed write, and setGigProposal's tenancy.
//
// unit-db.ts must be the first project import (it sets KP_DB_PATH before any store opens).
import { cleanupUnitDb } from "../../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_WORKSPACE_ID } from "../../db/workspaces.ts";
import { createManualGig, getGig, setGigBrief, setGigProposal, transitionGig } from "../../db/gigs.ts";
import { createGigAttempt, listGigAttemptsForGig, transitionGigAttempt } from "../../db/gigs-attempts.ts";
import type { CliCall } from "../../jobseeker/python-cli.ts";
import { REPORT_FIXTURE_BRIEF } from "../__fixtures__/report-facts.ts";
import { fixtureAcceptedPlan } from "../__fixtures__/accepted-plan.ts";
import { GIG_DISCLOSURE_SENTENCE } from "../contract.ts";
import { GIG_PROPOSAL_SPECIALIST_ID, type Gig } from "../types.ts";
import { GIG_PROPOSAL_CONFIDENCE } from "./draft.ts";
import { parseGigProposalTaskParams, runGigProposal, type GigProposalRunDeps } from "./run.ts";

const WS = DEFAULT_WORKSPACE_ID;
const ROOT = mkdtempSync(path.join(tmpdir(), "kp-proposal-run-"));
after(() => {
  rmSync(ROOT, { recursive: true, force: true });
  cleanupUnitDb();
});

let seq = 0;
function gig(opts: { arena?: Gig["arena"]; brief?: boolean; status?: "new" | "qualified" } = {}): string {
  seq += 1;
  const { gig: g } = createManualGig(WS, {
    arena: opts.arena ?? "freelance",
    url: `https://example.test/proposal-run/${seq}`,
    title: `Checkout page too slow ${seq}`,
    bodyText: "Unser Checkout ist zu langsam.",
    org: null,
    reward: { amount: 1800, currency: "EUR", text: "€1,800" },
    deadlineAt: null,
    tags: [],
    suspectReasons: [],
  });
  if (opts.brief !== false) setGigBrief(WS, g.id, REPORT_FIXTURE_BRIEF);
  if ((opts.status ?? "qualified") === "qualified") assert.ok(transitionGig(WS, g.id, { from: "new", to: "qualified" }).ok);
  return g.id;
}

const MODEL = {
  title: "Schnellerer Checkout",
  understanding: "Ihr Checkout soll schneller laden. Ziel sind 2 Sekunden. Mehr nicht.",
  approach: ["Erst messen."],
  milestones: [{ title: "Messung", delivers: "Ein Bericht." }],
  timeline: "Nach Ihren Antworten.",
  effort: { minHours: 10, maxHours: 20 },
  questions: ["Welches Profil?"],
  artifacts: ["Vercel-Zugriff"],
  message: `Hallo, ich messe zuerst.\n\n${GIG_DISCLOSURE_SENTENCE}`,
};
const KEYLESS = () => ({ result: null, source: "deterministic", fallbackReason: "no_provider", promptVersion: "gig-proposal-v3", costUsd: null });
const LLM = () => ({ result: MODEL, source: "llm", fallbackReason: null, promptVersion: "gig-proposal-v3", costUsd: 0.11 });

function fake(answer: () => Record<string, unknown>, over: Partial<GigProposalRunDeps> = {}) {
  const calls: CliCall[] = [];
  const deps: Partial<GigProposalRunDeps> = {
    runCli: async (call) => {
      calls.push(call);
      return answer();
    },
    proposalsRoot: () => ROOT,
    log: () => {},
    ...over,
  };
  return { calls, deps };
}

test("keyless: kp composes the proposal, writes the file, and the qualified gig is DRAFTED by kp's own attempt", async () => {
  const id = gig();
  const f = fake(KEYLESS);
  const out = await runGigProposal(WS, id, { deps: f.deps });
  assert.equal(out.status, "written");
  assert.equal(out.draft, "drafted");
  assert.equal(f.calls[0].module, "gig_proposal_cli");
  const g = getGig(WS, id)!;
  assert.equal(g.status, "drafted", "qualified -> dispatched -> drafted, no pairing, no persona");
  assert.equal(g.proposal?.status, "ready");
  assert.equal(g.proposal?.source, "deterministic");
  assert.equal(g.proposal?.model, null);
  assert.equal(g.proposal?.fallbackReason, "no_provider");
  assert.equal(g.proposal?.costUsd, null, "not reported, never 0");
  assert.equal(g.proposal?.planId, null, "brief only");
  assert.ok(g.proposal!.message.endsWith(GIG_DISCLOSURE_SENTENCE));
  assert.deepEqual(g.proposal?.artifacts, REPORT_FIXTURE_BRIEF.missingArtifacts);
  assert.ok(existsSync(g.proposal!.path) && g.proposal!.path.startsWith(ROOT));
  assert.match(readFileSync(g.proposal!.path, "utf8"), /<html lang="en">/);
  const [a] = listGigAttemptsForGig(WS, id);
  assert.equal(a.specialistId, GIG_PROPOSAL_SPECIALIST_ID);
  assert.equal(a.status, "drafted");
  assert.equal(a.executionId, null);
  assert.equal(a.costUsd, null);
  assert.deepEqual(a.deliverable?.artifacts, [{ kind: "file", ref: g.proposal!.path, title: "Client proposal" }]);
  assert.equal(a.deliverable?.draftText, g.proposal!.message);
  assert.equal(a.deliverable?.disclosure, GIG_DISCLOSURE_SENTENCE);
  assert.equal(a.deliverable?.confidence, GIG_PROPOSAL_CONFIDENCE);
  assert.deepEqual([a.deliverable?.evidence, a.deliverable?.questions], [[], []]);
});

test("model: the listing's language, the accepted plan in the input, the cost on the record AND the attempt", async () => {
  const id = gig();
  const plan = fixtureAcceptedPlan(WS, id);
  const f = fake(LLM);
  const out = await runGigProposal(WS, id, { deps: f.deps });
  assert.equal(out.source, "llm");
  const input = f.calls[0].files["input.json"] as { language: string; plan: { steps: unknown[] } | null; disclosure: string };
  assert.equal(input.language, "de");
  assert.equal(input.plan?.steps.length, 3);
  assert.equal(input.disclosure, GIG_DISCLOSURE_SENTENCE);
  const g = getGig(WS, id)!;
  assert.deepEqual([g.proposal?.source, g.proposal?.model, g.proposal?.costUsd, g.proposal?.planId], ["llm", "claude-sonnet-5-5", 0.11, plan.id]);
  const html = readFileSync(g.proposal!.path, "utf8");
  assert.match(html, /<html lang="de">/);
  assert.match(html, /Schnellerer Checkout/);
  assert.doesNotMatch(html, /claude|0\.11|\bkp\b/i);
  const [a] = listGigAttemptsForGig(WS, id);
  assert.equal(a.costUsd, 0.11, "the draft lint never reads an unreported cost for a paid proposal");
  assert.equal(a.deliverable?.summary, "Ihr Checkout soll schneller laden. Ziel sind 2 Sekunden.");
});

test("a gig a PERSONA drafted keeps its attempt: only the file and the record are written", async () => {
  const id = gig();
  assert.ok(transitionGig(WS, id, { from: "qualified", to: "dispatched" }).ok);
  const persona = createGigAttempt(WS, { gigId: id, specialistId: "gspec-persona", revisionNote: null })!;
  assert.ok(transitionGigAttempt(WS, persona.id, { from: "dispatched", to: "drafted", patch: { deliverable: { version: 1, summary: "s", draftText: "d", artifacts: [], evidence: [], disclosure: "x", confidence: 0.7, questions: [] } } }).ok);
  assert.ok(transitionGig(WS, id, { from: "dispatched", to: "drafted" }).ok);
  const out = await runGigProposal(WS, id, { deps: fake(KEYLESS).deps });
  assert.equal(out.draft, "kept");
  const attempts = listGigAttemptsForGig(WS, id);
  assert.deepEqual(attempts.map((a) => [a.specialistId, a.status]), [["gspec-persona", "drafted"]]);
  assert.equal(getGig(WS, id)!.proposal?.status, "ready");
});

test("a REWRITE on a drafted gig replaces kp's own draft; an approved one (in_review) is left alone", async () => {
  const id = gig();
  await runGigProposal(WS, id, { deps: fake(KEYLESS).deps });
  const [first] = listGigAttemptsForGig(WS, id);
  const again = await runGigProposal(WS, id, { deps: fake(LLM).deps });
  assert.equal(again.draft, "redrafted");
  const attempts = listGigAttemptsForGig(WS, id);
  assert.deepEqual(attempts.map((a) => a.status), ["discarded", "drafted"]);
  assert.equal(attempts[0].id, first.id);
  assert.equal(attempts[1].deliverable?.draftText, getGig(WS, id)!.proposal!.message);
  assert.equal(getGig(WS, id)!.status, "drafted", "the gig does not move");
  assert.ok(existsSync(getGig(WS, id)!.proposal!.path.replace(/\.html$/, ".prev.html")), "the previous file is kept");

  // A revision the operator asked for (the attempt is terminal at revision_requested): a fresh one.
  assert.ok(transitionGigAttempt(WS, attempts[1].id, { from: "drafted", to: "revision_requested", patch: { revisionNote: "shorter" } }).ok);
  assert.equal((await runGigProposal(WS, id, { deps: fake(LLM).deps })).draft, "redrafted");
  const latest = listGigAttemptsForGig(WS, id).at(-1)!;
  assert.equal(latest.status, "drafted");

  // Approved: gig in_review - only the file and the record change.
  assert.ok(transitionGigAttempt(WS, latest.id, { from: "drafted", to: "approved" }).ok);
  assert.ok(transitionGig(WS, id, { from: "drafted", to: "in_review" }).ok);
  const before = listGigAttemptsForGig(WS, id).length;
  assert.equal((await runGigProposal(WS, id, { deps: fake(LLM).deps })).draft, "kept");
  assert.equal(listGigAttemptsForGig(WS, id).length, before);
  assert.equal(listGigAttemptsForGig(WS, id).at(-1)!.status, "approved");
});

test("a build-track gig and a gig with no brief are refused before anything runs", async () => {
  const f = fake(LLM);
  const bounty = gig({ arena: "oss_bounty" });
  assert.deepEqual([(await runGigProposal(WS, bounty, { deps: f.deps })).reason, getGig(WS, bounty)!.proposal], ["build_track", null]);
  const bare = gig({ brief: false });
  assert.deepEqual([(await runGigProposal(WS, bare, { deps: f.deps })).reason, getGig(WS, bare)!.proposal], ["no_brief", null]);
  assert.equal((await runGigProposal(WS, "gig-nope", { deps: f.deps })).reason, "not_found");
  assert.equal(f.calls.length, 0);
});

test("a suspect gig never reaches the model; a failed write records `failed` and moves nothing", async () => {
  const suspect = gig({ status: "new" });
  assert.ok(transitionGig(WS, suspect, { from: "new", to: "suspect" }).ok);
  const f = fake(LLM);
  const out = await runGigProposal(WS, suspect, { deps: f.deps });
  assert.deepEqual([out.status, out.fallbackReason, out.draft, f.calls.length], ["written", "gig_suspect", "skipped", 0]);

  const id = gig();
  const failing = fake(LLM, {
    writeFile: () => {
      throw new Error("disk full");
    },
  });
  const res = await runGigProposal(WS, id, { deps: failing.deps });
  assert.equal(res.status, "failed");
  const g = getGig(WS, id)!;
  assert.deepEqual([g.proposal?.status, g.proposal?.fallbackReason, g.status], ["failed", "write_failed", "qualified"]);
  assert.equal(listGigAttemptsForGig(WS, id).length, 0);
});

test("setGigProposal is tenant-bound; the task params are re-validated", () => {
  const id = gig();
  const rec = { path: path.join(ROOT, "x.html"), status: "ready" as const, source: "deterministic" as const, model: null, fallbackReason: null, costUsd: null, generatedAt: "2026-09-30T00:00:00.000Z", planId: null, message: "m", questions: [], artifacts: [] };
  assert.equal(setGigProposal("ws-someone-else", id, rec), null);
  assert.equal(getGig(WS, id)!.proposal, null);
  assert.equal(setGigProposal(WS, id, rec)?.proposal?.message, "m");
  assert.deepEqual(parseGigProposalTaskParams({ gigId: "g1", workspaceId: "w" }), { gigId: "g1" });
  assert.equal(parseGigProposalTaskParams({ gigId: " " }), null);
});
