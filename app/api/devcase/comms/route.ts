import { NextResponse } from "next/server";
import { safeJsonError } from "@/app/_lib/api-response";
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
    // better-sqlite3 read: a thrown message carries SQLITE_* codes and the absolute
    // db path. Log it, answer a code the studio renders in the reader's language.
    return safeJsonError(error, "api:devcase/comms", "DEVCASE_OUTBOX_FAILED");
  }
}
