import { test } from "node:test";
import assert from "node:assert/strict";
import { greeting } from "./greeting.ts";

const zero = { decisions: 0, pipeline: 0, schedule: 0, jobs: 0, channels: 0, companion: 0 };

test("a failed read is 'unknown', never 'all clear'", () => {
  assert.equal(greeting(null).state, "unknown");
});

test("nothing waiting → clear (an open companion proposal is not a /one need)", () => {
  assert.equal(greeting({ ...zero, companion: 4 }).state, "clear");
});

test("priority: decisions > pipeline > channels > schedule > jobs", () => {
  const order: [Partial<typeof zero>, string][] = [
    [{ jobs: 1, schedule: 1, channels: 1, pipeline: 1, decisions: 1 }, "decisions"],
    [{ jobs: 1, schedule: 1, channels: 1, pipeline: 1 }, "pipeline"],
    [{ jobs: 1, schedule: 1, channels: 1 }, "channels"],
    [{ jobs: 1, schedule: 1 }, "schedule"],
    [{ jobs: 5 }, "jobs"],
  ];
  for (const [counts, key] of order) {
    const g = greeting({ ...zero, ...counts });
    assert.equal(g.state, "needs");
    if (g.state === "needs") assert.equal(g.first.key, key);
  }
});

test("the first need names its view and count; ≤ 4 chips led by its own", () => {
  const g = greeting({ ...zero, pipeline: 3, jobs: 2, schedule: 1, channels: 4, decisions: 0 });
  assert.equal(g.state, "needs");
  if (g.state !== "needs") return;
  assert.deepEqual(g.first, { key: "pipeline", count: 3, panel: "pipelineSlice", params: { filter: "aging" } });
  assert.equal(g.areas, 4);
  assert.equal(g.chips[0], "stalled");
  assert.ok(g.chips.length <= 4);
});
