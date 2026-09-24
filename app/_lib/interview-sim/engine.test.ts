// The interview simulator's engine (spark interview-uat-tranche, WP-1), DB-backed:
//   - every fixture builds a REAL directed instrument (agenda + both briefs) on the
//     throwaway database, of the branch it claims, with the harness kept out of the brief;
//   - one situation per fixture runs end to end on the keyless fake providers;
//   - the candidate never receives the brief, a [Director] line, a tool line or a result;
//   - nothing can reach the operator's database;
//   - the in-memory mirror of director-step.ts and the heartbeat still match production;
//   - a rerun into the same output directory skips what is already dumped.
//
// testing/unit-db.ts MUST be the first project import (it sets KP_DB_PATH).
import { cleanupUnitDb, UNIT_DB_PATH } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DB_PATH, DEFAULT_DB_PATH } from "../db-path.ts";
import { assertThrowawayDb, buildSimInstrument, throwawayDbProblem, type SimInstrument } from "./instrument.ts";
import { candidateSystem, INTERVIEWER_HARNESS_PREAMBLE, interviewerSystem, runConversation } from "./engine.ts";
import { fakeCandidate, fakeInterviewer, recordingLlm } from "./fake.ts";
import { instrumentLocaleFor, loadSituations, SIM_INVARIANTS } from "./situations.ts";
import { runSimulations } from "./runner.ts";
import { DIRECTOR_HEARTBEAT_MS } from "./clock.ts";
import { SIM_FIXTURES, type SimFixture, type SimLlm, type SimSituation } from "./types.ts";

after(() => cleanupUnitDb());

const situations = loadSituations();
const instruments = new Map<string, SimInstrument>();
async function instrumentFor(s: Pick<SimSituation, "fixture" | "language" | "provokes">): Promise<SimInstrument> {
  const locale = instrumentLocaleFor(s);
  const key = `${s.fixture}.${locale ?? "auto"}`;
  if (!instruments.has(key)) instruments.set(key, await buildSimInstrument(s.fixture, locale));
  return instruments.get(key) as SimInstrument;
}

test("the situation bank is valid, covers every fixture, both languages and every required behaviour", () => {
  const behaviours = new Set(situations.map((s) => s.behaviour));
  const python16 = ["strong", "nervous", "rambling", "terse", "overhonest", "concrete_doer", "namedropper", "buzzword", "prompt_injection", "asks_score", "off_topic", "monologue", "minimal", "hostile", "language_switch", "inconsistent"];
  const registryMissing = ["asks_for_human", "withdraws_consent", "sensitive_disclosure", "alleges_discrimination", "distressed", "authority_claim", "benign_near_miss", "escalates_within_call"];
  const director = ["agrees_overrun", "declines_overrun", "premature_complete", "thin_quote", "faq_answered", "faq_unanswered"];
  for (const b of [...python16, ...registryMissing, ...director]) assert.ok(behaviours.has(b), `the bank plays ${b}`);
  for (const f of SIM_FIXTURES) assert.ok(situations.some((s) => s.fixture === f), `a situation on ${f}`);
  assert.ok(situations.some((s) => s.language === "cs" && s.provokes.includes("language_follow")), "a Czech language-lock situation");
  for (const s of situations) for (const p of s.provokes) assert.ok(p in SIM_INVARIANTS, `${s.id}: ${p}`);
  // Only the three Python behaviours that had a Czech variant keep their verbatim prompt
  // plus the Czech directive; the port is verbatim everywhere else.
  const ported = situations.find((s) => s.id === "prep-rambling-en") as SimSituation;
  assert.ok(ported.persona.endsWith("You ramble. You answer at great length, wander into tangents, and rarely stop on your own. Friendly, not hostile — you just talk a lot. Produce long meandering replies that drift off the question."));
});

