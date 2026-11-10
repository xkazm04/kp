import { NextResponse } from "next/server";
import { withWorkspace } from "@/app/_lib/auth/workspace-context";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { setDecisionConfig } from "@/app/_lib/decision-config-store";
import { isMarketId, MARKET_IDS, MARKETS } from "@/app/_lib/markets";
import { getWorkspaceMarket } from "@/app/_lib/workspace-market";

// The workspace's market (app/_lib/markets.ts): the currency, pay period, hub and
// benchmark every compensation figure follows. Any session reads it — every surface that
// labels a figure needs it. Changing it is an administrator's act on the TEAM
// (`team:manage`): it is stored as this workspace's own override of the tiered decision
// config, and it converts no stored figure.
export const GET = withWorkspace(async (ws: string) => {
  return NextResponse.json({ market: getWorkspaceMarket(ws), markets: MARKET_IDS.map((id) => MARKETS[id]) });
});

export const PUT = withWorkspace(async (ws: string, request: Request) => {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("team:manage", requireCapability);
  if (under) return under;
  const body = (await request.json().catch(() => null)) as { marketId?: unknown } | null;
  const marketId = body?.marketId;
  if (!isMarketId(marketId)) return jsonRefusal("WORKSPACE_MARKET_INVALID", 400);
  try {
    setDecisionConfig("market", { marketId }, ws, "team");
    return NextResponse.json({ ok: true, market: getWorkspaceMarket(ws) });
  } catch (err) {
    return safeJsonError(err, "api:workspace/market", "WORKSPACE_MARKET_SAVE_FAILED");
  }
});
