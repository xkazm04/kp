import { NextRequest, NextResponse } from "next/server";
import { getPipelineEntry } from "@/app/_lib/db/pipeline";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { createScheduleInvite } from "@/app/_lib/schedule-store";
import { plannedInterviewMinutes } from "@/app/_lib/interview-planned-minutes";
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

// AUTH + TENANCY (invite-gate parity with /api/pipeline/batch): this route fans a
// SINGLE call out to up to BULK_INVITE_CAP (100) entries and DELIVERS an email to
// each — the same "one call can reach a whole cohort of candidates" posture the
// batch route operator-gates, with the delivery already attached. So requireOperator
// runs FIRST, before the throttle, so an anonymous demo session is refused before it
// can even spend rate-limit budget. Semantics are the shared requireOperator ones —
// open mode (no KP_OPERATOR_PASSWORD) is a no-op, so local dev is unaffected; the
// anonymous demo-workspace cookie the proxy waves through → 401 (the guided sim's
// invite step already has a manual-confirm fallback for exactly that case).
//
// The workspace is then resolved ONCE and threaded into every getPipelineEntry:
// before this, each row resolved against DEFAULT_WORKSPACE_ID, so a non-default team
// got "not found" for its OWN cohort (a silently broken feature) while a default-
// workspace caller could reach rows it was never scoped to.
export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  const ws = await currentWorkspace();
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
      const entry = getPipelineEntry(entryId, ws);
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
