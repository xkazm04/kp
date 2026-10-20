// The role demo's short agenda (demo-agenda.ts): what it keeps, and that a call on it can end
// by protocol inside DEMO_SIM_LIMITS while the same interviewer on the FULL agenda cannot.
// No model calls: the fake interviewer and candidate are the seams (clock.test.ts).
//
// testing/unit-db.ts MUST be the first project import (it sets KP_DB_PATH).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";

import { buildSimInstrument, type SimInstrument } from "./instrument.ts";
import { runConversation } from "./engine.ts";
import { fakeCandidate } from "./fake.ts";
import { loadSituations } from "./situations.ts";
import { DEMO_SIM_LIMITS } from "./role-demo.ts";
import { shortDemoAgenda, SHORT_DEMO_AGENDA, SHORT_DEMO_MAX_MUST_ASKS } from "./demo-agenda.ts";
import { HARD_CAP_FACTOR, buildInterviewKit } from "../interview-agenda.ts";
import type { InterviewKit } from "../interview-agenda.ts";
import type { SimLlm, SimSituation } from "./types.ts";
import type { InterviewAgenda } from "../voice/director-types.ts";

after(() => cleanupUnitDb());

const situation = loadSituations().find((s) => s.id === "kit-concrete_doer-en") as SimSituation;

let fixture: { inst: SimInstrument; kit: InterviewKit } | null = null;
async function load() {
  if (!fixture) {
    const inst = await buildSimInstrument("kit", "en");
    const entryId = inst.seeded.entryId as string;
    const kit = (await buildInterviewKit(entryId, undefined, { kitId: inst.seeded.kitId })) as InterviewKit;
    fixture = { inst, kit };
  }
  return fixture;
}

const NL = String.fromCharCode(10);
const tool = (name: string, args: Record<string, unknown>) => `<<tool ${JSON.stringify({ name, args })}>>`;

/** An interviewer that asks EVERY listed question of a scored block, one per turn, plus one
 *  follow-up, before it records the block covered — which is what a real interviewer does, and what fakeInterviewer
 *  (one answer covers a block) does not. It then moves on, and closes with end_interview. */
function thoroughInterviewer(agenda: InterviewAgenda): SimLlm {
  const blocks = agenda.blocks;
  let active = -1;
  let asked = 0;
  const begin = (i: number): string => {
    active = i;
    asked = 1;
    const b = blocks[i];
    if (b.kind === "close") return [tool("begin_topic", { block_id: b.id }), tool("end_interview", { reason: "complete" }), "Thank you. Goodbye."].join(NL);
    return [tool("begin_topic", { block_id: b.id }), b.questions[0] ?? `Let's talk about ${b.title}.`].join(NL);
  };
  return {
    id: "thorough-interviewer",
    async complete({ messages }) {
      if (!messages.some((m) => m.role === "assistant")) return begin(0);
      const last = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
      if (/call end_interview/.test(last)) return [tool("end_interview", { reason: "time" }), "Out of time. Goodbye."].join(NL);
      if (/Say your short closing line now/.test(last)) return "Thank you. Goodbye.";
      if (!blocks[active]) throw new Error(`active ${active} last ${JSON.stringify(last).slice(0, 300)}`);
      const answer = last.split(String.fromCharCode(10)).filter((l) => l.startsWith("Candidate:")).map((l) => l.slice(10).trim()).join(" ");
      const quote = answer.split(/\s+/).slice(0, 12).join(" ");
      const b = blocks[active];
      if (b.scored) {
        if (asked < Math.max(1, b.questions.length) + 1) return b.questions[asked++] ?? "Can you give me a concrete example of that?";
        return [tool("mark_topic_covered", { block_id: b.id, evidence_quote: quote }), begin(active + 1)].join(NL);
      }
      if (b.kind === "close") throw new Error(`after close: ${JSON.stringify(last).slice(0, 600)}`);
      return begin(active + 1);
    },
  };
}

