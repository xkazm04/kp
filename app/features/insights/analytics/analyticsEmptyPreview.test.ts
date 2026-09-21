// The first-run empty state must promise the Quality/trust instrument, not only
// the three economics tiles. A keyless install gets the same Quality surface
// (calibration + sealed records); training the operator that Analytics is a
// funnel dashboard is the defect this pins.
//
// Runner: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("./AnalyticsEmptyPreview.tsx", import.meta.url)), "utf8");

test("the empty preview catalog includes a Quality/trust tile", () => {
  assert.match(src, /labelKey: "metricTrust"/);
  assert.match(src, /meaningKey: "metricTrustBody"/);
  assert.match(src, /sec:\s*"quality"/);
});
