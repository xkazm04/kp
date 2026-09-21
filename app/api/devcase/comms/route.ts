import { NextRequest, NextResponse } from "next/server";
import { safeJsonError } from "@/app/_lib/api-response";
import { listOutbox } from "@/app/_lib/db/devcase";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";


// The comms outbox — every outbound message (acks, invites), the audit log of what the
// pipeline sent. Status is the three-state delivery contract (comms-status.ts):
// "queued" = recorded locally, no relay (terminal dev state); "sent" = relayed (2xx);
// "failed" = relay delivery dead-lettered. `relayConfigured` tells the client whether
// queued means "offline" (false) or is unexpected (true).
//
// Same silent-truncation trap the case list had: `listOutbox(50)` hid older dead
// letters and the payload said nothing. `?limit=` (default 50, clamp 500) +
// `truncated` copy the case-list envelope so today's client is unchanged until the
// outbox UI opts in.
const DEFAULT_OUTBOX_LIMIT = 50;
const MAX_OUTBOX_LIMIT = 500;

function outboxLimitFrom(raw: string | null): number {
  if (raw === null || raw.trim() === "") return DEFAULT_OUTBOX_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return DEFAULT_OUTBOX_LIMIT;
  return Math.min(n, MAX_OUTBOX_LIMIT);
}

export async function GET(request: NextRequest) {
  try {
    const limit = outboxLimitFrom(new URL(request.url).searchParams.get("limit"));
    const rows = listOutbox(limit + 1, await currentWorkspace());
    const truncated = rows.length > limit;
    return NextResponse.json({
      outbox: truncated ? rows.slice(0, limit) : rows,
      truncated,
      limit,
      relayConfigured: Boolean(process.env.COMMS_WEBHOOK_URL),
    });
  } catch (error) {
    // better-sqlite3 read: a thrown message carries SQLITE_* codes and the absolute
    // db path. Log it, answer a code the studio renders in the reader's language.
    return safeJsonError(error, "api:devcase/comms", "DEVCASE_OUTBOX_FAILED");
  }
}
