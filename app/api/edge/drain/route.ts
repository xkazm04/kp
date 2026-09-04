import { NextResponse } from "next/server";
import { drainEdge, sendEdgeHeartbeat } from "@/app/_lib/edge-drain";
import { getEdgeConfig } from "@/app/_lib/edge-config";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireOrgCapability } from "@/app/_lib/auth/current-user";
import { requireCapabilityCoded } from "@/app/_lib/api-response";

// "Drain now" — the manual twin of what the clock does every tick, for an operator
// who has just wired a source and wants to see it land rather than wait a cadence.
//
// Not rate-limited and not public: it is operator-gated, it spends no money and
// spawns no subprocess (a drained JSON lead files through the same intake a webhook
// would), and the work it does is bounded by the edge's own page size.
export async function POST() {
  const denied = await requireOperator();
  if (denied) return denied;
  // AUTHORIZATION (write-routes-check-a-capability). requireOperator above proves a
  // session, not authority. This door rewrites INSTALLATION-level configuration,
  // so it is an org-administration act: `org:manage`, resolved org-wide, which
  // recruiters and viewers do not hold.
  const under = await requireCapabilityCoded("org:manage", requireOrgCapability);
  if (under) return under;
  const summary = await drainEdge();
  if (summary.configured) await sendEdgeHeartbeat();
  return NextResponse.json({ summary, config: getEdgeConfig() });
}
