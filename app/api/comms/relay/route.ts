import { NextRequest, NextResponse } from "next/server";
import { CommsRelayError, getRelayConfig, setRelayConfig } from "@/app/_lib/comms-relay-store";
import { requireOperator } from "@/app/_lib/auth/require-operator";

// The outbound comms relay config (RelayConfigCard on the Channels tab) — the
// UI-backed twin of COMMS_WEBHOOK_URL. GET never returns the signing secret
// (only `hasSecret`; ats/config doctrine). `envConfigured` tells the editor the
// env var is set and overriding whatever the form stores.
//
// OPERATOR-only (mirrors /api/ats/config): this re-points ALL candidate-facing
// message egress (PII) and holds an HMAC signing secret.
export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  return NextResponse.json({ config: getRelayConfig(), envConfigured: Boolean(process.env.COMMS_WEBHOOK_URL) });
}

export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const body = (await request.json()) as { url?: unknown; secret?: unknown };
    const config = setRelayConfig(body);
    return NextResponse.json({ ok: true, config });
  } catch (error) {
    if (error instanceof CommsRelayError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save the relay config." }, { status: 500 });
  }
}
