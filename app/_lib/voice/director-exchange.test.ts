// The director EXCHANGE kernel (voice/director-exchange.ts) — the one algorithm both
// the live route (voice/director-step.ts, over interview_events) and the interview
// simulator (interview-sim/director-loop.ts, over an array) run. Pins:
//   - turns are tagged with the block active BEFORE this exchange's tool;
//   - past the per-session ceiling nothing is stored, and the director still answers;
//   - endCall / clock read the same endCeilingMin end_now fires at;
//   - the live route and the simulator agree exchange by exchange on a scripted call;
//   - a resent turn is recorded once on the array store, as on the DB;
//   - the two source-text pins the kernel replaces are gone, and the heartbeat has
//     exactly one declaration;
//   - the kernel is part of the simulator's instrument identity (directorVersion).
//
// testing/unit-db.ts MUST be the first project import (it sets KP_DB_PATH).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ensureDb } from "../db/core.ts";
import { listInterviewEvents } from "../db/interview-events.ts";
import { createInterviewSession, getInterviewSessionByToken, markInterviewStarted } from "../db/interviews.ts";
import { endCeilingMin, type DirectorEvent } from "./director.ts";
import { directorExchange, type DirectorEventStore, type DirectorEventRow } from "./director-exchange.ts";
import { runDirectorStep } from "./director-step.ts";
import type { DirectorToolCallInput } from "./director.ts";
import type { DirectorTurn, InterviewAgenda } from "./director-types.ts";
import { InMemoryDirector, SIM_ATTEMPT } from "../interview-sim/director-loop.ts";
import { directorVersion, DIRECTOR_VERSION_FILES } from "../interview-sim/instrument.ts";

after(() => cleanupUnitDb());

const AGENDA: InterviewAgenda = {
  version: 1,
  durationMin: 30,
  hardCapMin: 36,
  closeReserveMin: 5,
  blocks: [
    { id: "b0", kind: "warmup", title: "Warm-up", budgetMin: 2, competency: null, scored: false, questions: ["How are you?"] },
    { id: "b1", kind: "topic", title: "System design", budgetMin: 6, competency: "architecture", scored: true, questions: ["Q1"] },
    { id: "b2", kind: "topic", title: "Debugging", budgetMin: 6, competency: "debugging", scored: true, questions: ["Q2"] },
    { id: "b5", kind: "role_qa", title: "Your questions", budgetMin: 3, competency: null, scored: false, questions: [] },
    { id: "b6", kind: "close", title: "Wrap-up", budgetMin: 2, competency: null, scored: false, questions: [] },
  ],
};

const START = Date.UTC(2026, 0, 5, 9, 0, 0);
const CANDIDATE_SAID = "Last year I rebuilt our payment reconciliation job so it runs incrementally instead of nightly.";
const turn = (seq: number, role: DirectorTurn["role"], text: string): DirectorTurn => ({ seq, role, text, at: "" });
let calls = 0;
/** A tool call with a fresh callId (a repeated callId is a REPLAY, answered from the record). */
const tool = (name: string, args: unknown): DirectorToolCallInput => ({ callId: `c${++calls}-${name}`, name, args });

/** An array store whose writes can be switched off (the per-session ceiling). */
function arrayStore(opts: { canStore?: boolean; seed?: DirectorEvent[] } = {}): DirectorEventStore & { rows: DirectorEvent[]; appends: number } {
  const rows: DirectorEvent[] = [...(opts.seed ?? [])];
  const store = {
    rows,
    appends: 0,
    events: () => [...rows],
    canStore: () => opts.canStore ?? true,
    append(drafts: readonly DirectorEventRow[], nowMs: number) {
      store.appends += 1;
      const written = drafts.map((d) => ({ kind: d.kind, attempt: SIM_ATTEMPT, seq: d.seq ?? null, blockId: d.blockId, payload: d.payload, createdAt: new Date(nowMs).toISOString() }));
      rows.push(...written);
      return written;
    },
    maxTurnSeq: () => rows.filter((r) => r.kind === "turn" && r.seq !== null).reduce((m, r) => Math.max(m, r.seq as number), -1),
  };
  return store;
}

const base = { agenda: AGENDA, attempt: SIM_ATTEMPT, attemptStartedAtMs: START, clientEvents: [] as const };

test("a turn is tagged with the block active BEFORE the exchange's tool; the answer reports the new block", () => {
  const store = arrayStore();
  directorExchange({ ...base, nowMs: START + 60_000, turns: [], tool: tool("begin_topic", { block_id: "b1" }), store });
  const res = directorExchange({
    ...base,
    nowMs: START + 120_000,
    turns: [turn(0, "candidate", CANDIDATE_SAID)],
    tool: tool("begin_topic", { block_id: "b2" }),
    store,
  });
  const stored = store.rows.find((r) => r.kind === "turn" && r.seq === 0);
  assert.equal(stored?.blockId, "b1");
  assert.equal(res.response.agenda.activeBlockId, "b2");
});

