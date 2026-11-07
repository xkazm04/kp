import { test } from "node:test";
import assert from "node:assert/strict";
import { CHIP_IDS, MAX_CHIPS } from "../../types.ts";
import { greeting } from "../../engine/greeting.ts";
import { BAND_CHIPS, COLUMN_CHIPS, answeringPanel, frontPage } from "./bands.ts";

const zero = { decisions: 0, pipeline: 0, schedule: 0, jobs: 0, channels: 0, companion: 0 };

test("a failed read draws no bands — unknown is not 'nothing new'", () => {
  assert.deepEqual(frontPage(null), { state: "unknown" });
});

test("all clear: no lead, no bands, every bucket in the quiet line", () => {
  const p = frontPage({ ...zero, companion: 3 });
  assert.equal(p.state, "read");
  if (p.state !== "read") return;
  assert.equal(p.lead, null);
  assert.deepEqual(p.bands, []);
  assert.deepEqual(p.quiet, ["decisions", "pipeline", "channels", "schedule", "jobs"]);
});

test("the lead is the greeting's first need, and it is not drawn again as a band", () => {
  const a = { ...zero, pipeline: 4, schedule: 2, jobs: 1 };
  const p = frontPage(a);
  const g = greeting(a);
  assert.equal(p.state, "read");
  assert.equal(g.state, "needs");
  if (p.state !== "read" || g.state !== "needs") return;
  assert.equal(p.lead, g.first.key);
  assert.deepEqual(p.bands.map((b) => b.key), ["schedule", "jobs"]);
  assert.deepEqual(p.bands.map((b) => b.count), [2, 1]);
  assert.deepEqual(p.quiet, ["decisions", "channels"]);
});

test("every band offers 2-3 known chips, its own question first", () => {
  for (const [key, chips] of Object.entries(BAND_CHIPS)) {
    assert.ok(chips.length >= 2 && chips.length <= 3, key);
    assert.ok(chips.length <= MAX_CHIPS);
    for (const c of chips) assert.ok((CHIP_IDS as readonly string[]).includes(c), `${key}:${c}`);
    assert.equal(new Set(chips).size, chips.length, key);
  }
  for (const c of COLUMN_CHIPS) assert.ok((CHIP_IDS as readonly string[]).includes(c));
});

test("a band points at the view that answers it, filter included", () => {
  const aging = { id: "p1", kind: "pipelineSlice" as const, params: { filter: "aging", role: "Data" }, pinned: false };
  const whole = { id: "p2", kind: "pipelineSlice" as const, params: {}, pinned: false };
  const queue = { id: "p3", kind: "decisionsQueue" as const, params: {}, pinned: true };
  assert.equal(answeringPanel("pipeline", [whole, aging])?.id, "p1");
  assert.equal(answeringPanel("channels", [whole, aging]), null);
  assert.equal(answeringPanel("decisions", [queue])?.id, "p3");
  assert.equal(answeringPanel("schedule", [queue]), null);
});
