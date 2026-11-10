// The workspace's market is a TEAM setting: one team running in Germany must not re-home
// another team's figures, and the env a pipeline spawn carries is the spawning team's.
// Stored as the `market` phase of decision_config, so the table's own tenancy proof
// (decision-config-tenancy.test.ts) covers the SQL; this pins the behaviour end to end.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { setDecisionConfig } from "./decision-config-store.ts";
import { validateDecisionConfig } from "./decision-config-schema.ts";
import { getWorkspaceMarket, getWorkspaceMarketId, marketSpawnEnv } from "./workspace-market.ts";

after(() => cleanupUnitDb());

test("a workspace that never chose runs in the default market", () => {
  assert.equal(getWorkspaceMarketId("ws-market-fresh"), "cz");
  assert.deepEqual(marketSpawnEnv("ws-market-fresh"), { KP_MARKET: "cz" });
});

test("one team's market never reaches another team", () => {
  setDecisionConfig("market", { marketId: "de" }, "ws-market-a", "team");
  assert.equal(getWorkspaceMarketId("ws-market-a"), "de");
  assert.equal(getWorkspaceMarket("ws-market-a").currency, "EUR");
  assert.deepEqual(marketSpawnEnv("ws-market-a"), { KP_MARKET: "de" });
  assert.equal(getWorkspaceMarketId("ws-market-b"), "cz", "team B is untouched by A's choice");
});

test("an org baseline cascades until a team chooses its own", () => {
  setDecisionConfig("market", { marketId: "gb" }, "ws-market-c", "org");
  assert.equal(getWorkspaceMarketId("ws-market-c"), "gb");
  assert.equal(getWorkspaceMarket("ws-market-d").period, "year", "a team with no choice inherits the org's");
  assert.equal(getWorkspaceMarketId("ws-market-a"), "de", "a team's own choice wins over the org baseline");
});

test("the write boundary refuses a market outside the closed list", () => {
  assert.equal(validateDecisionConfig("market", { marketId: "de-berlin" }).ok, false);
  assert.equal(validateDecisionConfig("market", { marketId: "de", extra: 1 }).ok, false);
  assert.equal(validateDecisionConfig("market", { marketId: "gb" }).ok, true);
});