const protocolEnds = ["end_interview", "director_end"];
const candidateTurns = (d: Awaited<ReturnType<typeof runConversation>>) => d.turns.filter((t) => t.role === "candidate").length;

test("the short agenda keeps one scored block and the closing blocks, and says what it is", async () => {
  const { kit } = await load();
  const short = shortDemoAgenda(kit);
  assert.equal(short.demoAgenda, SHORT_DEMO_AGENDA);
  const blocks = short.agenda.blocks;
  assert.equal(blocks.filter((b) => b.scored).length, 1, "at most one scored block");
  assert.equal(blocks[0].kind, "topic");
  assert.equal(blocks[0].title, kit.agenda.blocks.find((b) => b.kind === "topic")?.title, "the kit's first topic");
  assert.deepEqual(blocks.slice(1).map((b) => b.kind), ["role_qa", "close"], "the closing blocks are kept");
  assert.ok((blocks[0].mustAsks?.length ?? 0) <= SHORT_DEMO_MAX_MUST_ASKS);
  assert.deepEqual(blocks.map((b) => b.id), blocks.map((_, i) => `b${i}`));
});

test("the short agenda's length, hard cap and close reserve agree with each other", async () => {
  const { kit } = await load();
  const a = shortDemoAgenda(kit).agenda;
  const total = a.blocks.reduce((n, b) => n + b.budgetMin, 0);
  assert.equal(a.durationMin, total);
  assert.equal(a.hardCapMin, Math.round(total * HARD_CAP_FACTOR));
  const closing = a.blocks.filter((b) => b.kind === "role_qa" || b.kind === "close").reduce((n, b) => n + b.budgetMin, 0);
  assert.equal(a.closeReserveMin, closing);
  assert.ok(a.durationMin < kit.agenda.durationMin, "shorter than the real agenda");
  assert.ok(a.closeReserveMin < a.hardCapMin);
});

test("the short agenda's private notes and block ids are consistent, and the real kit is untouched", async () => {
  const { kit } = await load();
  const before = JSON.stringify(kit);
  const short = shortDemoAgenda(kit);
  assert.equal(JSON.stringify(kit), before, "the input kit is not mutated");
  const ids = new Set(short.agenda.blocks.map((b) => b.id));
  for (const id of Object.keys(short.privateNotes)) assert.ok(ids.has(id), `private note ${id} names a kept block`);
  const firstTopic = kit.agenda.blocks.find((b) => b.kind === "topic");
  if (firstTopic && kit.privateNotes[firstTopic.id]) assert.equal(short.privateNotes.b0, kit.privateNotes[firstTopic.id]);
  assert.ok(Object.keys(short.privateNotes).length <= Object.keys(kit.privateNotes).length);
});

test("on the SHORT agenda a covering interviewer ends the call by protocol inside DEMO_SIM_LIMITS", async () => {
  const { inst, kit } = await load();
  const short = shortDemoAgenda(kit);
  const d = await runConversation({
    runId: "short",
    situation,
    instrument: { ...inst, agenda: short.agenda },
    interviewer: thoroughInterviewer(short.agenda),
    candidate: fakeCandidate(situation),
    limits: DEMO_SIM_LIMITS,
  });
  assert.ok(protocolEnds.includes(d.endedBy), `ended ${d.endedBy} ${String(d.error)}`);
  assert.ok(candidateTurns(d) <= (DEMO_SIM_LIMITS.maxCandidateTurns as number), `${candidateTurns(d)} candidate turns`);
});

test("CONTROL: the same interviewer on the FULL agenda under DEMO_SIM_LIMITS ends max_turns", async () => {
  const { inst } = await load();
  const d = await runConversation({
    runId: "full",
    situation,
    instrument: inst,
    interviewer: thoroughInterviewer(inst.agenda),
    candidate: fakeCandidate(situation),
    limits: DEMO_SIM_LIMITS,
  });
  assert.equal(d.endedBy, "max_turns");
});