test("past the per-session ceiling nothing is stored, and the director still answers", () => {
  // b1 began a minute in; its 6-minute budget is long gone at minute 9.
  const seed: DirectorEvent[] = [{ kind: "topic_begun", attempt: SIM_ATTEMPT, seq: null, blockId: "b1", payload: {}, createdAt: new Date(START + 60_000).toISOString() }];
  const store = arrayStore({ canStore: false, seed });
  const res = directorExchange({
    ...base,
    nowMs: START + 9 * 60_000,
    turns: [turn(0, "candidate", CANDIDATE_SAID)],
    clientEvents: [{ kind: "focus_lost", at: "", during: "idle" }],
    tool: tool("mark_topic_covered", { block_id: "b1", evidence_quote: "rebuilt our payment reconciliation job" }),
    store,
  });
  assert.equal(typeof res.response.toolResult, "string");
  assert.ok(res.response.directive, "a due directive is still decided");
  assert.equal(store.appends, 0, "store.append is never called");
  assert.equal(store.rows.length, 1);
});

test("endCall and the clock read the same endCeilingMin end_now fires at", () => {
  const probe = arrayStore();
  const s0 = directorExchange({ ...base, nowMs: START, turns: [], tool: null, store: probe }).state;
  const limitMs = endCeilingMin(AGENDA, s0) * 60_000;
  const at = directorExchange({ ...base, nowMs: START + limitMs, turns: [], tool: null, store: arrayStore() });
  assert.equal(at.response.endCall, true);
  assert.equal(at.response.clock?.endLimitMs, limitMs);
  const before = directorExchange({ ...base, nowMs: START + limitMs - 1, turns: [], tool: null, store: arrayStore() });
  assert.equal(before.response.endCall, false);
});

test("client observations are persisted, tagged with the prior block and a clamped time", () => {
  const store = arrayStore();
  directorExchange({ ...base, nowMs: START + 60_000, turns: [], tool: tool("begin_topic", { block_id: "b1" }), store });
  directorExchange({
    ...base,
    nowMs: START + 90_000,
    turns: [],
    clientEvents: [
      { kind: "focus_lost", at: "garbage", during: "candidate" },
      { kind: "answer_timing", at: "", turnSeq: 3, preSilenceMs: 1200, durationMs: null },
    ],
    tool: null,
    store,
  });
  const obs = store.rows.filter((r) => r.kind === "focus_lost" || r.kind === "answer_timing");
  assert.deepEqual(obs.map((o) => [o.kind, o.blockId, o.payload]), [
    ["focus_lost", "b1", { during: "candidate" }],
    ["answer_timing", "b1", { turnSeq: 3, preSilenceMs: 1200, durationMs: null }],
  ]);
});

test("a resent turn on the simulator's store is recorded once and ackSeq does not move", () => {
  const sim = new InMemoryDirector(AGENDA, START);
  const first = sim.exchange({ turns: [{ seq: 0, role: "interviewer", text: "Hi" }, { seq: 1, role: "candidate", text: CANDIDATE_SAID }], tool: null, nowMs: START + 10_000 });
  assert.equal(first.ackSeq, 1);
  const again = sim.exchange({ turns: [{ seq: 1, role: "candidate", text: "tampered on retry" }], tool: null, nowMs: START + 20_000 });
  assert.equal(again.ackSeq, 1);
  const turns = sim.events.filter((e) => e.kind === "turn");
  assert.deepEqual(turns.map((t) => [t.seq, t.payload.text]), [[0, "Hi"], [1, CANDIDATE_SAID]]);
});

