import { NextRequest, NextResponse } from "next/server";
import { EdgeConfigError, getEdgeConfig, setEdgeConfig } from "@/app/_lib/edge-config";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireOrgCapability } from "@/app/_lib/auth/current-user";

// The edge pairing (docs/concepts/local-first-edge.md §3.2) — the UI-backed twin of
// KP_EDGE_URL / KP_EDGE_SECRET, shaped exactly like /api/comms/relay because it is
// the same kind of object: an endpoint plus a write-only signing secret, with the
// env var winning while it is set.
//
// OPERATOR-only, for the same reason as the relay: this decides which remote queue
// this installation will accept inbound candidate events from, and holds the secret
// that authenticates it. GET never returns the secret — only `hasSecret`.
export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  return NextResponse.json({ config: getEdgeConfig() });
}

export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  // AUTHORIZATION (write-routes-check-a-capability). requireOperator above proves a
  // session, not authority. This door rewrites INSTALLATION-level configuration: which
  // remote queue this install accepts inbound candidate events from, and the secret
  // that authenticates it. `url: ""` unpairs and resets the drain cursor. Its own
  // siblings (drain, pair, comms/relay, ats/config) already ask for `org:manage`; the
  // door that WRITES the pairing asked for nothing but a session.
  const under = await requireCapabilityCoded("org:manage", requireOrgCapability);
  if (under) return under;
  try {
    const body = (await request.json()) as { url?: unknown; secret?: unknown; nudgeTarget?: unknown };
    return NextResponse.json({ ok: true, config: setEdgeConfig(body) });
  } catch (error) {
    // CODES, NEVER MESSAGES (docs/architecture/api-contracts.md §1.1). An
    // EdgeConfigError is a DECISION — a URL that is not a public https endpoint, a
    // field of the wrong type — so it answers a refusal code the card resolves in the
    // reader's own language. Anything else came out of better-sqlite3 or the at-rest
    // encryption and can carry a filesystem path or key detail: it goes to the server
    // log and the browser gets the generic message plus a code.
    if (error instanceof EdgeConfigError) {
      console.error("[api:edge] EDGE_CONFIG_REJECTED", error.message);
      return jsonRefusal("EDGE_CONFIG_REJECTED", 400);
    }
    return safeJsonError(error, "api:edge", "EDGE_SAVE_FAILED");
  }
}
