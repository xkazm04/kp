// P1-2: the screen-wave human-approval token (EU AI Act / GDPR Art. 22 gate).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { screenWaveApprovalToken, ScreenWaveApprovalError } from "./screen-wave-approval.ts";

const POLICY = "screen-wave/bottom20/maxMatch50";

test("token is stable and order-independent for the same reject set", () => {
  const a = screenWaveApprovalToken("job1", POLICY, ["e3", "e1", "e2"]);
  const b = screenWaveApprovalToken("job1", POLICY, ["e1", "e2", "e3"]);
  assert.equal(a, b);
});

test("token changes when the reject set changes (added / removed candidate)", () => {
  const base = screenWaveApprovalToken("job1", POLICY, ["e1", "e2"]);
  assert.notEqual(base, screenWaveApprovalToken("job1", POLICY, ["e1", "e2", "e3"]));
  assert.notEqual(base, screenWaveApprovalToken("job1", POLICY, ["e1"]));
});

test("token changes when the policy or the job changes", () => {
  const base = screenWaveApprovalToken("job1", POLICY, ["e1"]);
  assert.notEqual(base, screenWaveApprovalToken("job1", "screen-wave/bottom30/maxMatch50", ["e1"]));
  assert.notEqual(base, screenWaveApprovalToken("job2", POLICY, ["e1"]));
});

test("an empty reject set still yields a stable token (an empty wave is approvable)", () => {
  const a = screenWaveApprovalToken("job1", POLICY, []);
  const b = screenWaveApprovalToken("job1", POLICY, []);
  assert.equal(a, b);
  assert.equal(typeof a, "string");
  assert.ok(a.length > 0);
});

test("whitespace / blank ids are normalized so the signature is robust", () => {
  const a = screenWaveApprovalToken("job1", POLICY, ["e1", "e2"]);
  const b = screenWaveApprovalToken("job1", POLICY, [" e1 ", "", "e2"]);
  assert.equal(a, b);
});

test("ScreenWaveApprovalError carries its name (for the 409 mapping)", () => {
  const err = new ScreenWaveApprovalError("nope");
  assert.equal(err.name, "ScreenWaveApprovalError");
  assert.ok(err instanceof Error);
});
