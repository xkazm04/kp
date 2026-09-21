// Pin the ROI ledger's second write door: manual_hours_per_hire is API-settable
// and feeds automationRoi's baseline, but had no field on the panel, so the
// "% of manual baseline" readout stayed pinned to the shipped 42-hour constant.
// Same grain as spend-write-path.test.ts — source-level, because the editor is
// JSX the node:test runner cannot render.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const HERE = path.join(process.cwd(), "app", "features", "insights", "analytics");
const read = (...p: string[]) => readFileSync(path.join(HERE, ...p), "utf8");

test("AnalyticsTypes exports the reserved manual-hours key the targets route already accepts", () => {
  assert.match(
    read("AnalyticsTypes.ts"),
    /export const MANUAL_HOURS_KEY = "manual_hours_per_hire"/,
    "the client key must match MANUAL_HOURS_TARGET_KEY in db/analytics.ts"
  );
});

test("the ROI ledger renders a TargetInput that posts manual_hours_per_hire", () => {
  const panel = read("AnalyticsAutomationPanel.tsx");
  assert.match(panel, /MANUAL_HOURS_KEY/, "RoiLedger must import the reserved key");
  assert.match(panel, /metric=\{MANUAL_HOURS_KEY\}/, "the second input must POST that metric");
  assert.match(
    panel,
    /value=\{roi\.manualBaselineHoursPerHire\}/,
    "the field must read the baseline the payload already carries"
  );
  assert.match(read("AnalyticsTargetInput.tsx"), /localizedSaveFailure/, "TargetInput (shared by both ROI fields) resolves ANALYTICS_POLICY_FORBIDDEN via useErrorMessage");
});
