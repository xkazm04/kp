// Calibrated reliability bins as a file: empty bins omitted, provenance names
// the source and outcome that produced the curve.
//
// Runner: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { reliabilityCsvProvenance, reliabilityCsvRows } from "./reliabilityCsv.ts";
import type { CalibrationBin } from "@/app/_lib/calibration";

const LABELS = { bin: "Bin", lo: "Lo", hi: "Hi", n: "n", predicted: "Predicted", observed: "Observed" };
const PROV = {
  export: "Export",
  generated: "Generated",
  source: "Source",
  outcome: "Outcome",
  threshold: "Floor",
  enforced: "Floor enforced",
};

const bin = (over: Partial<CalibrationBin>): CalibrationBin => ({
  lo: 0,
  hi: 0.1,
  count: 0,
  predicted: 0,
  observed: 0,
  ...over,
});

test("empty bins are omitted from the file", () => {
  const rows = reliabilityCsvRows(
    {
      bins: [
        bin({ lo: 0, hi: 0.1, count: 0 }),
        bin({ lo: 0.4, hi: 0.5, count: 8, predicted: 0.44, observed: 0.5 }),
        bin({ lo: 0.9, hi: 1, count: 0 }),
      ],
    },
    LABELS
  );
  assert.equal(rows.length, 2, "header + one filled bin");
  assert.deepEqual(rows[1], [1, 0.4, 0.5, 8, 0.44, 0.5]);
});

test("the calibrated diagram offers the CSV", () => {
  const diagram = readFileSync(fileURLToPath(new URL("./AnalyticsReliabilityDiagram.tsx", import.meta.url)), "utf8");
  const panel = readFileSync(fileURLToPath(new URL("./AnalyticsCalibrationPanel.tsx", import.meta.url)), "utf8");
  assert.match(diagram, /AnalyticsExportButton/);
  assert.match(diagram, /kp-reliability\.csv/);
  assert.match(panel, /source=\{source\}/);
  assert.match(panel, /outcome=\{axis\}/);
});

test("provenance includes source and outcome", () => {
  const provenance = reliabilityCsvProvenance(
    "kp-reliability.csv",
    {
      source: "pipeline",
      outcome: "advance",
      threshold: 45,
      autoRejectEnabled: false,
      generatedAt: "2026-09-17T12:00:00.000Z",
    },
    PROV
  );
  const rows = reliabilityCsvRows(
    { bins: [bin({ lo: 0.4, hi: 0.5, count: 3, predicted: 0.42, observed: 0.33 })] },
    LABELS,
    { provenance }
  );
  const blob = rows.map((r) => r.join(",")).join("\n");
  assert.match(blob, /pipeline/);
  assert.match(blob, /advance/);
  assert.match(blob, /kp-reliability\.csv/);
  assert.equal(rows[0][0], "Export");
});
