import { NextResponse } from "next/server";
import { listOutbox } from "@/app/_lib/db";

export const runtime = "nodejs";

// The comms outbox — every outbound message (acks, invites), the audit log of what the
// pipeline sent. "queued" = recorded locally (no relay configured); "sent" = relayed.
export async function GET() {
  try {
    return NextResponse.json({ outbox: listOutbox(), relayConfigured: Boolean(process.env.COMMS_WEBHOOK_URL) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to list outbox." }, { status: 500 });
  }
}
