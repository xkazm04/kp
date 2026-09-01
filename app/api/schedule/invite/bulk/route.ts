import { NextRequest, NextResponse } from "next/server";
import { getPipelineEntriesByIds } from "@/app/_lib/db/pipeline";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { createScheduleInvite } from "@/app/_lib/schedule-store";
import { plannedInterviewMinutes } from "@/app/_lib/interview-planned-minutes";
import { dispatchScheduleInvite } from "@/app/_lib/comms-dispatch";
import { deliveryClaim, type DeliveryClaim } from "@/app/_lib/comms-truth";
import { isRelayConfigured } from "@/app/_lib/comms-relay";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
import { BULK_INVITE_CAP, coerceBulkEntryIds } from "@/app/_lib/bulk-invite";


// P2-2 — mint + deliver self-scheduling links to a COHORT in one recruiter action
// (the back half of the funnel was per-candidate-only; a blocker for high-volume
// hiring). Mirrors the single /api/schedule/invite per entry — same mint, same
// best-effort delivery — but with per-entry ISOLATION: one bad/terminal/comms-
// failed entry never aborts the batch, and the response reports each outcome.

type InviteResult = {
  entryId: string;
  ok: boolean;
  token?: string;
  dispatched?: boolean;
  // REC-10 — the truthful per-entry claim, the same three-state the single route
  // returns: `sent` only for a relayed 2xx, `queued` when the local outbox is the
  // terminal target, `failed` on a dead-letter/throw.
  delivery?: DeliveryClaim;
  error?: string;
};

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
// The workspace is then resolved ONCE and threaded into the batched entry read:
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
    // A SILENT CAP REPORTED AS A TOTAL. coerceBulkEntryIds truncates at
    // BULK_INVITE_CAP, and this route used to hand the truncated list straight to the
    // loop — so a cohort of 150 (exactly the high-volume case the endpoint exists for:
    // "Select all visible" over a board with more than 100 active candidates) answered
    // `{ sent: 100, total: 100 }` with NO result row for the other 50. The bulk bar's
    // failures-stay-selected grammar keys off those rows, so the 50 were neither counted
    // as failures nor kept selected: they were silently DESELECTED under a green
    // "100 invited to schedule", and nobody ever learned they hadn't been invited.
    //
    // Dedupe the WHOLE submission first, then split at the cap: the first
    // BULK_INVITE_CAP are processed, the remainder come back as explicit per-entry
    // refusals so they stay selected and the recruiter can send the next batch. The
    // unbounded dedupe adds no new exposure — `request.json()` above already
    // materialized the same array.
    const unique = coerceBulkEntryIds(body.entryIds, Number.MAX_SAFE_INTEGER);
    const ids = unique.slice(0, BULK_INVITE_CAP);
    const overflow = unique.slice(BULK_INVITE_CAP);
    if (ids.length === 0) {
      return NextResponse.json({ error: `entryIds must be a non-empty array (max ${BULK_INVITE_CAP}).` }, { status: 400 });
    }

    const origin = new URL(request.url).origin;
    const results: InviteResult[] = [];
    // One chunked IN-query for the whole batch (getPipelineEntriesByIds) instead of a
    // point SELECT per id — the cap is 100, exactly the shape N+1 turns pathological.
    const entriesById = getPipelineEntriesByIds(ids, ws);
    for (const entryId of ids) {
      const entry = entriesById.get(entryId);
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
        //
        // REC-10 — but "best-effort" is not "assume it worked". dispatchScheduleInvite
        // RETURNS the outbox row's real status and only THROWS on a hard error, so
        // `dispatched = true` after a non-throwing call claimed delivery for every
        // dead-lettered message: with a relay configured and the webhook answering 500,
        // a 12-candidate fan-out reported `dispatched: true` twelve times over twelve
        // `failed` outbox rows. Resolve the same truthful claim the single route does.
        let dispatched = false;
        let delivery: DeliveryClaim = "failed";
        try {
          const link = `${publicBaseUrl(origin)}/schedule/${invite.token}`;
          const status = await dispatchScheduleInvite(entry, link, { durationMin: invite.durationMin });
          delivery = deliveryClaim(isRelayConfigured(), status);
          dispatched = delivery !== "failed";
        } catch (commErr) {
          console.error(
            `[schedule:invite:bulk] ${invite.token} minted but delivery failed:`,
            commErr instanceof Error ? commErr.message : commErr
          );
        }
        results.push({ entryId, ok: true, token: invite.token, dispatched, delivery });
      } catch (err) {
        // The throw here is `createScheduleInvite` — a better-sqlite3 write — so its
        // `.message` is SQLITE_* codes, `UNIQUE constraint failed: …` and the absolute
        // db path. Every OTHER `error` string this loop pushes is a generic operator
        // sentence ("not active", "over the … cap"); this one forwarded the raw store
        // error into the same field. Both hand-listed hygiene guards
        // (app/api/jds/error-message-hygiene.test.ts, app/api/apply/apply-error-hygiene.test.ts)
        // key on `NextResponse.json({ error: … })`, so neither could see a leak pushed
        // into the results array — which is why the repo-wide scan in
        // app/api/error-response-contract.test.ts exists.
        console.error(`[schedule:invite:bulk] mint failed for entry ${entryId}:`, err);
        results.push({ entryId, ok: false, error: "mint failed" });
      }
    }

    // Everything past the cap comes back as an explicit refusal rather than vanishing,
    // so the caller's per-entry grammar keeps them selected for the next batch.
    for (const entryId of overflow) {
      results.push({ entryId, ok: false, error: `over the ${BULK_INVITE_CAP}-candidate cap for one request` });
    }

    // `sent` is the count of links MINTED (kept under that name for existing callers);
    // `delivered` is the honest count a relay actually took. Keyless, every message is a
    // terminal local-outbox row, so delivered is 0 and no surface may claim otherwise.
    const sent = results.filter((r) => r.ok).length;
    const delivered = results.filter((r) => r.delivery === "sent").length;
    return NextResponse.json({ ok: true, sent, delivered, capped: overflow.length, total: results.length, results });
  } catch (error) {
    return safeJsonError(error, "api:schedule:invite:bulk", "SCHEDULE_INVITE_BULK_FAILED");
  }
}
