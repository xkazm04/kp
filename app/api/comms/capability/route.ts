import { NextResponse } from "next/server";
import { isRelayConfigured } from "@/app/_lib/comms-truth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// REC-10 — the one capability bit the delivery truth-language keys off:
// is a real relay wired (COMMS_WEBHOOK_URL), or is every "send" a terminal
// `queued` row in the local outbox? Served tiny so any client surface that
// renders a sent/queued claim can read it without dragging the full
// /api/comms payload (see useDeliveryCapability).
export function GET() {
  return NextResponse.json({ relayConfigured: isRelayConfigured() });
}
