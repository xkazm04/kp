// The simulated clock drives the REAL director's time rules (spark interview-uat-tranche,
// WP-1). Against the job-kit fixture's real agenda (b0 warm-up 1 · b1 Service ownership
// 6, must-ask · b2 Working with others 4 · b3 Incidents 5, must-ask · b4 role questions 2
// · b5 close 2 = 20 min; hard cap 24; close reserve at 20; end at 26):
//   - a long-winded candidate makes stay_narrow fire, then move_on;
//   - a must-ask left to the end makes the director ask for the overrun, and the
//     candidate's answer either buys time up to 2× the booking or closes the call;
//   - a candidate's pause advances the clock with no words;
//   - the director's own end (hard cap + 2) runs the browser's end handshake.
//
// testing/unit-db.ts MUST be the first project import (it sets KP_DB_PATH).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";

import { buildSimInstrument, type SimInstrument } from "./instrument.ts";
import { runConversation, type SimConversationDump } from "./engine.ts";
import { fakeCandidate, fakeInterviewer, type FakeInterviewerPolicy } from "./fake.ts";
import { loadSituations } from "./situations.ts";
import { SIM_EPOCH_MS, spokenMs } from "./clock.ts";
import type { SimLlm, SimSituation } from "./types.ts";

after(() => cleanupUnitDb());

const MIN = 60_000;
const situations = loadSituations();
const byId = (id: string) => situations.find((s) => s.id === id) as SimSituation;

let kit: SimInstrument | null = null;
async function kitInstrument(): Promise<SimInstrument> {
  kit ??= await buildSimInstrument("kit", "en");
  return kit;
}

/** A candidate that answers every question with the same long, example-free story. */
function rambler(words = 260): SimLlm {
  const story = Array.from({ length: words }, (_, i) => ["well", "so", "the", "background", "there", "is", "long", "and"][i % 8]).join(" ");
  return { id: "rambler", complete: async () => story };
}

async function run(situation: SimSituation, interviewer: FakeInterviewerPolicy, candidate?: SimLlm): Promise<SimConversationDump> {
  const inst = await kitInstrument();
  return runConversation({ runId: "clock", situation, instrument: inst, interviewer: fakeInterviewer(inst.agenda, interviewer), candidate: candidate ?? fakeCandidate(situation) });
}

const kinds = (d: SimConversationDump) => d.trace.directives.map((x) => `${x.kind}:${x.blockId ?? "-"}`);

test("the fixture agenda is the one these tests reason about", async () => {
  const a = (await kitInstrument()).agenda;
  assert.deepEqual(
    a.blocks.map((b) => `${b.id}:${b.kind}:${b.budgetMin}${b.mustAsks?.length ? "!" : ""}`),
    ["b0:warmup:1", "b1:topic:6!", "b2:topic:4", "b3:topic:5!", "b4:role_qa:2", "b5:close:2"],
  );
  assert.equal(a.hardCapMin, 24);
  assert.equal(a.closeReserveMin, 4);
});

test("a long-winded candidate makes the director send stay_narrow, then move_on", async () => {
  const d = await run(byId("prep-rambling-en"), { cover: false }, rambler());
  const seq = kinds(d);
  const narrow = seq.indexOf("stay_narrow:b1");
  const moveOn = seq.indexOf("move_on:b2");
  assert.ok(narrow >= 0, `stay_narrow for b1 fired: ${seq.join(" ")}`);
  assert.ok(moveOn > narrow, `move_on to b2 came after it: ${seq.join(" ")}`);
  // Coverage first: never before the block's own budget was spent.
  const begunB1 = d.trace.events.find((e) => e.kind === "topic_begun" && e.blockId === "b1") as { createdAt: string };
  const b1At = Date.parse(begunB1.createdAt) - SIM_EPOCH_MS;
  const narrowAt = d.trace.directives[narrow].simAtMs;
  assert.ok(narrowAt - b1At >= 6 * MIN, `stay_narrow ${narrowAt - b1At} ms into a 6-minute block`);
  // The fake follows it: the move_on names b2 and b2 is begun next.
  const beganB2 = d.trace.events.findIndex((e) => e.kind === "topic_begun" && e.blockId === "b2");
  const moveOnEvent = d.trace.events.findIndex((e) => e.kind === "directive" && e.payload.kind === "move_on" && e.blockId === "b2");
  assert.ok(beganB2 > moveOnEvent, "the interviewer began b2 after the direction");
  const text = d.turns.find((t) => t.role === "director" && t.text.includes("Time for block b1"))?.text ?? "";
  assert.match(text, /^\[Director\] Time for block b1 \(“Service ownership”\) is up\./, "the directive text is injected verbatim");
});

