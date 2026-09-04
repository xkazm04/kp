import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { fetchConnectorCatalog } from "@/app/_lib/agent-hire/bridge-client";

// Agent-candidate bridge — GET the connector catalog for the Agent fit tab's
// editable connector chips. The bridge client is server-only (the pk_ key rides
// its calls), so this route is the browser's one window onto the catalog. Never
// fails: an unpaired/down Personas degrades to the built-in list, and `source`
// says which one served (the UI labels the fallback honestly).

// Per IP. Not a money door, but an EGRESS one: every call opens a socket to the
// Personas app and holds a 5s deadline against it, behind `requireOperator()`,
// which open mode (no KP_OPERATOR_PASSWORD) makes a documented no-op for the whole
// API. Its two bridge siblings (dispatch, pair) have been throttled since the
// 2026-09-03 sweep and this one was missed. 60/10 min: the Agent fit tab fetches
// the catalog once per open, so a recruiter cannot reach it and a script can.
const CATALOG_RATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 };

export async function GET(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  if (!rateLimit(`agent-catalog:${clientIpFrom(request.headers)}`, CATALOG_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const catalog = await fetchConnectorCatalog();
    return NextResponse.json({ connectors: catalog.connectors, source: catalog.source });
  } catch (error) {
    return safeJsonError(error, "api:agents/catalog", "AGENT_CATALOG_FAILED");
  }
}
