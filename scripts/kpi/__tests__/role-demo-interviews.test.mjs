// Fixtures for the goal-1 demo run's SIMULATED INTERVIEW (ADR-0011 amendment 2026-10-06):
// after the stand-in approves an interview invite, the demo plays the candidate from the
// seeded CV, seals the scorecard, and S5 reads it on the next pass. The whole child loop
// runs here (runDemoOnCopy) on a throwaway database, with the simulator's KEYLESS doubles
// (interview-sim/fake.ts) and a scripted scorer injected — nothing spawns `claude`.
//
// "from the SEEDED CV" is since 2026-10-06 a rule rather than a description of the fixtures:
// the simulator refuses any entry it cannot prove is seed data (seed-origin.ts, finding 2b of
// docs/security/role-demo-sim-scan-2026-10-06.md), which is why the fixtures below play real
// `pe-*` rows and why `unseededRole` exists to prove the refusal.
//
//   node --import ./scripts/test-alias-loader.mjs --experimental-transform-types \
//     --disable-warning=ExperimentalWarning --test scripts/kpi/__tests__/role-demo-interviews.test.mjs
import "better-sqlite3";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// IMPORT ORDER IS LOAD-BEARING: unit-db sets KP_DB_PATH before anything touches db-path.
import { cleanupUnitDb } from "../../../app/_lib/testing/unit-db.ts";
// …and the simulator refuses to run until some caller DECLARES that database a throwaway
// copy made for a demo run (assertRoleDemoScratchDb). The script's parent half sets this
// on the copy it made; here it is unit-db's own isolated file.
process.env.KP_ROLE_DEMO_SCRATCH_DB = process.env.KP_DB_PATH;
import { insertJob } from "../../../app/_lib/job-ingest.ts";
import { ensureDb } from "../../../app/_lib/db/core.ts";
import { createPipelineEntry, getPipelineEntry } from "../../../app/_lib/db/pipeline.ts";
import { getProfileRecord, saveProfile } from "../../../app/_lib/db/profiles.ts";
import { screenedLandingStage } from "../../../app/_lib/pipeline-stages.ts";
import { listRecentInterviewSessions, latestInterviewByEntry, getInterviewSessionById } from "../../../app/_lib/db/interviews.ts";
import { saveInterviewPrep } from "../../../app/_lib/interview-prep.ts";
import { rosStrings } from "../../../app/_lib/interview-prep-strings.ts";
import { buildRunOfShow } from "../../../app/_lib/run-of-show.ts";
import { fakeCandidate, fakeInterviewer } from "../../../app/_lib/interview-sim/fake.ts";
import { MAX_SIM_INTERVIEWS, NOT_SEED_DATA, SIMULATED_LABEL, createRoleDemoSimulator, simulateInterviewForEntry } from "../../../app/_lib/interview-sim/role-demo.ts";
import { canonicalJson, seedOriginProblem } from "../../../app/_lib/interview-sim/seed-origin.ts";
import { roleDemoScratchDbProblem } from "../../../app/_lib/interview-sim/instrument.ts";
import { SimProviderError, parseCliEnvelope } from "../../../app/_lib/interview-sim/providers.ts";
import { DEFAULT_WORKSPACE_ID } from "../../../app/_lib/db/workspaces.ts";
import { DEFAULT_DB_PATH } from "../../../app/_lib/db-path.ts";
import { commsEgressSealed, isRelayConfigured, relayHealth, resolveRelay } from "../../../app/_lib/comms-relay.ts";
import { runDemoOnCopy } from "../role-demo-run-child.mjs";
import {
  NOT_SEED_REFUSAL,
  SIM_PROVIDER_LINE,
  formatSimulatedInterviews,
  goalOneEndState,
  goalOneHeadline,
  notSeedRefusalCount,
  simulatedOfferCount,
  summarizeRoleDemoRun,
  tallyStandIn,
} from "../role-demo-run-reading.mjs";

after(() => cleanupUnitDb());

const PREP_QUESTIONS = [
  { competency: "Event-driven systems", question: "Tell me about a system where messages could arrive twice.", whatsGoodLooksLike: "Listen for: idempotency keys" },
  { competency: "PostgreSQL performance", question: "Walk me through the slowest query you ever fixed.", whatsGoodLooksLike: "Listen for: EXPLAIN, a measured before and after" },
];

// THE DEMO PLAYS SEEDED ENTRIES ONLY (seed-origin.ts, finding 2b), so a fixture that expects
// a branch to be played has to hand the simulator a genuinely seeded one — an entry built by
// createPipelineEntry is now refused by construction, which is what `unseededRole` below is
// for. unit-db boots with the committed fixtures (KP_EMPTY unset, so fixtureSeedEnabled), so
// the `pe-*` rows and their `cand-*` profiles are already in this database untouched: each
// fixture takes the next unused ones and re-points them at its own job. The job an entry sits
// on is ordinary board state and deliberately NOT part of the proof.
const SEED_PIPELINE = JSON.parse(readFileSync(new URL("../../../data/seed_pipeline/pipeline.json", import.meta.url), "utf8"));
let seedCursor = 0;
function takeSeedRecords(n) {
  const taken = SEED_PIPELINE.slice(seedCursor, seedCursor + n);
  assert.equal(taken.length, n, "the committed pipeline seed ran out of entries for these fixtures");
  seedCursor += n;
  return taken;
}

