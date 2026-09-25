import { test } from "node:test";
import assert from "node:assert/strict";
import type { JobseekerPostingSummary } from "@/app/_lib/jobseeker/types";
import { MAX_LAYER_ROWS, sieveGeometry } from "./sieveGeometry";
import { deriveSieve } from "./sieveModel";

// A layer's dots must stay inside its own band at any count and any width: with fixed
// 116px bands, 600 held postings at 900px climbed 266px into the layer above and off
// the top of the stage, and at 320px the break came at ~54 postings (scan-sweep
// 2026-09-25, mobile-specialist).

function row(id: string, over: Partial<JobseekerPostingSummary>): JobseekerPostingSummary {
  return {
    id, sourceId: "on", externalKey: id, url: "https://example.invalid/" + id, title: id, company: null, location: null, country: null,
    workMode: null, postedAt: null, salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null, jobSource: null,
    matchTotal: null, fitTier: null, matchVersion: null, matchedAt: null, status: "new", dismissReason: null, dismissNote: null,
    appliedAt: null, firstSeenAt: "2026-09-20T00:00:00Z", lastSeenAt: "2026-09-24T00:00:00Z", goneAt: null, bodyChars: 1,
    eligibility: [], confidence: null, blockedBy: [], blockedDetails: [], asIfTotal: null, matchedSkills: [], missingSkills: [], deepDived: false, previousTotal: null, reasoningStale: false, targetAlignment: null,
    ...over,
  };
}

function facts(held: number, gated: number, scored: number) {
  const rows = [
    ...Array.from({ length: held }, (_, i) => row(`h${i}`, { sourceId: "off" })),
    ...Array.from({ length: gated }, (_, i) => row(`g${i}`, { blockedBy: ["work_mode"], asIfTotal: 40 })),
    ...Array.from({ length: scored }, (_, i) => row(`s${i}`, { matchTotal: 30 + (i % 50), fitTier: "partial" })),
  ];
  return deriveSieve(rows, [
    { id: "on", enabled: true, pausedReason: null },
    { id: "off", enabled: false, pausedReason: null },
  ]);
}

for (const W of [320, 900]) {
  test(`every layer's dots stay inside its own band at ${W}px, even at 600 held postings`, () => {
    const model = sieveGeometry(facts(600, 120, 80), W);
    let prevLine = 0;
    for (const layer of model.layers) {
      const ys = model.dots.filter((d) => d.layer === layer.key).map((d) => d.y);
      assert.ok(ys.length > 0, layer.key);
      assert.ok(Math.min(...ys) > prevLine, `${layer.key}: top dot ${Math.min(...ys)} climbs above the layer before (${prevLine})`);
      assert.ok(Math.max(...ys) < layer.y, `${layer.key}: a dot sits below its own line`);
      prevLine = layer.y;
    }
    for (const d of model.dots.filter((x) => x.layer === "field")) assert.ok(d.y > model.fieldTop && d.y < model.base, "field dots inside the field");
  });
}

test("past MAX_LAYER_ROWS a layer draws a +N tail instead of more rows", () => {
  const model = sieveGeometry(facts(600, 0, 0), 320);
  const door = model.layers.find((l) => l.key === "door")!;
  const drawn = model.dots.filter((d) => d.layer === "door").length;
  assert.ok(door.overflow > 0);
  assert.equal(drawn + door.overflow, 600, "every held posting is either drawn or counted in the tail");
  const rows = new Set(model.dots.filter((d) => d.layer === "door").map((d) => Math.round(d.y)));
  assert.ok(rows.size <= MAX_LAYER_ROWS);
});

test("a small sieve keeps the winner's 116px rhythm", () => {
  const model = sieveGeometry(facts(3, 3, 10), 900);
  assert.equal(model.layers[1]!.y - model.layers[0]!.y, 116);
  assert.equal(model.layers[0]!.overflow, 0);
});
