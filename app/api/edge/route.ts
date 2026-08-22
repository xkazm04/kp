import { NextRequest, NextResponse } from "next/server";
import { EdgeConfigError, getEdgeConfig, setEdgeConfig } from "@/app/_lib/edge-config";
import { requireOperator } from "@/app/_lib/auth/require-operator";

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
  try {
    const body = (await request.json()) as { url?: unknown; secret?: unknown; nudgeTarget?: unknown };
    return NextResponse.json({ ok: true, config: setEdgeConfig(body) });
  } catch (error) {
    if (error instanceof EdgeConfigError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save the edge config." },
      { status: 500 }
    );
  }
}
