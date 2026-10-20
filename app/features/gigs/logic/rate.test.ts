// Pure logic for the rate (rate.ts): a fraction first, a percentage only beside its n, and
// the qualification bar restated from qualify.ts.
// Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cell } from "./fixtures.ts";
import { overallCell, rateView } from "./rate.ts";

test("rateView: unmeasured is never 0%; the percent rides only beside its n", () => {
  assert.deepEqual(rateView(cell({ pending: 2 })), { measured: false, accepted: 0, resolved: 0, pending: 2, percent: null, small: true });
  const r = rateView(cell({ resolved: 3, accepted: 1, rate: 1 / 3, pending: 1 }));
  assert.equal(r.percent, 33);
  assert.equal(r.measured, true);
  assert.equal(rateView(null).measured, false);
});

test("overallCell sums the arena partition and re-derives the rate and the small-sample flag", () => {
  const kpi = {
    byArena: {
      security: cell({ resolved: 4, accepted: 1, rate: 0.25, pending: 1, costUnreported: 2 }),
      freelance: cell({ resolved: 6, accepted: 3, rate: 0.5, pending: 0 }),
      competition: cell({}),
      oss_bounty: cell({ pending: 2 }),
    },
  };
  const o = overallCell(kpi);
  assert.equal(o.resolved, 10);
  assert.equal(o.accepted, 4);
  assert.equal(o.pending, 3);
  assert.equal(o.rate, 0.4);
  assert.equal(o.smallSample, false);
  assert.equal(o.costUnreported, 2);
  assert.equal(overallCell({ byArena: { security: cell({}), freelance: cell({}), competition: cell({}), oss_bounty: cell({}) } }).rate, null);
});

test("QUALIFY_BAR restates qualify.ts's threshold exactly", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const src = readFileSync(fileURLToPath(new URL("../../../_lib/gigs/qualify.ts", import.meta.url)), "utf8");
  const m = /export const QUALIFY_THRESHOLD = (\d+);/.exec(src);
  assert.ok(m, "qualify.ts still declares QUALIFY_THRESHOLD");
  const { QUALIFY_BAR } = await import("./rate.ts");
  assert.equal(QUALIFY_BAR, Number(m[1]));
});
