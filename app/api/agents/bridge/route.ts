import { NextResponse } from "next/server";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { requireOrgCapability } from "@/app/_lib/auth/current-user";
import { getBridgeConfig, setBridgeConfig } from "@/app/_lib/agent-hire/bridge-store";

// Agent-candidate bridge — GET the Personas connection status (base URL, key
// presence, paired flag, last successful round-trip). The pk_ key is WRITE-ONLY
// and never crosses this read (bridge-store secret doctrine).

export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    return NextResponse.json({ bridge: getBridgeConfig() });
  } catch (error) {
    return safeJsonError(error, "api:agents/bridge", "AGENT_BRIDGE_FAILED");
  }
}

// DELETE = disconnect: clear the stored pk_ key (apiKey "" is the store's
// documented CLEAR sentinel) while keeping the row/base URL, so a re-pair from
// the same Personas URL is one click. An env-driven connection can't be
// disconnected here — env beats the stored row by design (resolveRelay
// precedence), so the route says so instead of pretending.
export async function DELETE() {
  const denied = await requireOperator();
  if (denied) return denied;
  // AUTHORIZATION (write-routes-check-a-capability). Disconnecting drops the pk_ key
  // every agent dispatch authenticates with — INSTALLATION-level configuration, and
  // the destructive half of the pairing door beside it. `org:manage`, same as
  // POST /api/comms/relay, which rewrites the equivalent credential for the other
  // outbound relay. The GET stays operator-gated: it reads status and never the key.
  const under = await requireCapabilityCoded("org:manage", requireOrgCapability);
  if (under) return under;
  try {
    if (getBridgeConfig().source === "env") {
      return NextResponse.json(
        { error: "This connection is set by PERSONAS_BRIDGE_URL/KEY — manage it in the deployment env." },
        { status: 409 }
      );
    }
    return NextResponse.json({ bridge: setBridgeConfig({ apiKey: "" }) });
  } catch (error) {
    return safeJsonError(error, "api:agents/bridge", "AGENT_BRIDGE_FAILED");
  }
}
