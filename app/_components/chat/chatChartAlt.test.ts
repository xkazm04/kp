import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChatBlockLabels, ChatChartBlock } from "./chatBlockTypes.ts";
import { chartAlt, chartAltValues } from "./chatChartAlt.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const LABELS: ChatBlockLabels = { table: "Table", chart: "Chart", emptyCell: "·" };

const TWO_BY_THREE: ChatChartBlock = {
  type: "chart",
  title: "funnel",
  kind: "bar",
  x: { label: "Stage", values: ["Screen", "Interview", "Offer"] },
  y: { label: "Candidates" },
  series: [
    { label: "Active", values: [12, 5, 2] },
    { label: "Held", values: [8, 3, 1] },
  ],
};

test("a chart block with 2x3 values yields six readable cells", () => {
  const values = chartAltValues(TWO_BY_THREE, LABELS);
  assert.deepEqual(values, ["12", "8", "5", "3", "2", "1"]);
  const alt = chartAlt(TWO_BY_THREE, LABELS);
  assert.equal(alt.caption, "funnel");
  assert.deepEqual(alt.columns, ["Stage", "Active", "Held"]);
  assert.equal(values.length, 6);
  assert.ok(values.includes("12") && values.includes("8") && values.includes("1"));
});

test("an untitled chart uses the labels.chart fallback as the caption", () => {
  assert.equal(chartAlt({ ...TWO_BY_THREE, title: undefined }, LABELS).caption, LABELS.chart);
});

test("ChatMiniChart wires the alt table to the SVG live name", () => {
  const src = readFileSync(path.join(HERE, "ChatMiniChart.tsx"), "utf8");
  assert.match(src, /aria-describedby=\{altId\}/);
  assert.match(src, /className="sr-only"/);
  assert.match(src, /<caption id=\{altId\}>/);
  assert.match(src, /role="img"/);
});