/** A job with `n` SEEDED candidates on it, each with an interview prep plan so the agenda
 *  builds read-only with no model. Returns the job id and the entry ids. */
async function seedRole(tag, n) {
  const jobId = `jd-demo-iv-${tag}`;
  insertJob({ id: jobId, title: "Backend Engineer", requirements: [{ skill: "java", kind: "skill", hardness: "must" }] }, undefined, "published");
  const strings = await rosStrings("en");
  const db = ensureDb();
  const repoint = db.prepare(
    `UPDATE pipeline_entries SET job_id = ?, job_title = ?, match_score = ?, stage = ?, status = 'active' WHERE id = ?`
  );
  const entries = [];
  for (const seed of takeSeedRecords(n)) {
    const changed = repoint.run(jobId, "Backend Engineer", 90, screenedLandingStage(), seed.id).changes;
    assert.equal(changed, 1, `the seeded entry ${seed.id} is not on this database — did the fixture seed not run?`);
    const plan = buildRunOfShow(PREP_QUESTIONS, ["event-driven systems"], seed.candidateLabel, "Backend Engineer", strings);
    saveInterviewPrep(seed.id, seed.candidateLabel, "Backend Engineer", { ...plan, lang: "en" });
    entries.push(seed.id);
  }
  return { jobId, entries };
}

/** The same shape, but an entry a RECRUITER could have created: its own profile id, its own
 *  CV payload, its own entry id. Nothing about it is in the seed, which is the point. */
async function unseededRole(tag, payloadExtra = {}) {
  const jobId = `jd-demo-iv-${tag}`;
  insertJob({ id: jobId, title: "Backend Engineer", requirements: [{ skill: "java", kind: "skill", hardness: "must" }] }, undefined, "published");
  const strings = await rosStrings("en");
  const label = `Candidate ${tag}`;
  const profile = saveProfile({
    label,
    archetype: "bau",
    roleFamily: "software_engineering",
    completeness: 1,
    payload: { displayName: label, roleFamily: "software_engineering", seniority: "senior", skillClaims: [{ skill: "Java", level: "working" }], ...payloadExtra },
  });
  const { entry } = createPipelineEntry({ candidateId: profile.id, candidateLabel: label, jobId, jobTitle: "Backend Engineer", matchScore: 90 });
  const plan = buildRunOfShow(PREP_QUESTIONS, ["event-driven systems"], label, "Backend Engineer", strings);
  saveInterviewPrep(entry.id, label, "Backend Engineer", { ...plan, lang: "en" });
  return { jobId, entryId: entry.id, profileId: profile.id, label };
}

// The agenda of the call being played, captured when the provider is built — the scorer is
// handed only (session, transcript), and a real scorer rates the agenda's competencies.
let playedAgenda = null;
const fakeLlms = (situation, instrument) => {
  playedAgenda = instrument.agenda;
  return { interviewer: fakeInterviewer(instrument.agenda), candidate: fakeCandidate(situation) };
};
/** A scorer that rates the way a grounded one does: one rating per agenda competency, its
 *  evidence a line the candidate actually said in THIS transcript (so it is neither empty nor
 *  a "Not assessed" placeholder, and the write path's refusal has nothing to refuse). */
const groundedRatings = (transcript) => {
  const said = transcript.filter((t) => t.role === "candidate" && t.text.trim()).map((t) => t.text.trim());
  assert.ok(said.length > 0, "the fake candidate said something to quote");
  const competencies = (playedAgenda?.blocks ?? []).map((b) => b.competency).filter(Boolean);
  const axes = competencies.length > 0 ? competencies : ["overall"];
  return axes.map((competency, i) => ({ competency, rating: 4, evidence: said[i % said.length] }));
};
const llmScorer = (recommendation) => async (_session, transcript) => ({
  scorecard: { recommendation, ratings: groundedRatings(transcript) },
  provenance: { verdictSource: "llm", verdictProvider: "test-double" },
});
const noMint = { mint: async () => ({ credited: [] }) };

const cardOf = (record, entryId) =>
  record.artifacts.filter((a) => a.kind === "scorecard" && a.branchRef === entryId).sort((a, b) => b.seq - a.seq)[0]?.payload.cards.find((c) => c.entryId === entryId);

/** The standIn the script hands goalOneHeadline, built the way the script builds it. */
const standInOf = (record) => ({
  mode: "policy",
  tally: tallyStandIn(record.standInDecisions),
  simulatedOffers: simulatedOfferCount(record.standInDecisions, record.simulatedInterviews),
  endState: goalOneEndState({ runStatus: record.status, artifacts: record.artifacts, decisions: record.standInDecisions, simulatedInterviews: record.simulatedInterviews, cap: record.simulatedInterviewCap }),
});

const offerOf = (record, entryId) => record.standInDecisions.find((d) => d.gate === "offer" && d.branchRef === entryId);

