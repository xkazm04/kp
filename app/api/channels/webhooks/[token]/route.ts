import { NextResponse } from "next/server";
import { revokeChannelWebhook } from "@/app/_lib/db/channels";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireOrgCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, requireCapabilityCoded } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";


// E3 — revoke an inbound webhook. The row (and its receipt history) is kept for
// audit; the public receiver answers 404 for a revoked token from then on.
//
// AUTHORIZATION (/perfect wave 27, api-comms): the sibling of the POST/PATCH doors in
// ../route.ts — the reasoning is written out there. Revoking permanently kills a live
// lead intake, so it is the same org-administration act, gated the same way and sharing
// the same per-IP budget KEY (one caller must not win a second 60-call allowance by
// switching verbs). The 404 stays the answer for a token in another team, so the door
// is still not a probe for which receivers exist.
const RECEIVER_WRITE_RATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 };

export async function DELETE(request: Request, context: { params: Promise<{ token: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("org:manage", requireOrgCapability);
  if (under) return under;
  if (!rateLimit(`channel-receiver:${clientIpFrom(request.headers)}`, RECEIVER_WRITE_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  const { token } = await context.params;
  const revoked = revokeChannelWebhook(token, await currentWorkspace());
  if (!revoked) return jsonRefusal("CHANNEL_WEBHOOK_NOT_FOUND", 404);
  return NextResponse.json({ ok: true });
}
