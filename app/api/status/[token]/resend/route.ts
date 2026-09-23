import { NextRequest } from "next/server";
import { getEntryWorkspace, getPipelineEntry } from "@/app/_lib/db/pipeline";
import { getEntryIdByStatusToken } from "@/app/_lib/application-status-store";
import { isRelayConfigured } from "@/app/_lib/comms-relay";
import { resendMessageKey } from "@/app/_lib/candidate-next-action";
import { resendNextAction } from "@/app/_lib/candidate-next-action-server";
import { jsonOk, jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// "Send it to my email again" — the status page's resend door (challenge-r06
// application-status-page/B). PUBLIC, token-gated, like every /api/status/[token]
// sibling (the /api/status/ prefix in app/_lib/auth/public-routes.ts admits it).
//
//   POST (no body) -> { ok: true, message: "resent" | "resentNoRelay" }
//
// What is waiting on the candidate (an open offer, a booking invite, an untaken AI
// interview) is re-derived HERE from the stores, never taken from the caller, and its
// EXISTING link is re-sent to the address on file only (candidate-next-action-server.ts).
// The answer is chosen from the relay flag alone: a send, a cooldown and an entry with
// no address on file read the same, so the door cannot probe what is on file. The one
// exception is the truth about a send that was attempted and did not go: that answers
// STATUS_RESEND_UNDELIVERED rather than a sentence claiming it went.
//
// Per client AND token, BEFORE the token lookup, so a flood never reaches the store.
// 10/min is the letter/NPS doors' cap; the real bound on mail is the per-entry
// once-a-day cooldown behind it.
const RESEND_RATE_LIMIT = { limit: 10, windowMs: 60_000 };

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    if (!rateLimit(`status-resend:${clientIpFrom(request.headers)}:${token}`, RESEND_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const entryId = getEntryIdByStatusToken(token);
    if (!entryId) return jsonRefusal("STATUS_LINK_INVALID", 404);
    // Tenant from the entry itself (token-driven flow, no session), as the siblings do.
    const workspaceId = getEntryWorkspace(entryId);
    const entry = getPipelineEntry(entryId, workspaceId);
    if (!entry) return jsonRefusal("STATUS_LINK_INVALID", 404);

    const relayConfigured = isRelayConfigured();
    const result = await resendNextAction(entry, { origin: new URL(request.url).origin, relayConfigured });
    if (result.outcome === "nothing_pending") return jsonRefusal("STATUS_NOTHING_TO_RESEND", 409);
    if (result.outcome === "dispatched" && (result.claim === "failed" || result.claim === "refused")) {
      return jsonRefusal("STATUS_RESEND_UNDELIVERED", 502);
    }
    return jsonOk({ ok: true, message: resendMessageKey(relayConfigured) });
  } catch (error) {
    // Raw err.message would surface SQLite / relay internals on a public token route.
    return safeJsonError(error, "api:status:resend", "STATUS_RESEND_FAILED");
  }
}
