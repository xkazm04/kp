// Pins the Rules modal's shape guard: defaults are never substituted for the
// workspace's live auto-reject rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readScreeningRule, readScreeningRuleResponse } from "./decisionsRulesLoad.ts";

test("a full screening config reads through, extra fields intact", () => {
  const rule = readScreeningRule({
    configs: { screening: { autoRejectEnabled: true, rejectBottomPercent: 35, maxMatchToReject: 55, holdoutPercent: 0 } },
  });
  assert.equal(rule?.autoRejectEnabled, true);
  assert.equal(rule?.rejectBottomPercent, 35);
  assert.equal(rule?.maxMatchToReject, 55);
  assert.equal(rule?.holdoutPercent, 0);
});

test("an empty payload is a failed read, NOT the defaults", () => {
  assert.equal(readScreeningRule({}), null);
  assert.equal(readScreeningRule({ configs: {} }), null);
  assert.equal(readScreeningRule(null), null);
  assert.equal(readScreeningRule("nope"), null);
});

test("a screening object missing an edited field is refused", () => {
  assert.equal(readScreeningRule({ configs: { screening: { rejectBottomPercent: 10, maxMatchToReject: 20 } } }), null);
  assert.equal(readScreeningRule({ configs: { screening: { autoRejectEnabled: true, maxMatchToReject: 20 } } }), null);
  assert.equal(readScreeningRule({ configs: { screening: { autoRejectEnabled: true, rejectBottomPercent: 10 } } }), null);
});

test("a non-finite threshold is refused rather than clamped into a plausible rule", () => {
  assert.equal(
    readScreeningRule({ configs: { screening: { autoRejectEnabled: true, rejectBottomPercent: Number.NaN, maxMatchToReject: 20 } } }),
    null
  );
  assert.equal(
    readScreeningRule({ configs: { screening: { autoRejectEnabled: true, rejectBottomPercent: "20", maxMatchToReject: 20 } } }),
    null
  );
});

test("a rule with auto-reject OFF is a real rule, not an absent one", () => {
  const rule = readScreeningRule({ configs: { screening: { autoRejectEnabled: false, rejectBottomPercent: 0, maxMatchToReject: 0 } } });
  assert.deepEqual(rule, { autoRejectEnabled: false, rejectBottomPercent: 0, maxMatchToReject: 0 });
});

// ---- gated-doors-clients-read-the-refusal (wave 18b) --------------------------
// /api/decisions/config is capability-gated, so a failed read has a REASON now.
// The guard above answers "is there a live rule?"; this fold answers "why not?"
// with the machine half only — the modal owns the translator.

test("a refused config read comes back as a code, a capability and a status", () => {
  const read = readScreeningRuleResponse(403, {
    error: "Your role does not allow this action.",
    code: "FORBIDDEN_CAPABILITY",
    capability: "pipeline:write",
  });
  assert.equal(read.rule, null);
  assert.deepEqual(read.failure, { code: "FORBIDDEN_CAPABILITY", capability: "pipeline:write", status: 403 });
});

test("a read that never reached the server has no code to render", () => {
  assert.deepEqual(readScreeningRuleResponse(null, null).failure, { code: null, capability: null, status: null });
});

test("a 500 with no code still says which status refused it", () => {
  const read = readScreeningRuleResponse(500, { error: "boom" });
  assert.equal(read.failure?.code, null, "prose is never a code");
  assert.equal(read.failure?.status, 500);
});

test("a live rule reads through with no failure attached", () => {
  const read = readScreeningRuleResponse(200, {
    configs: { screening: { autoRejectEnabled: true, rejectBottomPercent: 20, maxMatchToReject: 40 } },
  });
  assert.equal(read.failure, null);
  assert.equal(read.rule?.rejectBottomPercent, 20);
});

// The modal is a .tsx with no component-test runner here, so its half of the
// contract — resolve the code, never paint the server's English — is pinned by
// reading the source (the technique PipelineFilterBar.test.ts uses).
test("the Rules modal resolves the refusal instead of defaulting silently", () => {
  const modal = readFileSync(new URL("./DecisionsRulesModal.tsx", import.meta.url), "utf8");
  assert.match(modal, /readScreeningRuleResponse\(r\.status, p\)/, "the body is read on a non-OK status too");
  assert.match(modal, /capabilityAwareReason\(errMsg, loadFailed, t\("loadFailed"\)\)/, "the read refusal says WHY");
  assert.match(modal, /setNote\(capabilityAwareReason\(errMsg, d, t\("saveFailed"\)\)\)/, "…and so does the refused save");
  assert.doesNotMatch(modal, /if \(!r\.ok\) throw new Error\(\)/, "a refusal is not an anonymous throw");
});