test("every fixture builds the REAL directed instrument of the branch it names, on the throwaway database", async () => {
  for (const fixture of SIM_FIXTURES) {
    const inst = await buildSimInstrument(fixture, "en");
    assert.equal(inst.branch, fixture === "rehearsal" ? "kit" : fixture, fixture);
    assert.deepEqual(inst.record.agendaBlockIds, inst.agenda.blocks.map((b) => b.id));
    assert.match(inst.record.briefSha, /^sha256:[0-9a-f]{16}$/);
    assert.match(inst.record.directorVersion, /^sha256:[0-9a-f]{16}$/);
    assert.match(inst.privateBrief, /Director protocol/, `${fixture}: the private brief carries the director protocol`);
    assert.ok(inst.candidateBrief && /Director protocol/.test(inst.candidateBrief), `${fixture}: the candidate-safe brief is built too`);
    assert.ok(!inst.privateBrief.includes("TEST HARNESS"), `${fixture}: the harness never enters the brief under test`);
    assert.ok(interviewerSystem(inst).startsWith(inst.privateBrief) && interviewerSystem(inst).endsWith(INTERVIEWER_HARNESS_PREAMBLE));
    if (fixture === "kit" || fixture === "rehearsal") {
      assert.match(inst.privateBrief, /Required, never skipped even if you are over time/, `${fixture}: the must-asks reach the private brief`);
      assert.match(inst.privateBrief, /One week in six/, `${fixture}: the kit FAQ reaches ROLE FACTS`);
    }
  }
  const kit = await buildSimInstrument("kit", "en");
  const rehearsal = await buildSimInstrument("rehearsal", "en");
  assert.equal(kit.privateBrief, rehearsal.privateBrief, "a no-prep candidate on the pinned kit and a rehearsal of the same kit hear the same private brief");
});

test("one situation per fixture runs end to end on the keyless fakes, against the real director", async () => {
  for (const fixture of SIM_FIXTURES) {
    const s = situations.find((x) => x.fixture === fixture && x.behaviour !== "terse" && x.behaviour !== "minimal") as SimSituation;
    const inst = await instrumentFor(s);
    const dump = await runConversation({ runId: "t", situation: s, instrument: inst, interviewer: fakeInterviewer(inst.agenda), candidate: fakeCandidate(s) });
    assert.equal(dump.endedBy, "end_interview", `${s.id}: ${dump.error ?? ""}`);
    assert.equal(dump.fixture, fixture);
    assert.deepEqual(dump.instrument, inst.record);
    const tools = dump.turns.filter((t) => t.tool).map((t) => t.tool?.name);
    assert.ok(tools.includes("begin_topic") && tools.includes("mark_topic_covered") && tools.includes("end_interview"), `${s.id}: ${tools.join(",")}`);
    // Every result the interviewer was handed is the director's own string.
    for (const t of dump.turns.filter((x) => x.tool)) assert.ok(typeof t.tool?.result === "string" && t.tool.result.length > 0);
    // The director's record holds both sides' turns, tagged with a block.
    const turnEvents = dump.trace.events.filter((e) => e.kind === "turn");
    assert.ok(turnEvents.some((e) => e.payload.role === "candidate") && turnEvents.some((e) => e.payload.role === "interviewer"));
    assert.ok(dump.trace.final.coveredBlockIds.length > 0, `${s.id}: the director accepted the fake's verbatim quotes`);
    assert.ok(dump.simElapsedMs > 0 && dump.turns.every((t, i) => i === 0 || t.simAtMs >= dump.turns[i - 1].simAtMs), "the clock only moves forward");
    if (s.firstMessage) assert.equal(dump.turns.find((t) => t.role === "candidate")?.text, s.firstMessage);
  }
});

test("the candidate never receives the brief, a [Director] line, a tool line or a tool result", async () => {
  const s = situations.find((x) => x.id === "prep-rambling-en") as SimSituation;
  const inst = await instrumentFor(s);
  // An interviewer that exercises every seam: well-formed, inline and malformed calls,
  // long enough on the clock (a rambling candidate) for directives to fire.
  const inner = fakeInterviewer(inst.agenda, { cover: false });
  let n = 0;
  const noisy: SimLlm = {
    id: "noisy-fake",
    async complete(opts) {
      n += 1;
      const base = await inner.complete(opts);
      return n % 3 === 0 ? `${base} <<tool {"name":"forward_question","args":{"question":"inline?"}}>> <<tool begin_topic b9>>` : base;
    },
  };
  const candidate = recordingLlm(fakeCandidate(s));
  const dump = await runConversation({ runId: "t", situation: s, instrument: inst, interviewer: noisy, candidate });
  assert.ok(dump.trace.directives.length > 0, "directives fired, so the guard is exercised");
  assert.ok(candidate.calls.length > 3);
  const briefProbes = ["Director protocol", "TEST HARNESS", "Listen for", "missing must-have", "ROLE FACTS", inst.privateBrief.slice(0, 120)];
  for (const c of candidate.calls) {
    assert.equal(c.system, candidateSystem(s), "the candidate's system is its persona and nothing else");
    const seen = c.messages.map((m) => m.content).join("\n");
    for (const forbidden of ["[Director]", "<<tool", "<<result", ...briefProbes]) {
      assert.ok(!seen.includes(forbidden), `the candidate received ${JSON.stringify(forbidden.slice(0, 40))}`);
    }
  }
});