test("parity: the live route's step and the simulator agree exchange by exchange on a scripted call", () => {
  const created = createInterviewSession({
    provider: "openai",
    mode: "candidate",
    candidateLabel: "Parity Candidate",
    jobTitle: "Backend Engineer",
    instructions: "brief",
    durationMin: 30,
  });
  assert.ok(markInterviewStarted(created.id, true));
  ensureDb().prepare(`UPDATE interview_sessions SET agenda_json = ? WHERE id = ?`).run(JSON.stringify(AGENDA), created.id);
  const session = getInterviewSessionByToken(created.token);
  assert.ok(session && session.attempts === SIM_ATTEMPT);
  const startMs = Date.parse(session.updatedAt ?? session.startedAt ?? "");
  assert.ok(Number.isFinite(startMs));
  const sim = new InMemoryDirector(AGENDA, startMs);

  const script: { atMin: number; turns: DirectorTurn[]; tool: DirectorToolCallInput | null }[] = [
    { atMin: 1, turns: [turn(0, "interviewer", "Tell me about a system you designed."), turn(1, "candidate", CANDIDATE_SAID)], tool: tool("begin_topic", { block_id: "b1" }) },
    { atMin: 2, turns: [], tool: tool("mark_topic_covered", { block_id: "b1", evidence_quote: "The candidate showed deep ownership of backend systems" }) },
    { atMin: 9, turns: [], tool: null },
    { atMin: 10, turns: [turn(2, "interviewer", "Now debugging."), turn(3, "candidate", "I bisected a memory leak.")], tool: tool("begin_topic", { block_id: "b2" }) },
    { atMin: 11, turns: [turn(3, "candidate", "I bisected a memory leak.")], tool: null },
    { atMin: 12, turns: [], tool: tool("end_interview", { reason: "candidate_request" }) },
  ];
  const seen: { directive: string | null; endCall: boolean; toolResult: string | null }[] = [];
  for (const [i, step] of script.entries()) {
    const nowMs = startMs + step.atMin * 60_000;
    const live = runDirectorStep({ session, turns: step.turns, events: [], tool: step.tool, nowMs });
    const mem = sim.exchange({ turns: step.turns.map(({ seq, role, text }) => ({ seq, role: role === "system" ? "interviewer" : role, text })), tool: step.tool, nowMs });
    assert.equal(mem.toolResult, live.toolResult, `exchange ${i}: toolResult`);
    assert.equal(mem.directive?.kind ?? null, live.directive?.kind ?? null, `exchange ${i}: directive kind`);
    assert.equal(mem.endCall, live.endCall, `exchange ${i}: endCall`);
    assert.equal(mem.ackSeq, live.ackSeq, `exchange ${i}: ackSeq`);
    assert.deepEqual(mem.agenda, live.agenda, `exchange ${i}: agenda`);
    seen.push({ directive: live.directive?.kind ?? null, endCall: live.endCall, toolResult: live.toolResult });
  }
  // The script is not vacuous: a quote was refused, a budget directive fired, the call ended.
  assert.match(String(seen[1].toolResult), /Not recorded/);
  assert.ok(seen[2].directive, "the heartbeat past b1's budget carried a directive");
  assert.deepEqual(seen.map((x) => x.endCall), [false, false, false, false, false, true]);
  assert.equal(listInterviewEvents(session.id, session.workspaceId, { kinds: ["turn"] }).length, 4);
  // The live answer is the projection — the kernel's extras never reach the wire.
  const last = runDirectorStep({ session, turns: [], events: [], tool: null, nowMs: startMs + 13 * 60_000 });
  assert.deepEqual(Object.keys(last).sort(), ["ackSeq", "agenda", "clock", "directive", "endCall", "ok", "toolResult"]);
});

// ---- the source pins the kernel replaced, and the one heartbeat -------------------------

const REPO = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|mts|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

test("the simulator no longer pins production by reading its source, and the heartbeat is declared once", () => {
  const engineTest = readFileSync(path.join(REPO, "app/_lib/interview-sim/engine.test.ts"), "utf8");
  assert.doesNotMatch(engineTest, /readFileSync\([^)]*director-step/);
  assert.doesNotMatch(engineTest, /readFileSync\([^)]*useDirector/);
  const declarations = sourceFiles(path.join(REPO, "app")).filter((f) => /\b(?:const|let|var)\s+DIRECTOR_HEARTBEAT_MS\s*=/.test(readFileSync(f, "utf8")));
  assert.deepEqual(declarations.map((f) => path.relative(REPO, f).replace(/\\/g, "/")), ["app/_components/voice/call-observations.ts"]);
  const importsFromObservations = (rel: string) => /import\s*\{[^}]*\bDIRECTOR_HEARTBEAT_MS\b[^}]*\}\s*from\s*["'][^"']*call-observations["']/.test(readFileSync(path.join(REPO, rel), "utf8"));
  assert.ok(importsFromObservations("app/_components/voice/useDirector.ts"), "useDirector.ts imports the heartbeat");
  assert.ok(importsFromObservations("app/_lib/interview-sim/clock.ts"), "clock.ts imports the heartbeat");
});

test("the kernel is part of the simulator's instrument identity: one byte changes directorVersion()", () => {
  assert.ok(DIRECTOR_VERSION_FILES.some((f) => f.endsWith("voice/director-exchange.ts")));
  const real = directorVersion();
  const edited = directorVersion((file, text) => (file.endsWith("voice/director-exchange.ts") ? text.slice(0, -1) + (text.endsWith("x") ? "y" : "x") : text));
  assert.notEqual(edited, real);
  assert.equal(directorVersion((_file, text) => text), real, "the identity transform keeps the version");
});
