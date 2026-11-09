import { NextRequest, NextResponse } from "next/server";
import { isConnectorId, listConnectors, probeConnector } from "@/app/_lib/connect/catalog";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireOrgCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, requireCapabilityCoded } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { withWorkspace } from "@/app/_lib/auth/workspace-context";

// The connector hub's probe door (docs/features/connect/README.md, "Probe contract"): ONE
// connector's probe, run because an owner pressed Probe, and the row it leaves behind. The
// answer is the catalog row (a secret is `hasSecret`, never a value) and its health word.
//
// It dials out, so it is gated and throttled exactly like the two Send-test doors it sits
// beside (/api/comms/relay/test, /api/ats/test): operator + org:manage, then the limiter,
// then the probe. Under the egress seal the probe answers before it resolves a secret or
// opens a socket, so a sealed process answers `{health:"sealed"}` with 0 fetches.
//
// `smtp` is NEVER probed here (operator rule, 2026-10-28): its probe is a REAL letter, so it
// runs only through the owner-pressed Send test on the sender level (/api/comms/smtp/test).
// This door answers the row's config-only health and names that door instead; nothing that
// calls the hub (a deck on load, a refresh, a script) can send a letter through it.
const PROBE_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };

export const POST = withWorkspace(async (ws: string, request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("org:manage", requireOrgCapability);
  if (under) return under;
  const { id } = await params;
  // Free and before the budget: an id that names nothing, or the one row this door refuses.
  if (!isConnectorId(id)) return new NextResponse(null, { status: 404 });
  if (id === "smtp") {
    const row = listConnectors(ws).find((r) => r.id === "smtp");
    return NextResponse.json({ health: row?.health ?? "not_configured", connector: row ?? null, door: "send_test" }, { status: 409 });
  }
  if (!rateLimit(`connect-probe:${clientIpFrom(request.headers)}`, PROBE_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  const row = await probeConnector(id, ws);
  return NextResponse.json({ health: row.health, connector: row });
});
