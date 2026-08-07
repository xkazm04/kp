// Pins the presentational projections of interview telemetry — the transcript
// modal and the compare grid both read these, so a drift here would show two
// different numbers for the same call.
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { talkSharePercent, formatSpokenDuration } from "./telemetry-format.ts";
import type { InterviewTelemetry } from "../interview-telemetry.ts";

function tel(partial: Partial<InterviewTelemetry>): InterviewTelemetry {
  return {
    version: 1,
    turns: 0,
    candidateTurns: 0,
    interviewerTurns: 0,
    candidateWords: 0,
    interviewerWords: 0,
    talkRatio: null,
    durationSec: null,
    longestResponseGapSec: null,
    hint: { offered: false, turnIndex: null, uptake: "not_offered", responseSec: null },
    ...partial,
  };
}

test("talkSharePercent rounds the 0..1 ratio to a whole percent", () => {
  assert.equal(talkSharePercent(tel({ talkRatio: 0.62 })), 62);
  assert.equal(talkSharePercent(tel({ talkRatio: 0.005 })), 1);
  assert.equal(talkSharePercent(tel({ talkRatio: 1 })), 100);
});

test("talkSharePercent stays null when nobody spoke — never fabricated", () => {
  assert.equal(talkSharePercent(tel({ talkRatio: null })), null);
});

test("formatSpokenDuration renders compact m/s labels", () => {
  assert.equal(formatSpokenDuration(45), "45s");
  assert.equal(formatSpokenDuration(480), "8m");
  assert.equal(formatSpokenDuration(750), "12m 30s");
  assert.equal(formatSpokenDuration(0), "0s");
});

test("formatSpokenDuration is null-safe and never negative", () => {
  assert.equal(formatSpokenDuration(null), null);
  assert.equal(formatSpokenDuration(-5), null);
  assert.equal(formatSpokenDuration(Number.NaN), null);
});