test("the simulated interview is sealed between the invite approval and the S5 pass, and S5 carries it", async () => {
  const { jobId, entries } = await seedRole("order", 1);
  const [entryId] = entries;
  const record = await runDemoOnCopy({ jobId, standInMode: "policy", simDeps: { llms: fakeLlms, score: llmScorer("advance"), finalize: noMint } });
  assert.equal(record.failure, null);

  const [row] = record.simulatedInterviews;
  assert.equal(row.branchRef, entryId);
  assert.equal(row.skipped, null);
  assert.equal(row.recommendation, "advance");
  assert.equal(row.verdictSource, "llm");
  assert.ok(row.turns > 0 && row.endReason);

  // The session exists, is labelled simulated, is candidate-mode and completed in the run's workspace.
  const session = getInterviewSessionById(row.sessionId);
  assert.equal(session.mode, "candidate");
  assert.equal(session.status, "completed");
  assert.equal(session.entryId, entryId);
  assert.ok(session.candidateLabel.endsWith(SIMULATED_LABEL), "the session names itself simulated");

  // S5 read it, unchanged: the card names the session and its canonical recommendation. S5 only
  // runs on a pass AFTER the invite approval, so a card that carries the session proves the
  // interview was sealed in between — and the ledger orders them.
  const card = cardOf(record, entryId);
  assert.equal(card.sessionId, row.sessionId);
  assert.equal(card.recommendation, "advance");
  const invite = record.artifacts.filter((a) => a.kind === "interview" && a.branchRef === entryId && a.status === "complete").sort((a, b) => b.seq - a.seq)[0];
  const scorecard = record.artifacts.find((a) => a.kind === "scorecard" && a.branchRef === entryId);
  assert.ok(invite.seq < scorecard.seq, "the invite approval precedes the S5 card");
  assert.ok(new Date(session.createdAt).getTime() <= new Date(scorecard.producedAt).getTime(), "the session predates the S5 card");
});

test("an 'advance' card lets the stand-in approve the offer, and the headline says SIMULATED", async () => {
  const { jobId, entries } = await seedRole("advance", 1);
  const record = await runDemoOnCopy({ jobId, standInMode: "policy", simDeps: { llms: fakeLlms, score: llmScorer("advance"), finalize: noMint } });
  assert.equal(offerOf(record, entries[0]).action, "approve");
  assert.equal(record.goalOne.verdict, "met");

  const reading = summarizeRoleDemoRun({ runStatus: record.status, artifacts: record.artifacts, failure: record.failure });
  const standIn = standInOf(record);
  assert.equal(standIn.simulatedOffers, 1);
  const headline = goalOneHeadline(record.goalOne, reading, standIn);
  assert.match(headline, /^goal 1: met on a SIMULATED interview on a short demo agenda \(candidate played by the model from the CV on the entry\), gates by the demo stand-in/);
  // The fake interview ended by protocol, so clause (ii) holds and the headline says so; the label
  // can no longer be dropped by a count, because a plain "met" does not exist in a policy run.
  assert.match(headline, /1 on an interview that ended by protocol; run end state: complete$/);
  assert.match(goalOneHeadline(record.goalOne, reading, { ...standIn, endState: undefined }), /^goal 1: not met: .*end state was not evaluated/);
});

test("the demo hands the SHORT agenda to the brief, the instrument, the record and the session", async () => {
  const { entries } = await seedRole("short-agenda", 1);
  const [entryId] = entries;
  const seen = [];
  const spyLlms = (situation, instrument) => {
    seen.push(instrument);
    return fakeLlms(situation, instrument);
  };
  const row = await simulateInterviewForEntry(entryId, DEFAULT_WORKSPACE_ID, { llms: spyLlms, score: llmScorer("advance"), finalize: noMint });
  assert.equal(row.skipped, null);
  const [instrument] = seen;
  const blocks = instrument.agenda.blocks;
  assert.equal(blocks.filter((b) => b.scored).length, 1, "one scored block");
  assert.ok(blocks.length <= 3, `${blocks.length} blocks`);
  assert.deepEqual(instrument.record.agendaBlockIds, blocks.map((b) => b.id), "the record names the short agenda's blocks");
  // The brief lists THIS agenda: its title is there, and nothing else is asserted about dropped blocks.
  assert.ok(instrument.privateBrief.includes(blocks[0].title), "the brief lists the kept block");
  // The row and the session say which agenda and how long.
  assert.equal(row.agenda, "short-demo");
  assert.equal(row.agendaBlocks, blocks.length);
  assert.equal(getInterviewSessionById(row.sessionId).durationMin, instrument.agenda.durationMin, "the session states the short length");
  assert.ok(instrument.agenda.durationMin < 20, "shorter than a real kit's booking");
});

test("a 'hold' scorecard from the simulated interview is not a basis for an offer", async () => {
  const { jobId, entries } = await seedRole("hold", 1);
  const record = await runDemoOnCopy({ jobId, standInMode: "policy", simDeps: { llms: fakeLlms, score: llmScorer("hold"), finalize: noMint } });
  assert.equal(cardOf(record, entries[0]).recommendation, "hold");
  assert.equal(offerOf(record, entries[0]).action, "decline");
  const reading = summarizeRoleDemoRun({ runStatus: record.status, artifacts: record.artifacts, failure: record.failure });
  const standIn = standInOf(record);
  assert.match(goalOneHeadline(record.goalOne, reading, standIn), /^goal 1: not met/);
});

