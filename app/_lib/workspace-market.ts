// The workspace's market, read server-side once per request and handed DOWN: to a
// formatter as an argument, to a spawned pipeline CLI as KP_MARKET (the pipeline never
// reads the DB for it — market_config.py resolves its ACTIVE_MARKET from that variable
// at import, and every CLI is spawned per request).
//
// Stored as the `market` phase of the tiered decision config (decision-config-store.ts):
// a team's own choice, else its org's, else the code default `cz` — the same cascade
// and the same already-classified table (tenancy: TENANCY_SCOPED, export: org_shared)
// as the compliance jurisdiction it sits beside. No new table, no new column.
import { getDecisionConfig } from "./decision-config-store";
import type { MarketRule } from "./decision-config-schema";
import { MARKETS, resolveMarketId, type MarketId, type MarketSpec } from "./markets";

/** PASS THE WORKSPACE: a bare default would answer one tenant's market for another. */
export function getWorkspaceMarketId(workspaceId: string): MarketId {
  return resolveMarketId(getDecisionConfig<MarketRule>("market", workspaceId).marketId);
}

export function getWorkspaceMarket(workspaceId: string): MarketSpec {
  return MARKETS[getWorkspaceMarketId(workspaceId)];
}

/** The env a pipeline spawn for this workspace carries, merged into `opts.env`. */
export function marketSpawnEnv(workspaceId: string): { KP_MARKET: MarketId } {
  return { KP_MARKET: getWorkspaceMarketId(workspaceId) };
}
