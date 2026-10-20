// The transcript modal's evidence derivations (WP4), pinned without a DOM.
//
// The properties that matter here are conservation and honesty: every turn of the
// stored transcript lands in exactly one section (a turn the director never saw is
// still the candidate's words), blocks come in agenda order with the off-agenda runs
// where they happened, and a signal nobody measured stays null.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alignTurnsToBlocks,
  clockLabel,
  groupTranscriptByBlock,
  summarizeAnswerTiming,
  summarizeFocus,
  type EvidenceBlock,
  type EvidenceEvent,
} from "./scheduleInterviewEvidence.ts";
import type { VoiceTurn } from "@/app/_lib/voice/types";

const block = (id: string, over: Partial<EvidenceBlock> = {}): EvidenceBlock => ({
  id,
  kind: "topic",
  title: id.toUpperCase(),
  budgetMin: 6,
  scored: true,
  begun: true,
  covered: false,
  spentMs: 0,
  ...over,
});

const BLOCKS: EvidenceBlock[] = [
  block("b0", { kind: "warmup", title: "Warm-up", scored: false, budgetMin: 2 }),
  block("b1", { title: "System design" }),
  block("b2", { title: "Debugging" }),
  block("b3", { kind: "close", title: "Wrap-up", scored: false, budgetMin: 2, begun: false }),
];

const turn = (role: VoiceTurn["role"], text: string): VoiceTurn => ({ role, text });

const rec = (role: string, text: string, blockId: string | null, offsetMs: number): EvidenceEvent => ({
  kind: "turn",
  attempt: 1,
  seq: offsetMs,
  blockId,
  at: new Date(offsetMs).toISOString(),
  offsetMs,
  role: role as EvidenceEvent["role"],
  text,
});

test("alignment anchors each stored turn to the block that was live when it was said", () => {
  const transcript = [
    turn("interviewer", "Good morning."),
    turn("candidate", "Morning!"),
    turn("interviewer", "Tell me about a system you designed."),
    turn("candidate", "I rebuilt the reconciliation job."),
  ];
  const record = [
    rec("interviewer", "Good morning.", null, 0),
    rec("candidate", "Morning!", "b0", 4_000),
    rec("interviewer", "Tell me about a system you designed.", "b1", 60_000),
    rec("candidate", "I rebuilt the reconciliation job.", "b1", 75_000),
  ];
  assert.deepEqual(alignTurnsToBlocks(transcript, record), [
    { blockId: null, offsetMs: 0 },
    { blockId: "b0", offsetMs: 4_000 },
    { blockId: "b1", offsetMs: 60_000 },
    { blockId: "b1", offsetMs: 75_000 },
  ]);
});

test("a stored turn the director never saw stays unanchored — and is never dropped", () => {
  const transcript = [turn("interviewer", "Good morning."), turn("candidate", "Morning!"), turn("interviewer", "Goodbye.")];
  const record = [rec("interviewer", "Good morning.", "b0", 0), rec("candidate", "Morning!", "b0", 1_000)];
  const anchors = alignTurnsToBlocks(transcript, record);
  assert.equal(anchors.length, 3);
  assert.deepEqual(anchors[2], { blockId: null, offsetMs: null });
});

test("alignment is order-preserving: a repeated one-word turn cannot anchor to a later moment", () => {
  const transcript = [turn("candidate", "Yes."), turn("interviewer", "Now debugging."), turn("candidate", "Yes.")];
  const record = [rec("candidate", "Yes.", "b1", 1_000), rec("interviewer", "Now debugging.", "b2", 2_000), rec("candidate", "Yes.", "b2", 3_000)];
  assert.deepEqual(
    alignTurnsToBlocks(transcript, record).map((a) => a.blockId),
    ["b1", "b2", "b2"],
  );
});

test("sections keep every turn exactly once, blocks in agenda order, off-agenda runs where they happened", () => {
  const anchors = [
    { blockId: null, offsetMs: 0 }, // the greeting, before any block began
    { blockId: "b0", offsetMs: 1 },
    { blockId: "b1", offsetMs: 2 },
    { blockId: null, offsetMs: 3 }, // a gap between topics
    { blockId: "b2", offsetMs: 4 },
  ];
  const sections = groupTranscriptByBlock(anchors, BLOCKS);
  assert.deepEqual(
    sections.map((s) => (s.kind === "block" ? s.block.id : "off")),
    ["off", "b0", "b1", "off", "b2", "b3"],
  );
  const all = sections.flatMap((s) => s.turns).sort((a, b) => a - b);
  assert.deepEqual(all, [0, 1, 2, 3, 4], "every turn lands in exactly one section");
  // An untouched block still renders — "nothing was recorded here" is a fact.
  assert.deepEqual(sections.find((s) => s.kind === "block" && s.block.id === "b3")!.turns, []);
});

