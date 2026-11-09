// The recruiter surfaces that START a voice interview are drawn only when the readiness
// report says `enabled` (voice/enabled.ts voiceSurfaceVisible): false and not-yet-known
// hide them, true leaves them as they were. The components have no render harness here, so
// the condition is pinned as pure logic and each surface is pinned to ask it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { voiceSurfaceVisible } from "./enabled.ts";

test("a voice-start surface is visible only when enabled is exactly true", () => {
  assert.equal(voiceSurfaceVisible(true), true);
  assert.equal(voiceSurfaceVisible(false), false);
  assert.equal(voiceSurfaceVisible(null), false);
  assert.equal(voiceSurfaceVisible(undefined), false);
});

const SURFACES: Record<string, string> = {
  "pipeline voice-screen panel (footer button)": "app/features/hiring/pipeline/candidate/footer/CandidateFooter.tsx",
  "schedule AI-round docket": "app/features/hiring/schedule/ScheduleTab.tsx",
  "spend voice strip": "app/features/settings/billing/spend/SpendVoiceFacts.tsx",
  "interview-kit rehearse": "app/features/library/jobs/JobsKitEditor.tsx",
};

for (const [name, file] of Object.entries(SURFACES)) {
  test(`${name} asks voiceSurfaceVisible`, () => {
    assert.match(readFileSync(file, "utf8"), /voiceSurfaceVisible\(/, file);
  });
}

test("the schedule's record of completed AI interviews is drawn with the flag off", () => {
  const tab = readFileSync("app/features/hiring/schedule/ScheduleTab.tsx", "utf8");
  assert.match(tab, /voiceEnabled=\{false\}/);
  const round = readFileSync("app/features/hiring/schedule/ScheduleAiRound.tsx", "utf8");
  assert.match(round, /<ScheduleAiRoundCompleted /);
  assert.match(round, /voiceEnabled \? \(\s*<ScheduleAiLedger/);
});
