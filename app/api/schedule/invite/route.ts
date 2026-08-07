import { NextRequest, NextResponse } from "next/server";
import { getPipelineEntry } from "@/app/_lib/db";
import { createScheduleInvite } from "@/app/_lib/schedule-store";
import { plannedInterviewMinutes } from "@/app/_lib/interview-run";
import { dispatchScheduleInvite } from "@/app/_lib/comms-dispatch";
import { deliveryClaim, isRelayConfigured, type DeliveryClaim } from "@/app/_lib/comms-truth";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { jsonOk, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";


// POST → recruiter mints a self-scheduling link for a pipeline entry. The
// candidate opens /schedule/<token> and picks a slot.
export async function POST(request: NextRequest) {
  try {
    // No caller restriction exists yet (no auth layer): any request with a
    // valid entryId mints a link and a confirmation-email path. Throttle
    // per-IP so link-minting can't be used to flood the comms provider
    // (idea-3e49abaf); generous enough for any human recruiter.
    if (!rateLimit(`invite:${clientIpFrom(request.headers)}`, { limit: 30, windowMs: 60_000 })) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
    const body = (await request.json().catch(() => ({}))) as { entryId?: string };
    if (!body.entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });
    const entry = getPipelineEntry(body.entryId);
    if (!entry) return NextResponse.json({ error: "pipeline entry not found" }, { status: 404 });

    const invite = createScheduleInvite({
      entryId: entry.id,
      candidateLabel: entry.candidateLabel,
      jobTitle: entry.jobTitle,
      // A student's six-phase screen runs ~22 min (vs the ~5-min quick screen) —
      // stamp the planned length so the picker, confirmation and reminder all
      // tell the candidate how long to block.
      durationMin: plannedInterviewMinutes(entry),
    });

    // Deliver the link TO the candidate — the voice screen and the offer both
    // auto-dispatch their token links; without this the recruiter pastes it into
    // a channel outside the app and no Outbox row distinguishes a delivered
    // invite from a forgotten one. Best-effort: a comms failure must not fail
    // link minting (the copy panel below stays the manual fallback).
    // `delivery` is the TRUTHFUL claim (REC-10): the outbox row's real status —
    // sent only on a relayed 2xx, queued when the local outbox is the terminal
    // target, failed on a dead-letter/throw — so the drawer can't render a green
    // "sent to the candidate" over a message nothing will deliver.
    let dispatched = false;
    let delivery: DeliveryClaim = "failed";
    try {
      const link = `${publicBaseUrl(new URL(request.url).origin)}/schedule/${invite.token}`;
      const status = await dispatchScheduleInvite(entry, link, { durationMin: invite.durationMin });
      delivery = deliveryClaim(isRelayConfigured(), status);
      dispatched = delivery !== "failed";
    } catch (commErr) {
      console.error(
        `[schedule:invite] link ${invite.token} minted but invite delivery failed: ${commErr instanceof Error ? commErr.message : commErr}`
      );
    }

    return jsonOk({ token: invite.token, url: `/schedule/${invite.token}`, dispatched, delivery });
  } catch (error) {
    return safeJsonError(error, "api:schedule:invite", "SCHEDULE_INVITE_FAILED");
  }
}