test("a must-ask left to the end makes the director ask for the overrun at the close reserve", async () => {
  const d = await run(byId("prep-rambling-en"), { cover: false }, rambler());
  const ask = d.trace.directives.find((x) => x.kind === "ask_overrun");
  assert.ok(ask, `ask_overrun fired: ${kinds(d).join(" ")}`);
  assert.ok(ask.simAtMs >= 20 * MIN && ask.simAtMs < 21 * MIN, `at the close reserve (${ask.simAtMs} ms)`);
  assert.ok(!kinds(d).slice(0, kinds(d).indexOf(`ask_overrun:${ask.blockId}`)).some((k) => k.startsWith("close_now")), "asked BEFORE any close_now");
  assert.match(d.turns.find((t) => t.role === "director" && t.text.includes("time limit"))?.text ?? "", /2 required questions from the recruiter's kit have not been asked/);
});

test("an agreed overrun buys time up to 2× the booking, and the call ends there", async () => {
  const d = await run(byId("kit-agrees_overrun-en"), { cover: false });
  assert.equal(d.trace.final.overrunAnswer, "agreed");
  assert.equal(d.trace.final.endLimitMs, 40 * MIN, "2 × the 20-minute booking");
  assert.ok(d.trace.events.some((e) => e.kind === "overrun_answered" && e.payload.answer === "agreed"));
  assert.ok(d.simElapsedMs > 26 * MIN, "the call ran past the ordinary end (hard cap + 2)");
  assert.equal(d.endedBy, "director_end");
  assert.ok(d.trace.endSignal && d.trace.endSignal.simAtMs === 40 * MIN, `ended at the extended limit: ${JSON.stringify(d.trace.endSignal)}`);
  assert.equal(d.trace.hardStopAtSimMs, 40 * MIN, "the browser's fallback stop was re-armed to the same limit");
});

test("a declined overrun closes the call and records the unasked must-asks", async () => {
  const d = await run(byId("rehearsal-declines_overrun-en"), { cover: false });
  assert.equal(d.trace.final.overrunAnswer, "declined");
  assert.equal(d.endedBy, "end_interview");
  assert.ok(d.simElapsedMs < 26 * MIN, "inside the ordinary end");
  const unasked = d.trace.events.filter((e) => e.kind === "must_ask_unasked").map((e) => e.payload.questionId).sort();
  assert.deepEqual(unasked, ["q-inc-1", "q-own-1"]);
});

test("a candidate's pause advances the simulated clock without words", async () => {
  const s = byId("kit-concrete_doer-en");
  let calls = 0;
  const pauser: SimLlm = {
    id: "pauser",
    async complete() {
      calls += 1;
      return calls === 1 ? "<<pause 30>>" : "In my last role I owned the payments ledger service end to end and ran it for three years.";
    },
  };
  const d = await run(s, {}, pauser);
  const silence = d.turns.find((t) => t.role === "system" && t.text.startsWith("the candidate stayed silent"));
  assert.ok(silence, "the silence is on the record");
  assert.match(silence.text, /32 s/, "30 s of pause plus the turn latency");
  const before = d.turns[d.turns.indexOf(silence) - 1];
  assert.ok(silence.simAtMs - before.simAtMs >= 30_000, "the clock moved 30 s with no words");
  const silentTurns = d.trace.events.filter((e) => e.kind === "turn" && e.payload.role === "candidate" && String(e.payload.text).trim() === "");
  assert.equal(silentTurns.length, 0, "silence posts no turn to the director");
});

test("the director's own end runs the browser's handshake: the call ends right after the signal", async () => {
  // An interviewer that never uses a tool after the opening and ignores every direction.
  const deaf: SimLlm = {
    id: "deaf",
    async complete({ messages }) {
      return messages.some((m) => m.role === "assistant") ? "Tell me more about that." : '<<tool {"name":"begin_topic","args":{"block_id":"b1"}}>>\nHello, I am an AI interviewer. This call is transcribed for a human recruiter. Tell me about your work.';
    },
  };
  const inst = await kitInstrument();
  const d = await runConversation({ runId: "clock", situation: byId("prep-rambling-en"), instrument: inst, interviewer: deaf, candidate: rambler() });
  const seq = d.trace.directives.map((x) => x.kind);
  assert.ok(seq.indexOf("ask_overrun") < seq.indexOf("close_now") && seq.indexOf("close_now") < seq.indexOf("end_now"), seq.join(" "));
  assert.equal(d.endedBy, "director_end");
  assert.equal(d.trace.endSignal?.simAtMs, 26 * MIN, "hard cap 24 + the 2-minute grace");
  const tail = d.simElapsedMs - 26 * MIN;
  assert.ok(tail >= 0 && tail <= spokenMs("Tell me more about that.") + 10_000, `the call ended ${tail} ms after the signal`);
  assert.equal(d.trace.hardStopAtSimMs, 26 * MIN, "the browser's fallback stop agreed with the director");
});