test("an unavailable provider (offline, no CLI) mints no session, leaves the card unrated and records why", async () => {
  const { jobId, entries } = await seedRole("offline", 1);
  const refuse = () => {
    throw new SimProviderError("KP_OFFLINE is set: the Claude CLI reaches Anthropic's cloud");
  };
  const record = await runDemoOnCopy({ jobId, standInMode: "policy", simDeps: { llms: refuse, score: llmScorer("advance"), finalize: noMint } });
  assert.equal(record.failure, null);
  const [row] = record.simulatedInterviews;
  assert.equal(row.sessionId, null);
  assert.equal(row.recommendation, null);
  assert.match(row.skipped, /provider unavailable/);
  assert.equal(latestInterviewByEntry(entries[0]), null, "no session was minted");
  const card = cardOf(record, entries[0]);
  assert.equal(card.recommendation, "unrated");
  assert.equal(card.sessionId, null);
  assert.equal(offerOf(record, entries[0]).action, "decline");
});

test("the real default provider also refuses under KP_OFFLINE, before anything is built", async () => {
  const { jobId, entries } = await seedRole("offline-default", 1);
  const before = process.env.KP_OFFLINE;
  process.env.KP_OFFLINE = "1";
  try {
    const record = await runDemoOnCopy({ jobId, standInMode: "policy" });
    const [row] = record.simulatedInterviews;
    assert.equal(row.sessionId, null);
    assert.match(row.skipped, /provider unavailable/);
    assert.equal(cardOf(record, entries[0]).recommendation, "unrated");
  } finally {
    if (before === undefined) delete process.env.KP_OFFLINE;
    else process.env.KP_OFFLINE = before;
  }
});

test("a template-sourced scorecard is never accepted: nothing attached, the card stays unrated", async () => {
  const { jobId, entries } = await seedRole("template", 1);
  const template = async (_session, transcript) => ({
    scorecard: { recommendation: "advance", ratings: groundedRatings(transcript) },
    provenance: { verdictSource: "template", verdictProvider: null },
  });
  const record = await runDemoOnCopy({ jobId, standInMode: "policy", simDeps: { llms: fakeLlms, score: template, finalize: noMint } });
  const [row] = record.simulatedInterviews;
  assert.equal(row.recommendation, null, "the row does not count as rated");
  assert.equal(row.verdictSource, "template");
  assert.match(row.skipped, /verdictSource template, not llm/);
  // The conversation did happen and its transcript is stored — but no scorecard rides on it.
  const session = getInterviewSessionById(row.sessionId);
  assert.equal(session.status, "completed");
  assert.equal(session.scorecard, null);
  const card = cardOf(record, entries[0]);
  assert.equal(card.recommendation, "unrated");
  assert.equal(card.sessionId, null);
  assert.equal(offerOf(record, entries[0]).action, "decline");
  assert.equal(simulatedOfferCount(record.standInDecisions, record.simulatedInterviews), 0);
  assert.notEqual(record.goalOne.verdict, "met");
});

test("a scorecard with no ratings is not rated by the demo and seals nothing", async () => {
  const { jobId, entries } = await seedRole("no-ratings", 1);
  const empty = async () => ({ scorecard: { recommendation: "advance", ratings: [] }, provenance: { verdictSource: "llm", verdictProvider: "test-double" } });
  const record = await runDemoOnCopy({ jobId, standInMode: "policy", simDeps: { llms: fakeLlms, score: empty, finalize: noMint } });
  const [row] = record.simulatedInterviews;
  assert.equal(row.recommendation, null, "the row does not count as rated");
  assert.equal(row.skipped, "not rated: the scorecard could not be attached");
  const session = getInterviewSessionById(row.sessionId);
  assert.equal(session.status, "completed");
  assert.equal(session.scorecard, null, "no scorecard is attached or sealed");
  assert.equal(cardOf(record, entries[0]).recommendation, "unrated");
  assert.equal(simulatedOfferCount(record.standInDecisions, record.simulatedInterviews), 0);
});

test("the cap holds: branches over it are recorded 'not simulated: cap' and stay unrated", async () => {
  const { jobId, entries } = await seedRole("cap", 3);
  const record = await runDemoOnCopy({ jobId, standInMode: "policy", simCap: 1, simDeps: { llms: fakeLlms, score: llmScorer("advance"), finalize: noMint } });
  assert.equal(record.simulatedInterviews.length, 3);
  assert.equal(record.simulatedInterviews.filter((r) => r.skipped === null).length, 1);
  assert.equal(record.simulatedInterviews.filter((r) => r.skipped === "not simulated: cap").length, 2);
  assert.equal(listRecentInterviewSessions().filter((s) => entries.includes(s.entryId)).length, 1, "only one session was minted");
  const unrated = entries.filter((e) => cardOf(record, e).recommendation === "unrated");
  assert.equal(unrated.length, 2);
  // Under the cap the default is 2 and the ceiling is 5, however high the flag goes.
  assert.equal(createRoleDemoSimulator({ workspaceId: "w" }).cap, 2);
  assert.equal(createRoleDemoSimulator({ cap: 99, workspaceId: "w" }).cap, MAX_SIM_INTERVIEWS);
  assert.equal(createRoleDemoSimulator({ cap: 0, workspaceId: "w" }).cap, 0);
  assert.equal(MAX_SIM_INTERVIEWS, 5);
});

