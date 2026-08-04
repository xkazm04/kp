import { NextResponse } from "next/server";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { safeJsonError } from "@/app/_lib/api-response";
import { getBridgeConfig } from "@/app/_lib/agent-hire/bridge-store";

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
