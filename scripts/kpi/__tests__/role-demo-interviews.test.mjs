// Fixtures for the goal-1 demo run's SIMULATED INTERVIEW (ADR-0011 amendment 2026-10-06):
// after the stand-in approves an interview invite, the demo plays the candidate from the
// seeded CV, seals the scorecard, and S5 reads it on the next pass. The whole child loop
// runs here (runDemoOnCopy) on a throwaway database, with the simulator's KEYLESS doubles
// (interview-sim/fake.ts) and a scripted scorer injected — nothing spawns `claude`.
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
import { createPipelineEntry } from "../../../app/_lib/db/pipeline.ts";
import { saveProfile } from "../../../app/_lib/db/profiles.ts";
import { listRecentInterviewSessions, latestInterviewByEntry, getInterviewSessionById } from "../../../app/_lib/db/interviews.ts";
import { saveInterviewPrep } from "../../../app/_lib/interview-prep.ts";
import { rosStrings } from "../../../app/_lib/interview-prep-strings.ts";
import { buildRunOfShow } from "../../../app/_lib/run-of-show.ts";
import { fakeCandidate, fakeInterviewer } from "../../../app/_lib/interview-sim/fake.ts";
import { MAX_SIM_INTERVIEWS, SIMULATED_LABEL, createRoleDemoSimulator, simulateInterviewForEntry } from "../../../app/_lib/interview-sim/role-demo.ts";
import { roleDemoScratchDbProblem } from "../../../app/_lib/interview-sim/instrument.ts";
import { SimProviderError, parseCliEnvelope } from "../../../app/_lib/interview-sim/providers.ts";
import { DEFAULT_WORKSPACE_ID } from "../../../app/_lib/db/workspaces.ts";
import { DEFAULT_DB_PATH } from "../../../app/_lib/db-path.ts";
import { commsEgressSealed, isRelayConfigured, relayHealth, resolveRelay } from "../../../app/_lib/comms-relay.ts";
import { runDemoOnCopy } from "../role-demo-run-child.mjs";
import { formatSimulatedInterviews, goalOneHeadline, simulatedOfferCount, summarizeRoleDemoRun, tallyStandIn } from "../role-demo-run-reading.mjs";

after(() => cleanupUnitDb());

const PREP_QUESTIONS = [
  { competency: "Event-driven systems", question: "Tell me about a system where messages could arrive twice.", whatsGoodLooksLike: "Listen for: idempotency keys" },
  { competency: "PostgreSQL performance", question: "Walk me through the slowest query you ever fixed.", whatsGoodLooksLike: "Listen for: EXPLAIN, a measured before and after" },
];

/** A job with `n` candidates, each with a seeded CV profile and an interview prep plan, so the
 *  agenda builds read-only with no model. Returns the job id and the entry ids. */
async function seedRole(tag, n) {
  const jobId = `jd-demo-iv-${tag}`;
  insertJob({ id: jobId, title: "Backend Engineer", requirements: [{ skill: "java", kind: "skill", hardness: "must" }] }, undefined, "published");
  const strings = await rosStrings("en");
  const entries = [];
  for (let i = 1; i <= n; i += 1) {
    const label = `Candidate ${tag}${i}`;
    const profile = saveProfile({
      label,
      archetype: "bau",
      roleFamily: "software_engineering",
      completeness: 1,
      payload: { displayName: label, roleFamily: "software_engineering", seniority: "senior", skillClaims: [{ skill: "Java", level: "working" }] },
    });
    const { entry } = createPipelineEntry({ candidateId: profile.id, candidateLabel: label, jobId, jobTitle: "Backend Engineer", matchScore: 90 });
    const plan = buildRunOfShow(PREP_QUESTIONS, ["event-driven systems"], label, "Backend Engineer", strings);
    saveInterviewPrep(entry.id, label, "Backend Engineer", { ...plan, lang: "en" });
    entries.push(entry.id);
  }
  return { jobId, entries };
}