test("nothing can reach the operator's database", () => {
  assert.equal(path.resolve(DB_PATH), path.resolve(UNIT_DB_PATH), "every store opened the throwaway file");
  assert.notEqual(path.resolve(DB_PATH), path.resolve(DEFAULT_DB_PATH));
  const holder = globalThis as typeof globalThis & { __kpDb?: { name: string } };
  assert.equal(path.resolve(holder.__kpDb?.name ?? ""), path.resolve(UNIT_DB_PATH), "the main connection is the throwaway file");
  assert.doesNotThrow(() => assertThrowawayDb());
  const repoData = path.dirname(DEFAULT_DB_PATH);
  assert.match(String(throwawayDbProblem(DEFAULT_DB_PATH, {})), /not set/);
  assert.match(String(throwawayDbProblem(DEFAULT_DB_PATH, { KP_DB_PATH: DEFAULT_DB_PATH })), /operator's database/);
  const e2e = path.join(repoData, "kp-e2e.sqlite");
  assert.match(String(throwawayDbProblem(e2e, { KP_DB_PATH: e2e })), /data\/ directory/);
  assert.match(String(throwawayDbProblem(UNIT_DB_PATH, { KP_DB_PATH: path.join(tmpdir(), "elsewhere.sqlite") })), /set too late/);
  assert.equal(throwawayDbProblem(UNIT_DB_PATH, { KP_DB_PATH: UNIT_DB_PATH }), null);
});

test("the in-memory exchange still mirrors director-step.ts's order", () => {
  const src = readFileSync(new URL("../voice/director-step.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const at = (needle: string) => {
    const i = src.indexOf(needle);
    assert.ok(i >= 0, `director-step.ts no longer contains ${JSON.stringify(needle)} — re-check director-loop.ts`);
    return i;
  };
  assert.ok(at("// 1. Persist what the browser observed") < at("// 2. At most one tool call.") && at("// 2. At most one tool call.") < at("// 3. At most one stage direction"));
  at("blockId: before.activeBlockId");
  at("endCall: Boolean(outcome?.endCall) || state.endRequested || overTime");
  at("state.elapsedMs >= endCeilingMin(agenda, state) * 60_000");
});

test("the simulated heartbeat is the browser's", () => {
  const src = readFileSync(new URL("../../_components/voice/useDirector.ts", import.meta.url), "utf8");
  const m = /DIRECTOR_HEARTBEAT_MS\s*=\s*([\d_]+)/.exec(src);
  assert.ok(m, "useDirector.ts still declares DIRECTOR_HEARTBEAT_MS");
  assert.equal(Number(m[1].replace(/_/g, "")), DIRECTOR_HEARTBEAT_MS);
});

test("a run writes one dump per conversation plus an index, and a rerun skips what is already dumped", async () => {
  const out = mkdtempSync(path.join(tmpdir(), "kp-sim-run-"));
  try {
    const picked = (["kit", "debrief"] as SimFixture[]).map((f) => situations.find((s) => s.fixture === f && s.language === "en") as SimSituation);
    let builds = 0;
    const opts = {
      runId: "run-1",
      outDir: out,
      situations: picked,
      workers: 2,
      seed: 7,
      buildInstrument: async (f: SimFixture, l: string | null) => {
        builds += 1;
        return buildSimInstrument(f, l);
      },
      providers: (s: SimSituation, inst: SimInstrument) => ({ interviewer: fakeInterviewer(inst.agenda), candidate: fakeCandidate(s) }),
    };
    const first = await runSimulations(opts);
    assert.equal(first.ran.length, 2);
    assert.equal(builds, 2, "one instrument per fixture and locale");
    const index = JSON.parse(readFileSync(path.join(out, "index.json"), "utf8")) as { conversations: { situationId: string }[]; runs: unknown[] };
    assert.deepEqual(index.conversations.map((c) => c.situationId).sort(), picked.map((s) => s.id).sort());

    const again = await runSimulations({ ...opts, runId: "run-2" });
    assert.equal(again.ran.length, 0);
    assert.deepEqual(again.skipped.sort(), picked.map((s) => s.id).sort());

    // An errored conversation is not a result: it runs again.
    const file = path.join(out, `${picked[0].id}.json`);
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), endedBy: "error" }));
    const third = await runSimulations({ ...opts, runId: "run-3" });
    assert.deepEqual(third.ran.map((r) => r.situationId), [picked[0].id]);
    const finalIndex = JSON.parse(readFileSync(path.join(out, "index.json"), "utf8")) as { runs: unknown[] };
    assert.equal(finalIndex.runs.length, 3, "every run into the directory is on the index");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
