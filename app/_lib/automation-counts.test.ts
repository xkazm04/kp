import test from "node:test";
import assert from "node:assert/strict";
import { AUTOMATED_ACTION_KINDS, automationCounts, windowCutoffIso } from "./automation-counts.ts";

test("empty and nullish input is an honest zero", () => {
  assert.deepEqual(automationCounts({}), { total: 0, screens: 0, outreach: 0, invites: 0 });
  assert.deepEqual(automationCounts(null), { total: 0, screens: 0, outreach: 0, invites: 0 });
  assert.deepEqual(automationCounts(undefined), { total: 0, screens: 0, outreach: 0, invites: 0 });
});

test("total sums automated work kinds; breakdown picks screens, outreach, invites", () => {
  const c = automationCounts({ scored: 40, outreach_sent: 5, interview_invite_sent: 3, auto_advanced: 2, auto_rejected: 1 });
  assert.deepEqual(c, { total: 51, screens: 40, outreach: 5, invites: 3 });
});

test("human moves, holds and refusals are not automated actions", () => {
  const c = automationCounts({ advanced: 9, rejected: 4, screening_hold: 7, outreach_halted: 2, screen_wave_holdout: 3, applied: 11 });
  assert.equal(c.total, 0);
});

test("bad values contribute nothing", () => {
  const c = automationCounts({ scored: -3, outreach_sent: Number.NaN, interview_invite_sent: 2.9, matched: "4" as unknown as number });
  assert.deepEqual(c, { total: 2, screens: 0, outreach: 0, invites: 2 });
});

test("every listed kind counts exactly once", () => {
  const all = Object.fromEntries(AUTOMATED_ACTION_KINDS.map((k) => [k, 1]));
  assert.equal(automationCounts(all).total, AUTOMATED_ACTION_KINDS.length);
});

test("windowCutoffIso is exactly N days back", () => {
  const now = Date.UTC(2026, 9, 16, 12);
  assert.equal(windowCutoffIso(now, 7), "2026-10-09T12:00:00.000Z");
});
