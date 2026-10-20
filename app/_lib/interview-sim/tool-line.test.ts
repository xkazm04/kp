// The text stand-in's tool channel and the simulated clock's arithmetic
// (spark interview-uat-tranche, WP-1) — pure, no database.
import { test } from "node:test";
import assert from "node:assert/strict";

import { SIM_TOOL_LINE } from "./types.ts";
import { parseCandidateReply, parseInterviewerReply, toolLinesOf, toolResultLine } from "./tool-line.ts";
import { MAX_PAUSE_MS, SPEAKING_WPM, spokenMs, spokenPrefix, wordCount } from "./clock.ts";

const call = (name: string, args: Record<string, unknown>) => `<<tool ${JSON.stringify({ name, args })}>>`;

test("every line the contract's SIM_TOOL_LINE matches is parsed as the same call", () => {
  const reply = [
    call("mark_topic_covered", { block_id: "b1", evidence_quote: "I owned the ledger service end to end" }),
    call("begin_topic", { block_id: "b2" }),
    "Thank you. Tell me about a disagreement with a colleague.",
  ].join("\n");
  const byContract = [...reply.matchAll(new RegExp(SIM_TOOL_LINE.source, SIM_TOOL_LINE.flags))].map((m) => JSON.parse(m[1]) as { name: string; args: unknown });
  const parsed = parseInterviewerReply(reply);
  assert.equal(parsed.calls.length, byContract.length);
  parsed.calls.forEach((c, i) => {
    assert.equal(c.ok, true);
    assert.equal(c.name, byContract[i].name);
    assert.deepEqual(c.args, byContract[i].args);
  });
  assert.equal(parsed.spoken, "Thank you. Tell me about a disagreement with a colleague.");
});

test("a call written inline, two on one line, or with braces inside a string is still a call — and never spoken", () => {
  const reply = `Thanks for that. ${call("mark_topic_covered", { block_id: "b1", evidence_quote: "we used {braces} and >> arrows" })} ${call("begin_topic", { block_id: "b2" })} Next question?`;
  const parsed = parseInterviewerReply(reply);
  assert.deepEqual(parsed.calls.map((c) => c.name), ["mark_topic_covered", "begin_topic"]);
  assert.equal((parsed.calls[0].args as { evidence_quote: string }).evidence_quote, "we used {braces} and >> arrows");
  assert.equal(parsed.spoken, "Thanks for that. Next question?");
  assert.doesNotMatch(parsed.spoken, /<<tool|block_id/);
});

test("a malformed call is stripped, marked not-ok, and keeps its raw text for the record", () => {
  for (const bad of ["<<tool begin_topic b2>>", '<<tool {"name":"begin_topic","args":{"block_id":"b2"}>>', "<<tool {not json}>>", '<<tool {"args":{}}>>']) {
    const parsed = parseInterviewerReply(`${bad}\nLet's move on.`);
    assert.equal(parsed.calls.length, 1, bad);
    assert.equal(parsed.calls[0].ok, false, bad);
    assert.equal(parsed.spoken, "Let's move on.", bad);
    assert.ok(parsed.calls[0].raw.startsWith("<<tool"), bad);
  }
});

test("harness artifacts are cut from the spoken text, each with a note", () => {
  const parsed = parseInterviewerReply(
    ["Interviewer: Could you walk me through it?", "<<result begin_topic>> Recorded. Continue with block b1.", "Candidate: Sure, so I built…"].join("\n"),
  );
  assert.equal(parsed.spoken, "Could you walk me through it?");
  assert.equal(parsed.notes.length, 2, "one note for the invented result, one for the line written for the candidate");
});

test("toolLinesOf keeps only the calls; toolResultLine carries the director's exact string", () => {
  const parsed = parseInterviewerReply(`${call("begin_topic", { block_id: "b3" })}\nSo, an incident.`);
  assert.equal(toolLinesOf(parsed), call("begin_topic", { block_id: "b3" }));
  assert.equal(toolResultLine("begin_topic", "Recorded. Continue with block b3."), "<<result begin_topic>> Recorded. Continue with block b3.");
});

test("a candidate's pause advances time without words; tokens never reach the spoken text", () => {
  assert.deepEqual(parseCandidateReply("<<pause 12>> Well, I think it was Go."), { spoken: "Well, I think it was Go.", pauseMs: 12_000, notes: [] });
  const silent = parseCandidateReply("<<pause 30>>");
  assert.equal(silent.spoken, "");
  assert.equal(silent.pauseMs, 30_000);
  assert.equal(parseCandidateReply("<<pause 99999>>").pauseMs, MAX_PAUSE_MS, "a runaway pause is capped");
  // The paraphrased forms a live model wrote (first live smoke: `<pause 8> Sure, …`).
  for (const variant of ["<pause 8> Sure.", "[pause 8s] Sure.", "(pause 8 seconds) Sure.", "<< pause 8 >> Sure."]) {
    assert.deepEqual(parseCandidateReply(variant), { spoken: "Sure.", pauseMs: 8_000, notes: [] }, variant);
  }
  assert.equal(parseCandidateReply("Candidate: Yes. <<wink>>").spoken, "Yes.");
  const overstep = parseCandidateReply("I did.\nInterviewer: Great, next question.");
  assert.equal(overstep.spoken, "I did.");
  assert.equal(overstep.notes.length, 1);
});

test("the clock times speech at SPEAKING_WPM and cuts a sentence by share", () => {
  const words150 = Array.from({ length: SPEAKING_WPM }, () => "word").join(" ");
  assert.equal(spokenMs(words150), 60_000, "one minute of words takes one minute");
  assert.equal(spokenMs(""), 0);
  assert.equal(wordCount("  two   words "), 2);
  assert.equal(spokenPrefix("one two three four", 0.5), "one two");
  assert.equal(spokenPrefix("one two three four", 0), "");
});
