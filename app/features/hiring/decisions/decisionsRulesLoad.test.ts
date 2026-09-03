// Pins the Rules modal's shape guard: defaults are never substituted for the
// workspace's live auto-reject rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readScreeningRule } from "./decisionsRulesLoad.ts";

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
