import { NextResponse } from "next/server";
import { withWorkspace } from "@/app/_lib/auth/workspace-context";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { humanActor } from "@/app/_lib/auth/operator-approver";
import { backlogOffer, confirmBacklogSend } from "@/app/_lib/comms-backlog";
import { requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";

// The letters that waited for a sender (app/_lib/comms-backlog.ts). GET is the offer:
// once a relay delivers, the queued letters recorded before it existed, as a preview
// (recipient, subject, when recorded; never the body). POST is the owner's one confirmation:
// { ids: string[] } -> a per-letter result in the delivery vocabulary, or a named skip.
//
// Nothing here is reached by anything but the owner's press: no relay save, boot or timer
// calls this route. Both verbs are operator-gated and workspace-scoped (the letters of
// another team are "not_found"); the send needs the same seat as the resend door,
// `pipeline:write`. No rate limiter on purpose: the confirmation is idempotent (a repeat is
// a named "already_sent" skip), capped at BACKLOG_MAX letters, and in-process serialized
// per letter, so a loop of POSTs has nothing left to send.

export const GET = withWorkspace(async (ws: string) => {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    return NextResponse.json(backlogOffer(ws));
  } catch (error) {
    return safeJsonError(error, "api:comms:backlog", "OUTREACH_FAILED");
  }
});

export const POST = withWorkspace(async (ws: string, request: Request) => {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  try {
    const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
    // Anything but a list of ids confirms nothing: a malformed call sends no letter.
    const ids = Array.isArray(body?.ids) ? (body.ids as unknown[]).filter((v): v is string => typeof v === "string") : [];
    const results = await confirmBacklogSend(ws, ids, await humanActor());
    return NextResponse.json({ ok: true, results });
  } catch (error) {
    return safeJsonError(error, "api:comms:backlog", "OUTREACH_FAILED");
  }
});
