// compute-cost-per-hire — the read-only windowed aggregation over the LLM usage
// ledger (llm_usage). Pins: (1) the sum is over PRICED rows only, with unpriced
// (NULL-cost) rows counted separately, not summed as $0; (2) the `ts` window scopes
// the aggregate (a row outside the window drops out); (3) an `endMs` upper bound
// excludes rows after it. Deltas against a pre-insert baseline so any seeded ledger
// rows don't skew the assertions.
//
// Isolated throwaway DB (testing/unit-db.ts must stay the first project import).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { computeCostWindow } from "./analytics.ts";
import { insertLlmUsage } from "./llm.ts";
import { ensureDb } from "./core.ts";

after(() => cleanupUnitDb());

const DAY = 86_400_000;
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

test("computeCostWindow sums priced ledger rows, flags unpriced, and honors the ts window", () => {
  const baseAll = computeCostWindow();
  const base30 = computeCostWindow(30);
  // A window ending 40 days ago is [now-70d, now-40d) — none of the rows this test
  // inserts (3 at 'now', 1 at 90d ago) fall inside it.
  const basePrior = computeCostWindow(30, Date.now() - 40 * DAY);

  // Two priced calls + one unpriced (NULL cost) — all stamped at 'now' (in window).
  insertLlmUsage({ useCase: "campaign_pack", provider: "claude_cli", costUsd: 0.01, source: "llm" });
  insertLlmUsage({ useCase: "campaign_pack", provider: "claude_cli", costUsd: 0.02, source: "llm" });
  insertLlmUsage({ useCase: "campaign_pack", provider: "azure", costUsd: null, source: "llm" });

  // A pricey call OUTSIDE a 30-day window (backdate the just-inserted row to 90d ago).
  insertLlmUsage({ useCase: "analyze", provider: "claude_cli", costUsd: 5, source: "llm" });
  ensureDb()
    .prepare(`UPDATE llm_usage SET ts = ? WHERE id = (SELECT MAX(id) FROM llm_usage)`)
    .run(new Date(Date.now() - 90 * DAY).toISOString());

  const allAfter = computeCostWindow();
  assert.equal(allAfter.calls, baseAll.calls + 4, "all-time counts every inserted row");
  assert.ok(near(allAfter.costUsd, baseAll.costUsd + 5.03), "all-time sums priced cost incl. the old row");
  assert.equal(allAfter.unpricedCalls, baseAll.unpricedCalls + 1, "the NULL-cost row counts as unpriced, not $0");

  const win30After = computeCostWindow(30);
  assert.equal(win30After.calls, base30.calls + 3, "the 90-day-old row is excluded from a 30-day window");
  assert.ok(near(win30After.costUsd, base30.costUsd + 0.03), "windowed cost excludes the out-of-window row");

  // endMs upper bound: the [now-70d, now-40d) window is unchanged by any of the
  // inserts — the 'now' rows sit above its upper bound, the 90d row below its lower.
  const priorAfter = computeCostWindow(30, Date.now() - 40 * DAY);
  assert.equal(priorAfter.calls, basePrior.calls, "the upper-bounded prior window excludes rows after endMs");
  assert.ok(near(priorAfter.costUsd, basePrior.costUsd), "prior-window cost unchanged by out-of-window inserts");
});
