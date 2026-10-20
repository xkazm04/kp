import { test } from "node:test";
import assert from "node:assert/strict";
import { metricPackPreview } from "./metricPackPreviewModel.ts";
import type { Metric, MetricNeed, MetricPack } from "@/app/_lib/metric-pack";

const NOW = Date.parse("2026-09-23T00:00:00.000Z");
const DAY = 86_400_000;

const need = (over: Partial<MetricNeed> = {}): MetricNeed => ({
  more: 3,
  floor: 8,
  unit: "hires",
  etaWeeks: 2,
  etaDate: NOW + 14 * DAY,
  reason: null,
  note: "Needs 3 more hires.",
  ...over,
});

const row = (key: string, status: Metric["status"], n: MetricNeed | null = null): Metric => ({
  key,
  value: status === "not_measurable" ? null : 1,
  unit: "days",
  status,
  sample: 1,
  basis: `${key} basis`,
  need: n,
});

const pack = (metrics: Metric[]): MetricPack => ({
  metrics,
  certifiable: metrics.every((m) => m.status === "measured"),
  caveats: [],
  windowDays: null,
  generatedAt: new Date(NOW).toISOString(),
});

test("blockers sort before measured rows, each group in pack order", () => {
  const v = metricPackPreview(
    pack([
      row("time_to_hire", "measured"),
      row("cost_per_hire", "thin", need()),
      row("recruiter_hours_saved", "measured"),
      row("recruiter_capacity", "not_measurable", need({ unit: "roles", etaWeeks: null, etaDate: null, reason: "not-accruing" })),
    ])
  );
  assert.deepEqual(
    v.rows.map((r) => [r.key, r.blocker]),
    [
      ["cost_per_hire", true],
      ["recruiter_capacity", true],
      ["time_to_hire", false],
      ["recruiter_hours_saved", false],
    ]
  );
  assert.deepEqual(v.summary, { publishable: 2, total: 4 });
});

test("earliestClear is the LATEST blocker date — the pack clears when its last row does", () => {
  const v = metricPackPreview(
    pack([
      row("time_to_hire", "thin", need({ etaDate: NOW + 14 * DAY })),
      row("cost_per_hire", "thin", need({ etaDate: NOW + 35 * DAY })),
      row("recruiter_capacity", "measured"),
    ])
  );
  assert.equal(v.earliestClear, NOW + 35 * DAY);
});

test("one undated blocker makes the whole pack undated", () => {
  const noPace = metricPackPreview(
    pack([row("time_to_hire", "thin", need()), row("candidate_nps", "thin", need({ etaWeeks: null, etaDate: null, reason: "no-pace" }))])
  );
  assert.equal(noPace.earliestClear, null);
  // A blocker with no need at all (not measurable for want of something other than
  // samples, e.g. no spend entered) has no date either.
  const noNeed = metricPackPreview(pack([row("time_to_hire", "thin", need()), row("cost_per_hire", "not_measurable", null)]));
  assert.equal(noNeed.earliestClear, null);
});

test("a certifiable pack has no blockers and no clearing date to promise", () => {
  const v = metricPackPreview(pack([row("time_to_hire", "measured"), row("cost_per_hire", "measured")]));
  assert.equal(v.earliestClear, null);
  assert.deepEqual(v.summary, { publishable: 2, total: 2 });
  assert.equal(v.rows.every((r) => !r.blocker), true);
  assert.equal(v.windowTooNarrow, false);
});

test("a window-too-narrow blocker raises the window hint", () => {
  const v = metricPackPreview(
    pack([row("time_to_hire", "thin", need({ etaWeeks: null, etaDate: null, reason: "window-too-narrow" })), row("cost_per_hire", "measured")])
  );
  assert.equal(v.windowTooNarrow, true);
  assert.equal(v.earliestClear, null);
});

test("a pre-need pack (row without the field) reads as undated, not as a crash", () => {
  const legacy = { ...row("time_to_hire", "thin"), need: undefined };
  const v = metricPackPreview(pack([legacy]));
  assert.equal(v.rows[0].blocker, true);
  assert.equal(v.earliestClear, null);
});