const fakeLlms = (situation, instrument) => ({ interviewer: fakeInterviewer(instrument.agenda), candidate: fakeCandidate(situation) });
const llmScorer = (recommendation) => async () => ({
  scorecard: { recommendation, ratings: [] },
  provenance: { verdictSource: "llm", verdictProvider: "test-double" },
});
const noMint = { mint: async () => ({ credited: [] }) };

const cardOf = (record, entryId) =>
  record.artifacts.filter((a) => a.kind === "scorecard" && a.branchRef === entryId).sort((a, b) => b.seq - a.seq)[0]?.payload.cards.find((c) => c.entryId === entryId);

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
  const standIn = { mode: "policy", tally: tallyStandIn(record.standInDecisions), simulatedOffers: simulatedOfferCount(record.standInDecisions, record.simulatedInterviews) };
  assert.equal(standIn.simulatedOffers, 1);
  const headline = goalOneHeadline(record.goalOne, reading, standIn);
  assert.match(headline, /^goal 1: met on a SIMULATED interview \(candidate played by the model from the seeded CV\), gates by the demo stand-in/);
  // Without the simulated count the same ledger would read as a plain "met": the label is the guard.
  assert.doesNotMatch(goalOneHeadline(record.goalOne, reading, { ...standIn, simulatedOffers: 0 }), /SIMULATED/);
});

test("a 'hold' scorecard from the simulated interview is not a basis for an offer", async () => {
  const { jobId, entries } = await seedRole("hold", 1);
  const record = await runDemoOnCopy({ jobId, standInMode: "policy", simDeps: { llms: fakeLlms, score: llmScorer("hold"), finalize: noMint } });
  assert.equal(cardOf(record, entries[0]).recommendation, "hold");
  assert.equal(offerOf(record, entries[0]).action, "decline");
  const reading = summarizeRoleDemoRun({ runStatus: record.status, artifacts: record.artifacts, failure: record.failure });
  const standIn = { mode: "policy", tally: tallyStandIn(record.standInDecisions), simulatedOffers: simulatedOfferCount(record.standInDecisions, record.simulatedInterviews) };
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
  const template = async () => ({
    scorecard: { recommendation: "advance", ratings: [] },
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
    interviewer: fakeInterviewer(instrument.agenda),
    candidate: { id: "marked-candidate", complete: async () => `${MARK} I led the payments service at the previous company.` },
  });
  const scorer = async () => ({
    scorecard: { recommendation: "advance", ratings: [], summary: `${MARK} evidence quote` },
    provenance: { verdictSource: "llm", verdictProvider: "test-double" },
  });
  const record = await runDemoOnCopy({ jobId, standInMode: "policy", simDeps: { llms: talkative, score: scorer, finalize: noMint } });
  // The sentinel really is in the stored transcript — otherwise the assertions below prove nothing.
  const stored = latestInterviewByEntry(entries[0]);
  assert.ok(stored.transcript.some((t) => t.text.includes(MARK)), "the sentinel is in the transcript");
  const reading = summarizeRoleDemoRun({ runStatus: record.status, artifacts: record.artifacts, failure: record.failure });
  const standIn = { mode: "policy", tally: tallyStandIn(record.standInDecisions), simulatedOffers: simulatedOfferCount(record.standInDecisions, record.simulatedInterviews) };
  const printed = [
    JSON.stringify(record.simulatedInterviews),
    ...formatSimulatedInterviews(record.simulatedInterviews),
    goalOneHeadline(record.goalOne, reading, standIn),
    JSON.stringify(record.artifacts),
  ].join("\n");
  assert.ok(!printed.includes(MARK), "no transcript or scorecard text reaches the reading");
  assert.deepEqual(Object.keys(record.simulatedInterviews[0]).sort(), ["branchRef", "endReason", "recommendation", "sessionId", "skipped", "turns", "verdictSource"]);
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
  const { jobId, entries } = await seedRole("leak", 2);
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
  const standIn = { mode: "policy", tally: tallyStandIn(record.standInDecisions), simulatedOffers: simulatedOfferCount(record.standInDecisions, record.simulatedInterviews) };
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