test("a turn anchored to a block that is not in the agenda falls to the off-agenda run", () => {
  const sections = groupTranscriptByBlock([{ blockId: "ghost", offsetMs: 0 }], BLOCKS);
  // Every agenda block is empty here, so they render first (the agenda, then what was
  // actually said); the point is that the ghost-anchored turn is not lost with it.
  const off = sections.filter((s) => s.kind === "off");
  assert.equal(off.length, 1);
  assert.deepEqual(off[0].turns, [0]);
  assert.deepEqual(sections.flatMap((s) => s.turns), [0]);
});

test("with no agenda at all the whole transcript is one off-agenda run", () => {
  const sections = groupTranscriptByBlock([{ blockId: null, offsetMs: 0 }, { blockId: "b1", offsetMs: 1 }], []);
  assert.equal(sections.length, 1);
  assert.deepEqual(sections[0].turns, [0, 1]);
});

test("focus departures are paired, and an unmeasurable span is null rather than zero", () => {
  const events: EvidenceEvent[] = [
    { kind: "focus_lost", attempt: 1, seq: null, blockId: "b1", at: "", offsetMs: 10_000, during: "interviewer" },
    { kind: "focus_returned", attempt: 1, seq: null, blockId: "b1", at: "", offsetMs: 14_000, awayMs: 4_000 },
    { kind: "focus_lost", attempt: 1, seq: null, blockId: "b2", at: "", offsetMs: 20_000, during: "candidate" },
    // The browser could not measure the span (it records 0 for "departure not recorded").
    { kind: "focus_returned", attempt: 1, seq: null, blockId: "b2", at: "", offsetMs: 21_000, awayMs: 0 },
    // A departure the call never returned from.
    { kind: "focus_lost", attempt: 1, seq: null, blockId: "b2", at: "", offsetMs: 30_000, during: "idle" },
  ];
  const summary = summarizeFocus(events);
  assert.equal(summary.departures.length, 3);
  assert.deepEqual(summary.departures.map((d) => d.awayMs), [4_000, null, null]);
  assert.deepEqual(summary.departures.map((d) => d.blockId), ["b1", "b2", "b2"]);
  assert.equal(summary.totalAwayMs, 4_000);
  assert.equal(summary.unmeasured, 2);
});

test("no departures at all: nothing to total, and the total is null rather than 0", () => {
  const summary = summarizeFocus([]);
  assert.deepEqual(summary.departures, []);
  assert.equal(summary.totalAwayMs, null);
  assert.equal(summary.unmeasured, 0);
});

test("answer timing is summarized per block, by median, and counts its own samples", () => {
  const timing = (blockId: string | null, pre: number | null, dur: number | null): EvidenceEvent => ({
    kind: "answer_timing",
    attempt: 1,
    seq: null,
    blockId,
    at: "",
    offsetMs: 0,
    turnSeq: 1,
    preSilenceMs: pre,
    durationMs: dur,
  });
  const rows = summarizeAnswerTiming([
    timing("b1", 1_000, 20_000),
    timing("b1", 3_000, 30_000),
    timing("b1", 2_000, 90_000),
    // The provider exposed no boundary for this one: it still counts as an answer.
    timing("b2", null, null),
  ]);
  assert.deepEqual(rows.map((r) => r.blockId), ["b1", "b2"]);
  assert.equal(rows[0].answers, 3);
  assert.equal(rows[0].preSilenceMs, 2_000);
  assert.equal(rows[0].durationMs, 30_000, "median, so one 90-second story does not redraw the block");
  assert.equal(rows[0].durationSamples, 3);
  assert.equal(rows[1].answers, 1);
  assert.equal(rows[1].preSilenceMs, null);
  assert.equal(rows[1].preSilenceSamples, 0);
  assert.notEqual(rows[1].durationMs, 0);
});

test("the clock code is digits only", () => {
  assert.equal(clockLabel(0), "0:00");
  assert.equal(clockLabel(9_000), "0:09");
  assert.equal(clockLabel(754_000), "12:34");
  assert.equal(clockLabel(3_723_000), "1:02:03");
  assert.equal(clockLabel(null), null);
  assert.equal(clockLabel(-5), null);
});
