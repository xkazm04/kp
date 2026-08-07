import { NextRequest, NextResponse } from "next/server";
import { getPipelineEntry } from "@/app/_lib/db";
import { createScheduleInvite } from "@/app/_lib/schedule-store";
import { plannedInterviewMinutes } from "@/app/_lib/interview-run";
import { dispatchScheduleInvite } from "@/app/_lib/comms-dispatch";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
import { BULK_INVITE_CAP, coerceBulkEntryIds } from "@/app/_lib/bulk-invite";


// P2-2 — mint + deliver self-scheduling links to a COHORT in one recruiter action
// (the back half of the funnel was per-candidate-only; a blocker for high-volume
// hiring). Mirrors the single /api/schedule/invite per entry — same mint, same
// best-effort delivery — but with per-entry ISOLATION: one bad/terminal/comms-
// failed entry never aborts the batch, and the response reports each outcome.

type InviteResult = { entryId: string; ok: boolean; token?: string; dispatched?: boolean; error?: string };

export async function POST(request: NextRequest) {
  try {
    // Throttle the NUMBER of bulk calls (each fans out to up to BULK_INVITE_CAP
    // candidates), not each invite — this IS the one-action-many-candidates path,
    // so the single route's per-invite limit would defeat its purpose.
    if (!rateLimit(`invite-bulk:${clientIpFrom(request.headers)}`, { limit: 10, windowMs: 60_000 })) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
    const body = (await request.json().catch(() => ({}))) as { entryIds?: unknown };
    const ids = coerceBulkEntryIds(body.entryIds);
    if (ids.length === 0) {
      return NextResponse.json({ error: `entryIds must be a non-empty array (max ${BULK_INVITE_CAP}).` }, { status: 400 });
    }

    const origin = new URL(request.url).origin;
    const results: InviteResult[] = [];
    for (const entryId of ids) {
      const entry = getPipelineEntry(entryId);
      if (!entry) {
        results.push({ entryId, ok: false, error: "not found" });
        continue;
      }
      // Never invite a hired/rejected/declined candidate (terminal) — the same
      // stale-token doctrine the single flows enforce.
      if (entry.status !== "active") {
        results.push({ entryId, ok: false, error: "not active" });
        continue;
      }
      try {
        const invite = createScheduleInvite({
          entryId: entry.id,
          candidateLabel: entry.candidateLabel,
          jobTitle: entry.jobTitle,
          durationMin: plannedInterviewMinutes(entry),
        });
        // Minting the link is the meaningful outcome (the candidate can schedule);
        // delivery is best-effort, exactly like the single route's copy-panel fallback.
        let dispatched = false;
        try {
          const link = `${publicBaseUrl(origin)}/schedule/${invite.token}`;
          await dispatchScheduleInvite(entry, link, { durationMin: invite.durationMin });
          dispatched = true;
        } catch (commErr) {
          console.error(
            `[schedule:invite:bulk] ${invite.token} minted but delivery failed:`,
            commErr instanceof Error ? commErr.message : commErr
          );
        }
        results.push({ entryId, ok: true, token: invite.token, dispatched });
      } catch (err) {
        results.push({ entryId, ok: false, error: err instanceof Error ? err.message : "mint failed" });
      }
    }

    const sent = results.filter((r) => r.ok).length;
    return NextResponse.json({ ok: true, sent, total: results.length, results });
  } catch (error) {
    return safeJsonError(error, "api:schedule:invite:bulk", "SCHEDULE_INVITE_BULK_FAILED");
  }
}
