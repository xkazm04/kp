// Pins the ONE client-safe wire contract of /api/decisions/screen-wave: the reason
// codes, the guarded result reader, and the refusal-reason reader the modal branches on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SCREEN_REASON_CODES,
  SCREEN_WAVE_REFUSAL_REASONS,
  isScreenReasonCode,
  isScreenWaveRefusalReason,
  readWaveRefusal,
  readWaveResult,
} from "./screen-wave-contract.ts";

const row = (over: Record<string, unknown> = {}) => ({
  entryId: "a",
  label: "A",
  archetype: null,
  matchScore: 40,
  action: "reject",
  rationale: "r",
  reasonCode: "reject",
  reasonParams: {},
  ...over,
});
const body = (over: Record<string, unknown> = {}) => ({
  decisions: [row()],
  rejected: 1,
  kept: 0,
  cohort: 1,
  commsFailures: 0,
  sealFailures: 0,
  dryRun: true,
  approvalToken: "1.x",
  ...over,
});

test("a well-formed wave body reads back typed, reason code intact", () => {
  const r = readWaveResult(body());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.result.decisions[0].reasonCode, "reject");
  assert.equal(r.result.approvalToken, "1.x");
  assert.equal(r.result.sealFailures, 0);
  assert.equal(r.result.dryRun, true);
});

test("a body missing decisions, or with a non-numeric sealFailures, is refused, never a clean zero", () => {
  const { decisions: _omit, ...noDecisions } = body();
  void _omit;
  assert.equal(readWaveResult(noDecisions).ok, false);
  assert.equal(readWaveResult(body({ sealFailures: "0" })).ok, false);
  assert.equal(readWaveResult(body({ sealFailures: undefined })).ok, false);
  assert.equal(readWaveResult(body({ decisions: [row({ action: "maybe" })] })).ok, false, "an unknown action is not a decision");
  assert.equal(readWaveResult(null).ok, false);
  assert.equal(readWaveResult({ error: "x", code: "SCREEN_WAVE_FAILED" }).ok, false, "an error body is not a result");
});

test("an unknown reason code survives as null, never cast into the union", () => {
  const r = readWaveResult(body({ decisions: [row({ action: "keep", reasonCode: "bogus", rationale: "kept because" })] }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.result.decisions[0].reasonCode, null);
  assert.equal(r.result.decisions[0].rationale, "kept because", "the English rationale is what renders instead");
  assert.equal(isScreenReasonCode("bogus"), false);
  assert.equal(isScreenReasonCode("holdout"), true);
});

test("the refusal reason is read from a 409 body, defaulting to mismatch", () => {
  assert.equal(readWaveRefusal(409, { code: "SCREEN_WAVE_APPROVAL_UNATTRIBUTED", reason: "unattributed" }), "unattributed");
  assert.equal(readWaveRefusal(409, { reason: "spent" }), "spent");
  assert.equal(readWaveRefusal(409, {}), "mismatch");
  assert.equal(readWaveRefusal(409, { reason: "nope" }), "mismatch");
  assert.equal(readWaveRefusal(409, null), "mismatch");
  assert.equal(readWaveRefusal(400, { reason: "unattributed" }), null, "only a 409 is an approval refusal");
  assert.equal(readWaveRefusal(200, {}), null);
  for (const r of SCREEN_WAVE_REFUSAL_REASONS) assert.equal(isScreenWaveRefusalReason(r), true);
});

test("every reason code has its catalog line, and the contract module imports nothing", () => {
  const en = JSON.parse(readFileSync(new URL("../../messages/en.json", import.meta.url), "utf8")) as {
    decisions: { wave: { reasons: Record<string, string> } };
  };
  const reasons = en.decisions.wave.reasons;
  for (const code of SCREEN_REASON_CODES) {
    if (code === "reject") {
      assert.ok(reasons.rejectWould && reasons.rejectDid, "reject renders as rejectWould / rejectDid");
    } else {
      assert.ok(reasons[code], `decisions.wave.reasons.${code} missing from en.json`);
    }
  }
  const src = readFileSync(new URL("./screen-wave-contract.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /^\s*import\s/m, "client-safe by construction: no import statement");
  assert.doesNotMatch(src, /\brequire\(/, "and no require either");
});
