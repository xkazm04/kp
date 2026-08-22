import { NextResponse } from "next/server";
import { drainEdge, sendEdgeHeartbeat } from "@/app/_lib/edge-drain";
import { getEdgeConfig } from "@/app/_lib/edge-config";
import { requireOperator } from "@/app/_lib/auth/require-operator";

// "Drain now" — the manual twin of what the clock does every tick, for an operator
// who has just wired a source and wants to see it land rather than wait a cadence.
//
// Not rate-limited and not public: it is operator-gated, it spends no money and
// spawns no subprocess (a drained JSON lead files through the same intake a webhook
// would), and the work it does is bounded by the edge's own page size.
export async function POST() {
  const denied = await requireOperator();
  if (denied) return denied;
  const summary = await drainEdge();
  if (summary.configured) await sendEdgeHeartbeat();
  return NextResponse.json({ summary, config: getEdgeConfig() });
}
