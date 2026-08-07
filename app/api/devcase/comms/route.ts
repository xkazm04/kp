import { NextResponse } from "next/server";
import { listOutbox } from "@/app/_lib/db/devcase";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";


// The comms outbox — every outbound message (acks, invites), the audit log of what the
// pipeline sent. Status is the three-state delivery contract (comms-status.ts):
// "queued" = recorded locally, no relay (terminal dev state); "sent" = relayed (2xx);
// "failed" = relay delivery dead-lettered. `relayConfigured` tells the client whether
// queued means "offline" (false) or is unexpected (true).
export async function GET() {
  try {
    return NextResponse.json({ outbox: listOutbox(50, await currentWorkspace()), relayConfigured: Boolean(process.env.COMMS_WEBHOOK_URL) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to list outbox." }, { status: 500 });
  }
}