test("--approve-all plays no interview", async () => {
  const { jobId } = await seedRole("all", 1);
  const record = await runDemoOnCopy({ jobId, standInMode: "all", simDeps: { llms: fakeLlms, score: llmScorer("advance"), finalize: noMint } });
  assert.equal(record.simulatedInterviews, undefined);
});

test("the reading carries counts and the recommendation, never transcript or scorecard text", async () => {
  const { jobId, entries } = await seedRole("pii", 1);
  const MARK = "ZEBRA-SENTINEL-4417";
  const talkative = (situation, instrument) => ({
    interviewer: (playedAgenda = instrument.agenda, fakeInterviewer(instrument.agenda)),
    candidate: { id: "marked-candidate", complete: async () => `${MARK} I led the payments service at the previous company.` },
  });
  const scorer = async (_session, transcript) => ({
    scorecard: { recommendation: "advance", ratings: groundedRatings(transcript), summary: `${MARK} evidence quote` },
    provenance: { verdictSource: "llm", verdictProvider: "test-double" },
  });
  const record = await runDemoOnCopy({ jobId, standInMode: "policy", simDeps: { llms: talkative, score: scorer, finalize: noMint } });
  // The sentinel really is in the stored transcript — otherwise the assertions below prove nothing.
  const stored = latestInterviewByEntry(entries[0]);
  assert.ok(stored.transcript.some((t) => t.text.includes(MARK)), "the sentinel is in the transcript");
  const reading = summarizeRoleDemoRun({ runStatus: record.status, artifacts: record.artifacts, failure: record.failure });
  const standIn = standInOf(record);
  const printed = [
    JSON.stringify(record.simulatedInterviews),
    ...formatSimulatedInterviews(record.simulatedInterviews),
    goalOneHeadline(record.goalOne, reading, standIn),
    JSON.stringify(record.artifacts),
  ].join("\n");
  assert.ok(!printed.includes(MARK), "no transcript or scorecard text reaches the reading");
  assert.deepEqual(Object.keys(record.simulatedInterviews[0]).sort(), ["agenda", "agendaBlocks", "branchRef", "endReason", "recommendation", "sessionId", "skipped", "turns", "verdictSource"]);
});

// ---- the SECURITY invariants of this path (codebase-security-scan, 2026-10-06) --------

