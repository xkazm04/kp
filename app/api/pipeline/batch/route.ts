import { NextRequest, NextResponse } from "next/server";
import { safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
import { runPipelineEntryAction } from "@/app/_lib/pipeline-entry-action";


// Batch move/decide a COHORT in one recruiter action (the board's bulk move + bulk
// accept/reject). The single /api/pipeline/[id] round-trip-per-card was N serial
// requests for an N-card selection — a 50-card cohort was 50 sequential hops with
// no per-item detail. This mirrors the bulk-invite endpoint (per-item ISOLATION),
// but for stage moves and decisions.
//
// ATOMICITY IS PER ID, NOT PER BATCH: each item runs the SAME guarded per-entry
// transaction the single route uses (runPipelineEntryAction → the db layer's
// IMMEDIATE tx with the expectedStage CAS the caller carries for THAT card). One
// item's 409/422 never aborts the others; the response reports each id's outcome
// (ok, or failed + the server's OWN reason) so a partial failure is honest — the
// recruiter sees WHY, exactly as the drag + drawer do.

const BATCH_CAP = 200; // guard a runaway payload; the board rarely selects this many

// Only the board's three cohort actions are batchable. accept/reject may extend an
// offer (offer_review) via the shared action, exactly like the single route.
const BATCH_ACTIONS = new Set(["set_stage", "accept", "reject"]);

type BatchItem = { id: string; action: string; expectedStage?: string; toStage?: string };
type BatchOutcome = { id: string; ok: boolean; reason?: string };

// Coerce one raw item, or null if it's malformed (missing id / unknown action).
function coerceItem(raw: unknown): BatchItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : "";
  const action = typeof r.action === "string" ? r.action : "";
  if (!id || !BATCH_ACTIONS.has(action)) return null;
  return {
    id,
    action,
    expectedStage: typeof r.expectedStage === "string" ? r.expectedStage : undefined,
    toStage: typeof r.toStage === "string" ? r.toStage : undefined,
  };
}

// AUTH (batch-authz-parity): operator-gated, in lock-step with the command bar
// (/api/pipeline/command). This route fans a SINGLE call out to up to BATCH_CAP
// (200) entries and can bulk-reject them — which extends candidate-facing
// rejection comms (runPipelineEntryAction → the shared reject path) across the
// whole workspace, exactly the "one call can bulk-reject with candidate emails"
// posture the command bar operator-gates. So select-all + bulk-reject must NOT
// reach the gated action ungated: requireOperator runs FIRST (before the
// throttle, so an anonymous demo session is refused before it can even spend
// rate-limit budget). Same semantics as proxy.ts / requireOperator — open mode
// (no KP_OPERATOR_PASSWORD) is a no-op, so local dev and the guided sim (which
// drive the board through the per-card routes) are unaffected; set + valid
// operator session → allow; the anonymous demo-workspace cookie the proxy waves
// through → 401. The refusal is the shared { error } envelope the client renders.
export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  const ws = await currentWorkspace();
  try {
    // Throttle the NUMBER of batch calls (each fans out to up to BATCH_CAP entries),
    // not each entry — this IS the one-action-many-candidates path.
    if (!rateLimit(`pipeline-batch:${clientIpFrom(request.headers)}`, { limit: 20, windowMs: 60_000 })) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
    const body = (await request.json().catch(() => ({}))) as { items?: unknown };
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: "items must be a non-empty array." }, { status: 400 });
    }
    if (body.items.length > BATCH_CAP) {
      return NextResponse.json({ error: `Too many items (max ${BATCH_CAP}).` }, { status: 400 });
    }

    const origin = new URL(request.url).origin;
    const results: BatchOutcome[] = [];
    for (const raw of body.items) {
      const item = coerceItem(raw);
      if (!item) {
        const id = raw && typeof raw === "object" && typeof (raw as { id?: unknown }).id === "string" ? (raw as { id: string }).id : "";
        results.push({ id, ok: false, reason: "Malformed item (missing id or unknown action)." });
        continue;
      }
      try {
        const r = await runPipelineEntryAction({
          id: item.id,
          action: item.action,
          toStage: item.toStage,
          expectedStage: item.expectedStage,
          origin,
          workspaceId: ws,
        });
        if (r.status === 200) {
          results.push({ id: item.id, ok: true });
        } else {
          // Surface the server's OWN explanation verbatim (the 409 concurrency-loss
          // vs the 422 forbidden-transition guidance) — never a bare status code.
          const reason = typeof r.body.error === "string" ? r.body.error : `Failed (${r.status}).`;
          results.push({ id: item.id, ok: false, reason });
        }
      } catch (itemError) {
        // One entry's unexpected throw never aborts the batch.
        console.error(`[pipeline:batch] action failed for ${item.id}`, itemError);
        results.push({ id: item.id, ok: false, reason: "Unexpected error." });
      }
    }

    const ok = results.filter((r) => r.ok).length;
    return NextResponse.json({ ok: true, moved: ok, total: results.length, results });
  } catch (error) {
    return safeJsonError(error, "api:pipeline:batch", "PIPELINE_ACTION_FAILED");
  }
}
