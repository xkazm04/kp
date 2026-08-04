import { NextResponse } from "next/server";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { safeJsonError } from "@/app/_lib/api-response";
import { fetchConnectorCatalog } from "@/app/_lib/agent-hire/bridge-client";

// Agent-candidate bridge — GET the connector catalog for the Agent fit tab's
// editable connector chips. The bridge client is server-only (the pk_ key rides
// its calls), so this route is the browser's one window onto the catalog. Never
// fails: an unpaired/down Personas degrades to the built-in list, and `source`
// says which one served (the UI labels the fallback honestly).

export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const catalog = await fetchConnectorCatalog();
    return NextResponse.json({ connectors: catalog.connectors, source: catalog.source });
  } catch (error) {
    return safeJsonError(error, "api:agents/catalog", "AGENT_CATALOG_FAILED");
  }
}