test("the simulator refuses a database no demo parent declared a throwaway copy", async () => {
  const { jobId, entries } = await seedRole("guard", 1);
  const marker = process.env.KP_ROLE_DEMO_SCRATCH_DB;
  // The shape the guard exists for: an operator who moved their database OUT of the
  // repository's data/ directory, which is the documented way to do it. KP_DB_PATH still
  // points where the stores opened, so the path heuristic alone has nothing to object to.
  delete process.env.KP_ROLE_DEMO_SCRATCH_DB;
  try {
    const row = await simulateInterviewForEntry(entries[0], DEFAULT_WORKSPACE_ID, { llms: fakeLlms, score: llmScorer("advance"), finalize: noMint });
    assert.fail(`the simulator ran anyway: ${JSON.stringify(row)}`);
  } catch (err) {
    assert.match(String(err.message), /refusing to play a simulated interview/);
    assert.match(String(err.message), /KP_ROLE_DEMO_SCRATCH_DB is not set/);
  } finally {
    process.env.KP_ROLE_DEMO_SCRATCH_DB = marker;
  }
  // Nothing was read and nothing was written: no session on the entry, and the refusal is
  // a THROW, not a row — a row would let a caller mistake it for a handled skip.
  assert.equal(latestInterviewByEntry(entries[0]), null);
  assert.equal(jobId, `jd-demo-iv-guard`);

  // …and a marker that names some OTHER file is not a declaration about this one.
  const elsewhere = path.join(tmpdir(), "not-the-open-database.sqlite");
  assert.match(String(roleDemoScratchDbProblem(process.env.KP_DB_PATH, { KP_DB_PATH: process.env.KP_DB_PATH, KP_ROLE_DEMO_SCRATCH_DB: elsewhere })), /is not the database the stores opened/);
  // The path heuristic still runs underneath it: a marker cannot bless the operator's DB.
  assert.match(String(roleDemoScratchDbProblem(DEFAULT_DB_PATH, { KP_DB_PATH: DEFAULT_DB_PATH, KP_ROLE_DEMO_SCRATCH_DB: DEFAULT_DB_PATH })), /operator's database/);
  // And the marked unit-db passes, which is why every test above it runs at all.
  assert.equal(roleDemoScratchDbProblem(process.env.KP_DB_PATH, { KP_DB_PATH: process.env.KP_DB_PATH, KP_ROLE_DEMO_SCRATCH_DB: process.env.KP_DB_PATH }), null);
});

test("a failing provider and a failing scorer put NO interview text in the row's reason", async () => {
  const { jobId } = await seedRole("leak", 2);
  const MARK = "ZEBRA-SENTINEL-9902";

  // (a) On the FIRST branch the conversation dies inside the provider, and the provider's
  // error quotes the model's own turn — the exact shape the Claude CLI's "output was not
  // JSON" had. The second branch talks normally, so the scorer below is reached too.
  let played = 0;
  const leakyProvider = (situation, instrument) => {
    played += 1;
    return {
      interviewer: fakeInterviewer(instrument.agenda),
      candidate:
        played === 1
          ? {
              id: "leaky-candidate",
              complete: async () => {
                throw new Error(`Claude CLI output was not JSON: ${MARK} I led the payments service at Northwind.`);
              },
            }
          : fakeCandidate(situation),
    };
  };
  // (b) The call completes, and the SCORER throws with the transcript it was handed.
  const leakyScorer = async (_session, transcript) => {
    throw new Error(`python scorer failed on notes: ${transcript.map((t) => t.text).join(" ")} ${MARK}`);
  };

  const record = await runDemoOnCopy({
    jobId,
    standInMode: "policy",
    simDeps: { llms: leakyProvider, score: leakyScorer, finalize: noMint },
  });
  assert.equal(record.failure, null);
  const rows = record.simulatedInterviews;
  assert.equal(rows.length, 2);
  // Both branches are unrated and SAY so — the redaction is not silence.
  for (const row of rows) {
    assert.equal(row.recommendation, null);
    assert.ok(row.skipped, "every refusal still carries a reason");
  }
  // Both error paths were really taken — otherwise the sentinel assertion below is vacuous.
  assert.ok(rows.some((r) => /did not complete|conversation failed/.test(r.skipped)), `no call-failure row: ${JSON.stringify(rows)}`);
  assert.ok(rows.some((r) => /the scorer failed/.test(r.skipped)), `no scorer-failure row: ${JSON.stringify(rows)}`);
  assert.ok(rows.some((r) => /message withheld/.test(r.skipped)), `nothing was redacted: ${JSON.stringify(rows)}`);

  const reading = summarizeRoleDemoRun({ runStatus: record.status, artifacts: record.artifacts, failure: record.failure });
  const standIn = standInOf(record);
  const printed = [
    JSON.stringify(rows),
    ...formatSimulatedInterviews(rows),
    goalOneHeadline(record.goalOne, reading, standIn),
    JSON.stringify(record.artifacts),
    JSON.stringify(record.standInDecisions),
    String(record.failure),
  ].join("\n");
  assert.ok(!printed.includes(MARK), `the sentinel reached the reading: ${printed}`);
  assert.ok(!printed.includes("payments service"), "no model turn reached the reading");

  // The provider's OWN parser no longer quotes the turn either, which is where the
  // sentinel entered the chain in the real path.
  assert.throws(
    () => parseCliEnvelope(JSON.stringify({ subtype: "error_during_execution", is_error: true, result: `${MARK} spoken answer` }), "", 1),
    (err) => err instanceof SimProviderError && !err.message.includes(MARK)
  );
  assert.throws(
    () => parseCliEnvelope(`${MARK} not an envelope at all`, "", 0),
    (err) => err instanceof SimProviderError && !err.message.includes(MARK)
  );
});
// ---- finding 2b: SEEDED ENTRIES ONLY, proven, fail-closed ----------------------------

/** Deps that RECORD every seam a CV could leave through, and throw if one is reached. */
function tripwireDeps() {
  const calls = [];
  return {
    calls,
    deps: {
      preflight: () => {
        calls.push("preflight");
      },
      llms: (situation) => {
        calls.push(`llms:${situation.persona.length}`);
        throw new Error("the fixture must never build a provider for a refused entry");
      },
      score: async () => {
        calls.push("score");
        throw new Error("the fixture must never score a refused entry");
      },
      finalize: noMint,
    },
  };
}

test("an UNSEEDED entry is refused before anything is built: no provider, no session, no CV in the row", async () => {
  const MARK = "ZEBRA-SENTINEL-2B01";
  const { entryId } = await unseededRole("unseeded", { summary: `${MARK} led the payments service at Northwind` });
  // The sentinel really is on the entry's CV, else the assertion below proves nothing.
  const live = getProfileRecord(getPipelineEntry(entryId, DEFAULT_WORKSPACE_ID).candidateId, DEFAULT_WORKSPACE_ID);
  assert.ok(JSON.stringify(live.payload).includes(MARK), "the sentinel is on the stored CV profile");

  const { calls, deps } = tripwireDeps();
  const row = await simulateInterviewForEntry(entryId, DEFAULT_WORKSPACE_ID, deps);

  assert.deepEqual(calls, [], "the refusal happens before the preflight, the provider and the scorer");
  assert.equal(row.sessionId, null);
  assert.equal(latestInterviewByEntry(entryId), null, "no session was minted");
  assert.equal(row.recommendation, null);
  assert.ok(row.skipped.startsWith(NOT_SEED_DATA), `the row does not name the refusal: ${row.skipped}`);
  assert.match(row.skipped, /pipeline seed holds no entry with this id/);
  // The reason names which check failed and nothing off the row — no CV, no label, no id.
  assert.ok(!row.skipped.includes(MARK), `the sentinel reached the row: ${row.skipped}`);
  assert.ok(!row.skipped.includes("payments service"), `CV text reached the row: ${row.skipped}`);
  assert.ok(!row.skipped.includes("Candidate unseeded"), `the candidate's label reached the row: ${row.skipped}`);
  // A refused branch spent nothing, so it does not consume the batch cap.
  const simulator = createRoleDemoSimulator({ cap: 1, workspaceId: DEFAULT_WORKSPACE_ID, deps });
  await simulator.run(entryId);
  const second = await simulator.run(`${entryId}-other`);
  assert.notEqual(second.skipped, "not simulated: cap", "a not-seed refusal burned the cap");
  // And the reading counts it.
  assert.equal(notSeedRefusalCount(simulator.rows), 1);
  assert.ok(NOT_SEED_DATA.startsWith(NOT_SEED_REFUSAL), "the reading's restated prefix drifted from role-demo.ts");
});

test("a SEEDED entry passes the predicate, and the same entry with an edited CV does not", async () => {
  const { entries } = await seedRole("seed-proof", 1);
  const [entryId] = entries;
  const subjectOf = (id) => {
    const entry = getPipelineEntry(id, DEFAULT_WORKSPACE_ID);
    const profile = getProfileRecord(entry.candidateId, DEFAULT_WORKSPACE_ID);
    return { entryId: id, candidateId: entry.candidateId, candidateLabel: entry.candidateLabel, profileId: profile.row.id, profilePayload: profile.payload };
  };
  const subject = subjectOf(entryId);
  assert.equal(seedOriginProblem(subject), null, "a pristine seeded entry is not provable as seed data");

  // Unreadable fixtures refuse EVERYTHING — the demo never falls back to playing them.
  assert.match(String(seedOriginProblem(subject, null)), /seed fixtures could not be read/);
  // Neither the id shape nor a matching label is proof on its own: swap the candidate.
  assert.match(String(seedOriginProblem({ ...subject, candidateId: "cand-999" })), /not the candidate the pipeline seed gives/);
  assert.match(String(seedOriginProblem({ ...subject, candidateLabel: "Someone Else" })), /not the label the pipeline seed gives/);
  assert.match(String(seedOriginProblem({ ...subject, profileId: "cand-999" })), /not the entry's own candidate/);
  // Key order is not a difference; content is.
  const reordered = Object.fromEntries(Object.entries(subject.profilePayload).reverse());
  assert.equal(canonicalJson(reordered), canonicalJson(subject.profilePayload));
  assert.equal(seedOriginProblem({ ...subject, profilePayload: reordered }), null);

  // A SEED ID whose profile was changed — a rebuild, an edit, a GDPR erasure — is refused,
  // and refused the same way the simulator refuses it: before any provider call.
  const edited = { ...subject.profilePayload, skillClaims: [{ skill: "Rust", level: "strong" }] };
  ensureDb().prepare(`UPDATE profiles SET payload_json = ? WHERE id = ?`).run(JSON.stringify(edited), subject.candidateId);
  assert.match(String(seedOriginProblem(subjectOf(entryId))), /not the candidate seed's record for it/);

  const { calls, deps } = tripwireDeps();
  const row = await simulateInterviewForEntry(entryId, DEFAULT_WORKSPACE_ID, deps);
  assert.deepEqual(calls, []);
  assert.equal(latestInterviewByEntry(entryId), null, "no session was minted for an edited seed profile");
  assert.ok(row.skipped.startsWith(NOT_SEED_DATA), row.skipped);
  assert.match(row.skipped, /not the candidate seed's record for it/);
  assert.ok(!row.skipped.includes("Rust"), "the edited CV reached the row");
});

test("the run's own output names where a played CV goes", () => {
  // The line itself: one sentence, the Claude CLI on this machine's seat, nothing else.
  assert.match(SIM_PROVIDER_LINE, /claude -p/);
  assert.match(SIM_PROVIDER_LINE, /Claude seat/);
  assert.match(SIM_PROVIDER_LINE, /no other provider/);

  // …and the script really prints it, in BOTH readings. The printing is a process boundary a
  // unit test cannot cross, so this pins the two call sites in the script's source.
  const parent = readFileSync(new URL("../role-demo-run.mjs", import.meta.url), "utf8");
  assert.match(parent, /console\.log\(`\s*provider: \$\{SIM_PROVIDER_LINE\}`\)/, "the printed reading no longer names the provider");
  assert.match(parent, /simulatedInterviewProvider: SIM_PROVIDER_LINE/, "the --json reading no longer names the provider");
  assert.match(parent, /runEndState: endState\.runEndState, protocolEndedBases: endState\.protocolEndedBases/, "the --json reading no longer carries the end-state fields");
  assert.match(parent, /refusedNotSeedData: notSeedRefusalCount\(simulatedInterviews\)/, "the --json reading no longer counts the not-seed refusals");
  assert.match(parent, /refused as not seed data: \$\{notSeedRefusalCount\(simulatedInterviews\)\}/, "the printed reading no longer counts the not-seed refusals");
});

test("the demo child is sealed against comms egress, however the relay is configured", () => {
  // The seal itself: a configured relay resolves to nothing under the flag, so an
  // approved invite or offer could only ever queue in the copy's own outbox.
  const before = { seal: process.env.KP_NO_COMMS_EGRESS, hook: process.env.COMMS_WEBHOOK_URL };
  try {
    process.env.COMMS_WEBHOOK_URL = "https://relay.invalid/hook";
    delete process.env.KP_NO_COMMS_EGRESS;
    assert.equal(isRelayConfigured(), true, "the fixture is only meaningful with a relay configured");
    process.env.KP_NO_COMMS_EGRESS = "1";
    assert.equal(resolveRelay(), null);
    assert.equal(isRelayConfigured(), false);
    assert.equal(relayHealth(), "unconfigured");
    assert.equal(commsEgressSealed({ KP_NO_COMMS_EGRESS: "1" }), true);
    assert.equal(commsEgressSealed({}), false);
  } finally {
    if (before.seal === undefined) delete process.env.KP_NO_COMMS_EGRESS;
    else process.env.KP_NO_COMMS_EGRESS = before.seal;
    if (before.hook === undefined) delete process.env.COMMS_WEBHOOK_URL;
    else process.env.COMMS_WEBHOOK_URL = before.hook;
  }

  // …and the demo's parent half really sets it on the child. The spawn is a process
  // boundary a unit test cannot cross, so this pins the env block it is written in:
  // the two markers and the seal, all three on the COPY, never on the source.
  const parent = readFileSync(new URL("../role-demo-run.mjs", import.meta.url), "utf8");
  const spawnEnv = parent.match(/env: \{ \.\.\.process\.env,([^}]*)\}/);
  assert.ok(spawnEnv, "the child spawn no longer passes an env block — re-pin this test");
  for (const key of ["KP_DB_PATH: copy", "KP_ROLE_DEMO_SCRATCH_DB: copy", 'KP_NO_COMMS_EGRESS: "1"']) {
    assert.ok(spawnEnv[1].includes(key), `the child spawn does not set ${key}: ${spawnEnv[1]}`);
  }
});

// ---- 2026-10-06: the seed proof is counted past the cap ------------------------------

test("a CAPPED non-seed entry is a not-seed refusal, counted — never 'not simulated: cap'", async () => {
  const { entryId } = await unseededRole("capped-unseeded");
  const { calls, deps } = tripwireDeps();
  // cap 0: the budget is spent before the first branch, so every branch meets a spent cap.
  const simulator = createRoleDemoSimulator({ cap: 0, workspaceId: DEFAULT_WORKSPACE_ID, deps });
  const row = await simulator.run(entryId);
  assert.ok(row.skipped.startsWith(NOT_SEED_DATA), `a capped non-seed entry read: ${row.skipped}`);
  assert.match(row.skipped, /pipeline seed holds no entry with this id/);
  assert.equal(notSeedRefusalCount(simulator.rows), 1);
  assert.deepEqual(calls, [], "no preflight, provider or scorer for a refused entry");
  assert.equal(latestInterviewByEntry(entryId), null);
});

test("a CAPPED seed entry reads 'not simulated: cap', and nothing past the pre-check runs for it", async () => {
  const { entries } = await seedRole("capped-seed", 1);
  const { calls, deps } = tripwireDeps();
  const simulator = createRoleDemoSimulator({ cap: 0, workspaceId: DEFAULT_WORKSPACE_ID, deps });
  const row = await simulator.run(entries[0]);
  assert.equal(row.skipped, "not simulated: cap");
  assert.equal(notSeedRefusalCount(simulator.rows), 0, "a seed branch kept out by the cap is not a refusal");
  assert.deepEqual(calls, [], "no preflight, persona, provider or scorer for a capped entry");
  assert.equal(latestInterviewByEntry(entries[0]), null, "no session was minted");
});

test("past a spent cap the proof still runs: a seed entry reads cap, a non-seed one a refusal, in one batch", async () => {
  const { entries } = await seedRole("capped-batch", 2);
  const { entryId: stranger } = await unseededRole("capped-batch-stranger");
  const simulator = createRoleDemoSimulator({ cap: 1, workspaceId: DEFAULT_WORKSPACE_ID, deps: { llms: fakeLlms, score: llmScorer("advance"), finalize: noMint } });
  const rows = [await simulator.run(entries[0]), await simulator.run(entries[1]), await simulator.run(stranger)];
  assert.equal(rows[0].skipped, null, "the first seed branch spent the cap");
  assert.equal(rows[1].skipped, "not simulated: cap");
  assert.ok(rows[2].skipped.startsWith(NOT_SEED_DATA), `the stranger past the cap read: ${rows[2].skipped}`);
  assert.equal(notSeedRefusalCount(simulator.rows), 1);
});
