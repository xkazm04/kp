// Pins the presentational projections of interview telemetry — the transcript
// modal and the compare grid both read these, so a drift here would show two
// different numbers for the same call.
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("formatSpokenDuration splits a span into whole minutes and seconds", () => {
  assert.deepEqual(formatSpokenDuration(45), { m: 0, s: 45 });
  assert.deepEqual(formatSpokenDuration(480), { m: 8, s: 0 });
  assert.deepEqual(formatSpokenDuration(750), { m: 12, s: 30 });
  assert.deepEqual(formatSpokenDuration(0), { m: 0, s: 0 });
  assert.deepEqual(formatSpokenDuration(59.6), { m: 1, s: 0 }); // rounds, then splits
});

test("formatSpokenDuration is null-safe and never negative", () => {
  assert.equal(formatSpokenDuration(null), null);
  assert.equal(formatSpokenDuration(-5), null);
  assert.equal(formatSpokenDuration(Number.NaN), null);
});

// The reason this returns parts at all. The module used to build "12m 30s" itself,
// and three telemetry strips rendered that English unit to cs/de/fr readers. The
// units now live in the 4 catalogs (t("duration", {m, s})), so the guard is that
// NO unit string can reappear here — a future "quick fix" that re-adds one would
// silently reintroduce the same bug in every locale at once.
test("the module states no unit: the catalogs own how a minute is spelled", () => {
  // CRLF-normalized first: this checkout is CRLF on Windows, the worktree may be LF.
  const src = readFileSync(new URL("./telemetry-format.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const code = src
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//"))
    .join("\n");
  // No template literal splices a value next to a letter (`${m}m`, `${s}s`).
  assert.equal(/\$\{[^}]*\}\s*[a-z]/i.test(code), false, "a unit letter is being appended in code");
  // …and no bare unit string literal survives either.
  for (const unit of ['"m"', "'m'", '"s"', "'s'", '"min"', '"sec"']) {
    assert.equal(code.includes(unit), false, `unit literal ${unit} is back in telemetry-format.ts`);
  }
});
